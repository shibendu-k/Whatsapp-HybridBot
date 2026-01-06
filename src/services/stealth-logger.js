const fs = require('fs-extra');
const path = require('path');
const mime = require('mime-types');
const logger = require('../utils/logger');
const { formatTimestamp, maskPhoneNumber, generateId, cleanOldFiles, matchesGroupName, getMessageContent, getPhoneFromJid } = require('../utils/helpers');

class StealthLoggerService {
  constructor(config, accountId) {
    this.config = config;
    this.accountId = accountId;
    this.textCache = new Map(); // Cache text messages
    this.mediaCache = new Map(); // Cache media metadata
    this.tempStorage = process.env.TEMP_STORAGE_PATH || './temp_storage';
    this.vaultIndexPath = path.join(this.tempStorage, 'vault-index.json');
    this.vaultCommands = {
      enabled: this.config.vaultCommands ? this.config.vaultCommands.enabled !== false : true,
      prefix: this.config.vaultCommands?.prefix || '!vault',
      maxItems: this.config.vaultCommands?.maxItems || 200
    };
    
    fs.ensureDirSync(this.tempStorage);
    fs.ensureFileSync(this.vaultIndexPath);
    
    try {
      const existing = fs.readJSONSync(this.vaultIndexPath);
      if (!existing || !Array.isArray(existing.items)) {
        fs.writeJSONSync(this.vaultIndexPath, { items: [] }, { spaces: 2 });
      }
    } catch {
      fs.writeJSONSync(this.vaultIndexPath, { items: [] }, { spaces: 2 });
    }
    
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
    
    return matchesGroupName(groupName, this.config.excludedGroups);
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

    const messageId = message.key.id;
    const text = getMessageContent(message.message);
    
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
          logger: {
            level: 'silent',
            fatal: () => {},
            error: () => {},
            warn: () => {},
            info: () => {},
            debug: () => {},
            trace: () => {},
            child: () => ({ level: 'silent', fatal: () => {}, error: () => {}, warn: () => {}, info: () => {}, debug: () => {}, trace: () => {}, child: () => ({}) })
          },
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
      const vaultId = `vault-${generateId()}`;
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
        savedAt: Date.now(),
        vaultId
      });

      await this.addVaultRecord({
        filepath,
        type: mediaType,
        sender: senderName,
        senderId: message.key.remoteJid,
        timestamp: message.messageTimestamp,
        groupName,
        caption: content.imageMessage?.caption || content.videoMessage?.caption || '',
        savedAt: Date.now(),
        vaultId
      });

      // Send to vault
      await this.sendMediaToVault(client, {
        filepath,
        type: mediaType,
        sender: senderName,
        senderId: message.key.remoteJid,
        timestamp: message.messageTimestamp,
        groupName,
        caption: content.imageMessage?.caption || content.videoMessage?.caption || '',
        vaultId
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
        if (!cachedMedia.vaultId) {
          cachedMedia.vaultId = `vault-${generateId()}`;
        }
        
        const record = {
          ...cachedMedia,
          savedAt: cachedMedia.savedAt || Date.now()
        };
        
        await this.addVaultRecord(record);
        await this.sendMediaToVault(client, record);
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
      
      const maskedId = maskPhoneNumber(getPhoneFromJid(data.senderId));
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
      
      const maskedId = maskPhoneNumber(getPhoneFromJid(data.senderId));
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
      
      if (data.vaultId) {
        caption += `\n🆔 Vault ID: ${data.vaultId}`;
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
   * Persist vault record
   * @param {object} record - Vault record
   */
  async addVaultRecord(record) {
    try {
      const items = await this.readVaultIndex();
      items.push(record);
      
      const maxItems = this.vaultCommands.maxItems || 200;
      if (items.length > maxItems) {
        items.splice(0, items.length - maxItems);
      }
      
      await this.writeVaultIndex(items);
    } catch (error) {
      logger.error('Failed to persist vault record', error);
    }
  }

  /**
   * Read vault index
   * @returns {Promise<Array>} Vault items
   */
  async readVaultIndex() {
    try {
      const data = await fs.readJSON(this.vaultIndexPath);
      return Array.isArray(data.items) ? data.items : [];
    } catch {
      return [];
    }
  }

  /**
   * Write vault index
   * @param {Array} items - Vault items
   */
  async writeVaultIndex(items) {
    await fs.writeJSON(this.vaultIndexPath, { items }, { spaces: 2 });
  }

  /**
   * Find vault record by ID (or latest)
   * @param {string|null} vaultId - Vault ID
   * @returns {Promise<object|null>} Vault record
   */
  async findVaultRecord(vaultId) {
    const items = await this.readVaultIndex();
    
    if (!vaultId || vaultId === 'latest') {
      return items[items.length - 1] || null;
    }
    
    return items.find(item => item.vaultId === vaultId) || null;
  }

  /**
   * Handle vault retrieval commands
   * @param {string} text - Message text
   * @param {object} message - Baileys message
   * @param {object} client - Baileys client
   * @returns {Promise<boolean>} True if handled
   */
  async handleVaultCommand(text, message, client) {
    if (!this.vaultCommands.enabled) return false;
    
    const normalized = text.trim();
    const prefix = (this.vaultCommands.prefix || '!vault').toLowerCase();
    
    if (!normalized.toLowerCase().startsWith(prefix)) {
      return false;
    }
    
    const args = normalized.slice(prefix.length).trim();
    const targetJid = message.key.remoteJid;
    
    if (!args) {
      await client.sendMessage(targetJid, `📦 Saved stories\nUse: ${this.vaultCommands.prefix} <vaultId|latest>`);
      return true;
    }
    
      const record = await this.findVaultRecord(args.toLowerCase() === 'latest' ? null : args);
    
    if (!record) {
      await client.sendMessage(targetJid, `❌ No saved story found for "${args}".`);
      return true;
    }
    
    try {
      const buffer = await fs.readFile(record.filepath);
      const mimeType = mime.lookup(record.filepath) || 'application/octet-stream';
      const formattedTime = formatTimestamp(record.timestamp);
      const maskedId = record.senderId ? maskPhoneNumber(getPhoneFromJid(record.senderId)) : '';
      
      let caption = `🗂️ Saved Story\n`;
      caption += `👤 Sender: ${record.sender || 'Unknown'}\n`;
      
      if (maskedId) {
        caption += `📞 ID: ${maskedId}\n`;
      }
      
      caption += `⏰ Time: ${formattedTime}\n`;
      
      if (record.groupName) {
        caption += `👥 Group: ${record.groupName}\n`;
      }
      
      if (record.caption) {
        caption += `\n💬 Caption: ${record.caption}`;
      }
      
      caption += `\n🆔 Vault ID: ${record.vaultId}`;
      
      if (record.type === 'image') {
        await client.sendMessage(targetJid, {
          image: buffer,
          caption,
          mimetype: mimeType
        });
      } else if (record.type === 'video') {
        await client.sendMessage(targetJid, {
          video: buffer,
          caption,
          mimetype: mimeType
        });
      } else if (record.type === 'audio') {
        await client.sendMessage(targetJid, {
          audio: buffer,
          mimetype: mimeType,
          ptt: true
        });
      } else {
        await client.sendMessage(targetJid, caption);
      }
    } catch (error) {
      logger.error('Failed to send vault story', error);
      await client.sendMessage(targetJid, '❌ Unable to retrieve the requested story. It may have expired.');
    }
    
    return true;
  }

  /**
   * Handle status messages
   * Note: Status capture functionality is reserved for future implementation
   * when WhatsApp status API becomes more stable in Baileys.
   * @param {object} message - Status message
   * @param {object} client - Baileys client
   */
  async handleStatus(message, client) {
    // Status capture not yet implemented
    // Would require handling of status updates separately
    logger.debug('Status message detected (not yet captured)');
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
      
      const vaultItems = await this.readVaultIndex();
      const validItems = [];
      
      for (const item of vaultItems) {
        const exists = await fs.pathExists(item.filepath);
        const savedAt = item.savedAt || (item.timestamp ? item.timestamp * 1000 : 0);
        const withinAge = now - savedAt <= this.config.mediaCacheDuration;
        
        if (exists && withinAge) {
          validItems.push(item);
        }
      }
      
      if (validItems.length !== vaultItems.length) {
        await this.writeVaultIndex(validItems);
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
