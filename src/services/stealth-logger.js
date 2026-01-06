const fs = require('fs-extra');
const path = require('path');
const mime = require('mime-types');
const logger = require('../utils/logger');
const { formatTimestamp, maskPhoneNumber, generateId, cleanOldFiles, matchesGroupName, getMessageContent } = require('../utils/helpers');

// Pino-compatible silent logger for Baileys media download
const silentLogger = {
  level: 'silent',
  fatal: () => {},
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
  trace: () => {},
  child: () => silentLogger
};

class StealthLoggerService {
  constructor(config, accountId) {
    this.config = config;
    this.accountId = accountId;
    this.textCache = new Map(); // Cache text messages
    this.mediaCache = new Map(); // Cache media metadata
    this.contactRegistry = new Map(); // Registry to store contact names by JID
    // Use account-specific temp storage folder for easier debugging
    const baseTempStorage = process.env.TEMP_STORAGE_PATH || './temp_storage';
    this.tempStorage = path.join(baseTempStorage, accountId);
    
    fs.ensureDirSync(this.tempStorage);
    
    // Start cleanup interval
    this.startCleanupInterval();
  }

  /**
   * Register/update a contact in the registry
   * Called when messages are received to build a name lookup
   * @param {string} jid - Contact JID 
   * @param {string} name - Contact name (from WhatsApp contacts)
   */
  registerContact(jid, name) {
    if (!jid || !name) return;
    
    // Don't overwrite good names with fallback formats
    const existingName = this.contactRegistry.get(jid);
    
    // Check if new name is better than existing
    const isGoodName = name && 
                       !name.includes('@') && 
                       name !== 'status' && 
                       !name.startsWith('Linked Contact') &&
                       !/^[0-9]+$/.test(name);
    
    // Update if we have a good name or no existing entry
    if (isGoodName || !existingName) {
      this.contactRegistry.set(jid, {
        name,
        updatedAt: Date.now()
      });
    }
  }

  /**
   * Get contact name from registry
   * @param {string} jid - Contact JID
   * @returns {string|null} Contact name or null if not found
   */
  getContactFromRegistry(jid) {
    const contact = this.contactRegistry.get(jid);
    return contact?.name || null;
  }

  /**
   * Sanitize JID to clean phone number format
   * Converts any JID (including LID with device IDs like 123456789:5@lid)
   * to a clean phone number JID (123456789@s.whatsapp.net)
   * @param {string} jid - The raw JID from Baileys
   * @returns {string} Clean JID (e.g., 12345@s.whatsapp.net)
   */
  sanitizeJid(jid) {
    if (!jid) return '';
    // 1. Split by '@' to remove domain (@lid or @s.whatsapp.net)
    // 2. Split by ':' to remove device ID (:2, :55)
    // 3. Force add the standard phone domain
    const number = jid.split('@')[0].split(':')[0];
    return number + '@s.whatsapp.net';
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

    // Use participant for actual sender in groups/status, fallback to remoteJid
    // Sanitize to clean phone number JID (removes LID device IDs like :5@lid)
    const actualSenderId = this.sanitizeJid(message.key.participant || message.key.remoteJid);

    this.textCache.set(messageId, {
      text,
      sender: senderName,
      senderId: actualSenderId,
      timestamp: message.messageTimestamp,
      groupName,
      cachedAt: Date.now()
    });

    logger.debug(`Cached text message: ${messageId.substring(0, 10)}...`);
  }

