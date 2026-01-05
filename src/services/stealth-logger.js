const fs = require('fs-extra');
const path = require('path');
const mime = require('mime-types');
const logger = require('../utils/logger');
const { formatTimestamp, maskPhoneNumber, generateId, cleanOldFiles } = require('../utils/helpers');

class StealthLoggerService {
  constructor(config, accountId) {
    this.config = config;
    this.accountId = accountId;
    this.textCache = new Map(); // Cache text messages
    this.mediaCache = new Map(); // Cache media metadata
    this.tempStorage = process.env.TEMP_STORAGE_PATH || './temp_storage';
    
    fs.ensureDirSync(this.tempStorage);
    
    // Start cleanup interval
    this.startCleanupInterval();
  }

  /**
   * Check if group should be excluded from logging
   * @param {string} groupName - Group name
   * @returns {boolean} True if excluded
   */
  isGroupExcluded(groupName) {
    if (!groupName || !this.config.excludedGroups || this.config.excludedGroups.length === 0) {
      return false;
    }
    
    const helpers = require('../utils/helpers');
    return helpers.matchesGroupName(groupName, this.config.excludedGroups);
  }

  /**
   * Cache text message
   * @param {object} message - Message object
   * @param {string} senderName - Sender name
   * @param {string} groupName - Group name (if from group)
   */
  cacheTextMessage(message, senderName, groupName = null) {
    // Check exclusions
    if (groupName && this.isGroupExcluded(groupName)) {
      return;
    }

    const helpers = require('../utils/helpers');
    const messageId = message.key.id;
    const text = helpers.getMessageContent(message.message);
    
    if (!text || message.key.fromMe) return;

    // Limit cache size
    if (this.textCache.size >= this.config.maxTextCache) {
      const oldestKey = this.textCache.keys().next().value;
      this.textCache.delete(oldestKey);
    }

    this.textCache.set(messageId, {
      text,
      sender: senderName,
      senderId: message.key.remoteJid,
      timestamp: message.messageTimestamp,
      groupName,
      cachedAt: Date.now()
    });

    logger.debug(`Cached text message: ${messageId.substring(0, 10)}...`);
  }

  /**
   * Handle view-once message (BAILEYS SPECIFIC)
   * @param {object} message - Baileys message object
   * @param {object} client - Baileys client instance
   * @param {string} senderName - Sender name
   * @param {string} groupName - Group name (if from group)
   * @returns {Promise<void>}
   */
  async captureViewOnce(message, client, senderName, groupName = null) {
    try {
      // Check exclusions
      if (groupName && this.isGroupExcluded(groupName)) {
        return;
      }

      const viewOnceMsg = message.message?.viewOnceMessage || message.message?.viewOnceMessageV2;
      if (!viewOnceMsg) return;

      logger.info(`📸 View-once message detected from ${senderName}`);

      // Extract the nested message content
      const content = viewOnceMsg.message;
      if (!content) return;

      let mediaType = null;
      let extension = null;

      if (content.imageMessage) {
        mediaType = 'image';
        extension = 'jpg';
      } else if (content.videoMessage) {
        mediaType = 'video';
        extension = 'mp4';
      } else if (content.audioMessage) {
        mediaType = 'audio';
        extension = 'ogg';
      }

      if (!mediaType) return;

      // Download media using Baileys' downloadMediaMessage
      const buffer = await client.downloadMediaMessage(
        { key: message.key, message: content },
        'buffer',
        {},
        {
          logger: client.logger,
          reuploadRequest: client.updateMediaMessage
        }
      );

      if (!buffer) {
        logger.error('Failed to download view-once media');
        return;
      }

      // Save to temp storage
      const filename = `view-once-${generateId()}.${extension}`;
      const filepath = path.join(this.tempStorage, filename);
      await fs.writeFile(filepath, buffer);

      logger.success(`Saved view-once ${mediaType}: ${filename}`);

      // Cache metadata
      this.mediaCache.set(message.key.id, {
        filepath,
        type: mediaType,
        sender: senderName,
        senderId: message.key.remoteJid,
        timestamp: message.messageTimestamp,
        groupName,
        caption: content.imageMessage?.caption || content.videoMessage?.caption || '',
        savedAt: Date.now()
      });

      // Send to vault
      await this.sendMediaToVault(client, {
        filepath,
        type: mediaType,
        sender: senderName,
        senderId: message.key.remoteJid,
        timestamp: message.messageTimestamp,
        groupName,
        caption: content.imageMessage?.caption || content.videoMessage?.caption || ''
      });

    } catch (error) {
      logger.error('Failed to capture view-once message', error);
    }
  }