  /**
   * Cache media message (images, videos, audio, documents, stickers)
   * @param {object} message - Baileys message object
   * @param {object} client - Baileys client instance
   * @param {string} senderName - Sender name
   * @param {string} groupName - Group name (if from group)
   * @returns {Promise<void>}
   */
  async cacheMediaMessage(message, client, senderName, groupName = null) {
    try {
      // Check exclusions
      if (groupName && this.isGroupExcluded(groupName)) {
        return;
      }

      // Skip own messages
      if (message.key.fromMe) return;

      const msgContent = message.message;
      if (!msgContent) return;

      let mediaType = null;
      let extension = null;
      let mediaMessage = null;
      let caption = '';

      // Detect media type
      if (msgContent.imageMessage) {
        mediaType = 'image';
        extension = 'jpg';
        mediaMessage = msgContent.imageMessage;
        caption = mediaMessage.caption || '';
      } else if (msgContent.videoMessage) {
        mediaType = 'video';
        extension = 'mp4';
        mediaMessage = msgContent.videoMessage;
        caption = mediaMessage.caption || '';
      } else if (msgContent.audioMessage) {
        mediaType = 'audio';
        mediaMessage = msgContent.audioMessage;
        extension = mediaMessage?.mimetype?.includes('ogg') ? 'ogg' : 'mp3';
      } else if (msgContent.documentMessage) {
        mediaType = 'document';
        mediaMessage = msgContent.documentMessage;
        // Extract extension from filename, handling edge cases like multiple dots or no extension
        const fileName = mediaMessage.fileName || '';
        const lastDotIndex = fileName.lastIndexOf('.');
        extension = (lastDotIndex > 0 && lastDotIndex < fileName.length - 1) 
          ? fileName.substring(lastDotIndex + 1) 
          : 'bin';
        caption = mediaMessage.caption || '';
      } else if (msgContent.stickerMessage) {
        mediaType = 'sticker';
        extension = 'webp';
        mediaMessage = msgContent.stickerMessage;
      } else {
        return; // Not a media message
      }

      logger.debug(`Caching ${mediaType} message from ${senderName}`);

      // Download media using Baileys' downloadMediaMessage
      const buffer = await client.downloadMediaMessage(
        message,
        'buffer',
        {},
        {
          logger: silentLogger,
          reuploadRequest: client.sock?.updateMediaMessage
        }
      );

      if (!buffer) {
        logger.debug('Failed to download media for caching');
        return;
      }

      // Save to temp storage
      const filename = `media-${generateId()}.${extension}`;
      const filepath = path.join(this.tempStorage, filename);
      await fs.writeFile(filepath, buffer);

      // Use participant for actual sender in groups/status, fallback to remoteJid
      // Sanitize to clean phone number JID (removes LID device IDs like :5@lid)
      const actualSenderId = this.sanitizeJid(message.key.participant || message.key.remoteJid);

      // Cache metadata
      this.mediaCache.set(message.key.id, {
        filepath,
        type: mediaType,
        sender: senderName,
        senderId: actualSenderId,
        timestamp: message.messageTimestamp,
        groupName,
        caption,
        savedAt: Date.now()
      });

      logger.debug(`Cached ${mediaType} message: ${message.key.id.substring(0, 10)}...`);
    } catch (error) {
      logger.debug(`Failed to cache media message: ${error.message}`);
    }
  }

  /**
   * Handle view-once message (BAILEYS SPECIFIC)
   * Per Baileys bug #531, viewOnceMessageV2 wraps content in FutureProofMessage.message
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

      let content = null;
      let mediaType = null;
      let extension = null;
      let caption = '';

      // Handle wrapped view-once message variants
      // viewOnceMessageV2 contains FutureProofMessage with actual content in .message property
      const viewOnceMsg = message.message?.viewOnceMessage || 
                          message.message?.viewOnceMessageV2 || 
                          message.message?.viewOnceMessageV2Extension;
      
      if (viewOnceMsg) {
        // Extract content from FutureProofMessage wrapper
        content = viewOnceMsg.message;
      } else {
        // Handle view-once media with viewOnce: true property directly on the message
        const msgContent = message.message;
        if (msgContent?.imageMessage?.viewOnce) {
          content = { imageMessage: msgContent.imageMessage };
        } else if (msgContent?.videoMessage?.viewOnce) {
          content = { videoMessage: msgContent.videoMessage };
        } else if (msgContent?.audioMessage?.viewOnce) {
          content = { audioMessage: msgContent.audioMessage };
        }
      }

      if (!content) {
        return;
      }

      logger.info(`📸 View-once message detected from ${senderName}`);

      if (content.imageMessage) {
        mediaType = 'image';
        extension = 'jpg';
        caption = content.imageMessage.caption || '';
      } else if (content.videoMessage) {
        mediaType = 'video';
        extension = 'mp4';
        caption = content.videoMessage.caption || '';
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
          logger: silentLogger,
          reuploadRequest: client.sock?.updateMediaMessage
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

      // Use participant for actual sender in groups/status, fallback to remoteJid
      // Sanitize to clean phone number JID (removes LID device IDs like :5@lid)
      const actualSenderId = this.sanitizeJid(message.key.participant || message.key.remoteJid);

      // Cache metadata
      this.mediaCache.set(message.key.id, {
        filepath,
        type: mediaType,
        sender: senderName,
        senderId: actualSenderId,
        timestamp: message.messageTimestamp,
        groupName,
        caption,
        savedAt: Date.now()
      });

      // Send to vault immediately for view-once
      await this.sendMediaToVault(client, {
        filepath,
        type: mediaType,
        sender: senderName,
        senderId: actualSenderId,
        timestamp: message.messageTimestamp,
        groupName,
        caption
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
      
      // Check if we have media cached FIRST (media with captions would be in both caches)
      const cachedMedia = this.mediaCache.get(messageId);
      if (cachedMedia) {
        logger.info(`🗑️ Recovered deleted ${cachedMedia.type} message`);
        
        await this.sendMediaToVault(client, cachedMedia, true);
        // Also remove from text cache if present (to avoid duplicate)
        this.textCache.delete(messageId);
        return;
      }

      // Check if we have the text cached (only pure text messages without media)
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

      // Check if there's a view-once message inside the ephemeral wrapper
      // This handles the case when view-once is sent in a disappearing messages chat
      if (content.viewOnceMessage || content.viewOnceMessageV2 || content.viewOnceMessageV2Extension) {
        logger.info(`📸 View-once inside ephemeral detected from ${senderName}`);
        await this.captureViewOnce(modifiedMsg, client, senderName, groupName);
        return; // Don't cache as regular media
      }

      // Also check if media has viewOnce: true property
      if (content.imageMessage?.viewOnce || content.videoMessage?.viewOnce || content.audioMessage?.viewOnce) {
        logger.info(`📸 View-once media (viewOnce property) inside ephemeral from ${senderName}`);
        await this.captureViewOnce(modifiedMsg, client, senderName, groupName);
        return; // Don't cache as regular media
      }

      // Cache as text if it's a text message
      this.cacheTextMessage(modifiedMsg, senderName, groupName);

      // If it contains media, cache the media
      if (content.imageMessage || content.videoMessage || content.audioMessage || 
          content.documentMessage || content.stickerMessage) {
        await this.cacheMediaMessage(modifiedMsg, client, senderName, groupName);
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
      
      const { getPhoneFromJid } = require('../utils/helpers');
      const maskedId = maskPhoneNumber(getPhoneFromJid(data.senderId));
      const formattedTime = formatTimestamp(data.timestamp);

      // Use sender name directly - it should be the contact name or raw phone number
      // The ID field will always be masked
      const senderDisplayName = data.sender;

      let message = `🗑️ *Deleted Text*\n`;
      message += `━━━━━━━━━━━━━━━━\n`;
      message += `👤 Sender: ${senderDisplayName}\n`;
      message += `📞 ID: ${maskedId}\n`;
      message += `⏰ Time: ${formattedTime}\n`;
      
      if (data.groupName) {
        message += `👥 Group: ${data.groupName}\n`;
      }
      
      message += `\n📄 Content:\n${data.text}`;

      await client.sendMessage(vaultJid, message);
      logger.success('Sent deleted text to vault');
    } catch (error) {
      logger.error('Failed to send text to vault', error);
    }
  }

  /**
   * Send media to vault
   * @param {object} client - Baileys client
   * @param {object} data - Media data
   * @param {boolean} isDeleted - Whether this is a deleted message (vs view-once)
   */
  async sendMediaToVault(client, data, isDeleted = false) {
    try {
      const vaultNumber = this.config.vaultNumber || client.vaultNumber;
      if (!vaultNumber) {
        logger.warn('Vault number not configured, skipping vault send');
        return;
      }

      const vaultJid = vaultNumber.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
      
      const { getPhoneFromJid } = require('../utils/helpers');
      const maskedId = maskPhoneNumber(getPhoneFromJid(data.senderId));
      const formattedTime = formatTimestamp(data.timestamp);

      // Use sender name directly - it should be the contact name or raw phone number
      // The ID field will always be masked
      const senderDisplayName = data.sender;

      // Different header for deleted vs view-once messages
      const headerEmoji = isDeleted ? '🗑️' : '📸';
      const headerText = isDeleted ? 'Deleted' : 'View-Once';

      let caption = `${headerEmoji} *${headerText} ${data.type.toUpperCase()}*\n`;
      caption += `━━━━━━━━━━━━━━━━\n`;
      caption += `👤 Sender: ${senderDisplayName}\n`;
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

      // Use sock.sendMessage directly to send media with full options
      const sock = client.sock;
      if (!sock) {
        logger.error('Client socket not available');
        return;
      }

      if (data.type === 'image') {
        await sock.sendMessage(vaultJid, {
          image: buffer,
          caption,
          mimetype: mimeType
        });
      } else if (data.type === 'video') {
        await sock.sendMessage(vaultJid, {
          video: buffer,
          caption,
          mimetype: mimeType
        });
      } else if (data.type === 'audio') {
        await sock.sendMessage(vaultJid, {
          audio: buffer,
          mimetype: mimeType,
          ptt: true
        });
      } else if (data.type === 'document') {
        await sock.sendMessage(vaultJid, {
          document: buffer,
          caption,
          mimetype: mimeType,
          fileName: path.basename(data.filepath)
        });
      } else if (data.type === 'sticker') {
        // Send sticker as image with caption since stickers can't have captions
        await sock.sendMessage(vaultJid, {
          image: buffer,
          caption,
          mimetype: 'image/webp'
        });
      }

      logger.success(`Sent ${isDeleted ? 'deleted' : 'view-once'} ${data.type} to vault`);
    } catch (error) {
      logger.error('Failed to send media to vault', error);
    }
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
      contactsRegistered: this.contactRegistry.size,
      excludedGroups: this.config.excludedGroups.length
    };
  }
}

module.exports = StealthLoggerService;