  /**
   * Handle deleted message recovery
   * @param {object} deleteInfo - Delete notification
   * @param {object} client - Baileys client
   * @returns {Promise<void>}
   */
  async handleDeletedMessage(deleteInfo, client) {
    try {
      const messageId = deleteInfo.key.id;
      
      // Check if we have the text cached
      const cachedText = this.textCache.get(messageId);
      if (cachedText) {
        logger.info(`🗑️ Recovered deleted text message`);
        
        await this.sendTextToVault(client, {
          text: cachedText.text,
          sender: cachedText.sender,
          senderId: cachedText.senderId,
          timestamp: cachedText.timestamp,
          groupName: cachedText.groupName
        });
        
        return;
      }

      // Check if we have media cached
      const cachedMedia = this.mediaCache.get(messageId);
      if (cachedMedia) {
        logger.info(`🗑️ Recovered deleted ${cachedMedia.type} message`);
        
        await this.sendMediaToVault(client, cachedMedia);
        return;
      }

      logger.debug(`Message ${messageId.substring(0, 10)}... not in cache`);
    } catch (error) {
      logger.error('Failed to handle deleted message', error);
    }
  }

  /**
   * Handle ephemeral/disappearing messages
   * @param {object} message - Message object
   * @param {object} client - Baileys client
   * @param {string} senderName - Sender name
   * @param {string} groupName - Group name (if from group)
   */
  async handleEphemeralMessage(message, client, senderName, groupName = null) {
    try {
      // Check exclusions
      if (groupName && this.isGroupExcluded(groupName)) {
        return;
      }

      // Ephemeral messages have ephemeralMessage wrapper
      const ephemeralMsg = message.message?.ephemeralMessage;
      if (!ephemeralMsg) return;

      logger.info(`⏳ Ephemeral message detected from ${senderName}`);

      // Extract and cache like normal message
      const content = ephemeralMsg.message;
      if (!content) return;

      // Create modified message for caching
      const modifiedMsg = {
        ...message,
        message: content
      };

      // Cache as text if it's a text message
      this.cacheTextMessage(modifiedMsg, senderName, groupName);

      // If it contains media, handle it
      if (content.imageMessage || content.videoMessage || content.audioMessage) {
        // Handle similar to view-once
        logger.info('Ephemeral media message detected, caching...');
      }
    } catch (error) {
      logger.error('Failed to handle ephemeral message', error);
    }
  }

  /**
   * Send text message to vault
   * @param {object} client - Baileys client
   * @param {object} data - Message data
   */
  async sendTextToVault(client, data) {
    try {
      const vaultNumber = this.config.vaultNumber || client.vaultNumber;
      if (!vaultNumber) {
        logger.warn('Vault number not configured, skipping vault send');
        return;
      }

      const vaultJid = vaultNumber.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
      
      const helpers = require('../utils/helpers');
      const maskedId = maskPhoneNumber(helpers.getPhoneFromJid(data.senderId));
      const formattedTime = formatTimestamp(data.timestamp);

      let message = `🗑️ *Deleted Text*\n`;
      message += `━━━━━━━━━━━━━━━━\n`;
      message += `👤 Sender: ${data.sender}\n`;
      message += `📞 ID: ${maskedId}\n`;
      message += `⏰ Time: ${formattedTime}\n`;
      
      if (data.groupName) {
        message += `👥 Group: ${data.groupName}\n`;
      }
      
      message += `\n📄 Content:\n${data.text}`;

      await client.sendMessage(vaultJid, { text: message });
      logger.success('Sent deleted text to vault');
    } catch (error) {
      logger.error('Failed to send text to vault', error);
    }
  }

  /**
   * Send media to vault
   * @param {object} client - Baileys client
   * @param {object} data - Media data
   */
  async sendMediaToVault(client, data) {
    try {
      const vaultNumber = this.config.vaultNumber || client.vaultNumber;
      if (!vaultNumber) {
        logger.warn('Vault number not configured, skipping vault send');
        return;
      }

      const vaultJid = vaultNumber.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
      
      const helpers = require('../utils/helpers');
      const maskedId = maskPhoneNumber(helpers.getPhoneFromJid(data.senderId));
      const formattedTime = formatTimestamp(data.timestamp);

      let caption = `📸 *View-Once ${data.type.toUpperCase()}*\n`;
      caption += `━━━━━━━━━━━━━━━━\n`;
      caption += `👤 Sender: ${data.sender}\n`;
      caption += `📞 ID: ${maskedId}\n`;
      caption += `⏰ Time: ${formattedTime}\n`;
      
      if (data.groupName) {
        caption += `👥 Group: ${data.groupName}\n`;
      }
      
      if (data.caption) {
        caption += `\n💬 Caption: ${data.caption}`;
      }

      // Read file and send
      const buffer = await fs.readFile(data.filepath);
      const mimeType = mime.lookup(data.filepath) || 'application/octet-stream';

      if (data.type === 'image') {
        await client.sendMessage(vaultJid, {
          image: buffer,
          caption,
          mimetype: mimeType
        });
      } else if (data.type === 'video') {
        await client.sendMessage(vaultJid, {
          video: buffer,
          caption,
          mimetype: mimeType
        });
      } else if (data.type === 'audio') {
        await client.sendMessage(vaultJid, {
          audio: buffer,
          mimetype: mimeType,
          ptt: true
        });
      }

      logger.success(`Sent ${data.type} to vault`);
    } catch (error) {
      logger.error('Failed to send media to vault', error);
    }
  }

  /**
   * Handle status messages
   * @param {object} message - Status message
   * @param {object} client - Baileys client
   */
  async handleStatus(message, client) {
    try {
      logger.info('📢 Status message detected');
      
      // Status messages could be captured and sent to vault
      // Implementation depends on requirements
      
    } catch (error) {
      logger.error('Failed to handle status', error);
    }
  }

  /**
   * Cleanup old files and cache
   */
  async cleanup() {
    try {
      // Clean status files (24 hours)
      await cleanOldFiles(this.tempStorage, this.config.statusCacheDuration);
      
      // Clean media files (68 hours)
      await cleanOldFiles(this.tempStorage, this.config.mediaCacheDuration);
      
      // Clean text cache (3 hours)
      const now = Date.now();
      const textExpiry = 10800000; // 3 hours
      
      for (const [key, value] of this.textCache.entries()) {
        if (now - value.cachedAt > textExpiry) {
          this.textCache.delete(key);
        }
      }
      
      // Clean media cache
      for (const [key, value] of this.mediaCache.entries()) {
        if (now - value.savedAt > this.config.mediaCacheDuration) {
          this.mediaCache.delete(key);
        }
      }
      
      logger.debug(`Cleanup complete. Text cache: ${this.textCache.size}, Media cache: ${this.mediaCache.size}`);
    } catch (error) {
      logger.error('Cleanup failed', error);
    }
  }

  /**
   * Start periodic cleanup
   */
  startCleanupInterval() {
    // Run cleanup every 6 hours
    setInterval(() => {
      this.cleanup();
    }, 21600000);
  }

  /**
   * Get statistics
   * @returns {object} Stats
   */
  getStats() {
    return {
      textCached: this.textCache.size,
      mediaCached: this.mediaCache.size,
      excludedGroups: this.config.excludedGroups.length
    };
  }
}

module.exports = StealthLoggerService;
