const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const fs = require('fs-extra');
const path = require('path');
const logger = require('./utils/logger');
const { sleep, getRandomDelay } = require('./utils/helpers');

class BaileysClient {
  constructor(accountId, config, vaultNumber) {
    this.accountId = accountId;
    this.config = config;
    this.vaultNumber = vaultNumber;
    this.sock = null;
    this.connected = false;
    this.qrShown = false;
    this.sessionPath = path.join(
      process.env.SESSIONS_PATH || './sessions',
      accountId
    );
    this.messageQueue = [];
    this.processing = false;
    
    fs.ensureDirSync(this.sessionPath);
  }

  /**
   * Initialize and connect to WhatsApp
   * @returns {Promise<void>}
   */
  async initialize() {
    try {
      logger.system(`[${this.accountId}] Initializing Baileys client...`);

      // Load auth state
      const { state, saveCreds } = await useMultiFileAuthState(this.sessionPath);
      
      // Fetch latest Baileys version
      const { version } = await fetchLatestBaileysVersion();
      
      // Create socket connection
      this.sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false, // We'll handle QR ourselves
        logger: {
          level: 'silent', // Reduce Baileys logging noise
          info: () => {},
          error: () => {},
          warn: () => {},
          debug: () => {},
          trace: () => {}
        },
        browser: ['WhatsApp Hybrid Bot', 'Chrome', '3.2.0'],
        syncFullHistory: false,
        markOnlineOnConnect: false,
        defaultQueryTimeoutMs: undefined
      });

      // Store credentials on update
      this.sock.ev.on('creds.update', saveCreds);

      // Handle connection updates
      this.sock.ev.on('connection.update', async (update) => {
        await this.handleConnectionUpdate(update);
      });

      // Handle incoming messages
      this.sock.ev.on('messages.upsert', async ({ messages, type }) => {
        await this.handleMessages(messages, type);
      });

      // Handle message deletions
      this.sock.ev.on('messages.update', async (updates) => {
        await this.handleMessageUpdates(updates);
      });

      logger.success(`[${this.accountId}] Baileys client initialized`);
    } catch (error) {
      logger.error(`[${this.accountId}] Initialization failed`, error);
      throw error;
    }
  }

  /**
   * Handle connection updates
   * @param {object} update - Connection update
   */
  async handleConnectionUpdate(update) {
    const { connection, lastDisconnect, qr } = update;

    // Show QR code if available
    if (qr && !this.qrShown) {
      logger.info(`\n[${this.accountId}] Scan this QR code:\n`);
      qrcode.generate(qr, { small: true });
      this.qrShown = true;
    }

    // Handle connection state
    if (connection === 'close') {
      this.connected = false;
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      
      logger.warn(`[${this.accountId}] Connection closed. Reconnect: ${shouldReconnect}`);
      
      if (shouldReconnect) {
        logger.info(`[${this.accountId}] Reconnecting in 5 seconds...`);
        await sleep(5000);
        await this.initialize();
      } else {
        logger.error(`[${this.accountId}] Logged out. Please re-scan QR code.`);
      }
    }

    if (connection === 'open') {
      this.connected = true;
      this.qrShown = false;
      logger.success(`[${this.accountId}] Connected to WhatsApp!`);
      
      // Get own JID
      this.ownJid = this.sock.user.id;
      logger.info(`[${this.accountId}] Phone: ${this.sock.user.id.split(':')[0]}`);
    }
  }

  /**
   * Handle incoming messages
   * @param {object[]} messages - Array of messages
   * @param {string} type - Message type
   */
  async handleMessages(messages, type) {
    if (type !== 'notify') return;

    for (const message of messages) {
      // Queue message for processing
      this.messageQueue.push(message);
    }

    // Start processing if not already processing
    if (!this.processing) {
      this.processMessageQueue();
    }
  }

  /**
   * Process message queue with random delays
   */
  async processMessageQueue() {
    if (this.processing) return;
    this.processing = true;

    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift();
      
      try {
        // Emit message event for handlers
        if (this.onMessage) {
          await this.onMessage(message, this);
        }
        
        // Random delay for anti-ban
        const delay = getRandomDelay(3000, 7000);
        await sleep(delay);
      } catch (error) {
        logger.error(`[${this.accountId}] Message processing failed`, error);
      }
    }

    this.processing = false;
  }

  /**
   * Handle message updates (deletions, edits, etc.)
   * @param {object[]} updates - Array of message updates
   */
  async handleMessageUpdates(updates) {
    for (const update of updates) {
      // Check if message was deleted
      if (update.update.messageStubType === 68) { // REVOKE
        logger.info(`[${this.accountId}] Message deleted: ${update.key.id}`);
        
        if (this.onMessageDelete) {
          await this.onMessageDelete(update, this);
        }
      }
    }
  }

  /**
   * Download media from message
   * @param {object} message - Message with media
   * @returns {Promise<Buffer>} Media buffer
   */
  async downloadMediaMessage(message) {
    try {
      const downloadMediaMessage = require('@whiskeysockets/baileys').downloadMediaMessage;
      return await downloadMediaMessage(message, 'buffer', {}, {
        logger: this.sock.logger,
        reuploadRequest: this.sock.updateMediaMessage
      });
    } catch (error) {
      logger.error(`[${this.accountId}] Media download failed`, error);
      throw error;
    }
  }

  /**
   * Send text message
   * @param {string} jid - Recipient JID
   * @param {string} text - Message text
   * @returns {Promise<object>} Sent message info
   */
  async sendMessage(jid, text) {
    if (!this.connected || !this.sock) {
      throw new Error('Not connected to WhatsApp');
    }

    try {
      // Random delay before sending
      const delay = getRandomDelay();
      await sleep(delay);

      const result = await this.sock.sendMessage(jid, { text });
      logger.debug(`[${this.accountId}] Message sent to ${jid.substring(0, 15)}...`);
      return result;
    } catch (error) {
      logger.error(`[${this.accountId}] Send message failed`, error);
      throw error;
    }
  }

  /**
   * Send media message
   * @param {string} jid - Recipient JID
   * @param {Buffer} media - Media buffer
   * @param {string} type - Media type (image, video, audio)
   * @param {string} caption - Optional caption
   * @returns {Promise<object>} Sent message info
   */
  async sendMedia(jid, media, type, caption = '') {
    if (!this.connected || !this.sock) {
      throw new Error('Not connected to WhatsApp');
    }

    try {
      // Random delay before sending
      const delay = getRandomDelay();
      await sleep(delay);

      const message = { [type]: media };
      if (caption) message.caption = caption;

      const result = await this.sock.sendMessage(jid, message);
      logger.debug(`[${this.accountId}] ${type} sent to ${jid.substring(0, 15)}...`);
      return result;
    } catch (error) {
      logger.error(`[${this.accountId}] Send media failed`, error);
      throw error;
    }
  }

  /**
   * Get contact name
   * @param {string} jid - Contact JID
   * @returns {Promise<string>} Contact name
   */
  async getContactName(jid) {
    try {
      if (!this.sock) return jid.split('@')[0];

      // Try to get from contacts
      const contacts = await this.sock.onWhatsApp(jid);
      if (contacts && contacts[0]) {
        return contacts[0].notify || contacts[0].name || jid.split('@')[0];
      }

      return jid.split('@')[0];
    } catch (error) {
      return jid.split('@')[0];
    }
  }

  /**
   * Get group metadata
   * @param {string} groupJid - Group JID
   * @returns {Promise<object>} Group metadata
   */
  async getGroupMetadata(groupJid) {
    try {
      if (!this.sock) return null;
      return await this.sock.groupMetadata(groupJid);
    } catch (error) {
      logger.error(`[${this.accountId}] Failed to get group metadata`, error);
      return null;
    }
  }

  /**
   * Register message handler
   * @param {Function} handler - Message handler function
   */
  onMessageReceived(handler) {
    this.onMessage = handler;
  }

  /**
   * Register delete handler
   * @param {Function} handler - Delete handler function
   */
  onMessageDeleted(handler) {
    this.onMessageDelete = handler;
  }

  /**
   * Disconnect from WhatsApp
   */
  async disconnect() {
    if (this.sock) {
      logger.info(`[${this.accountId}] Disconnecting...`);
      await this.sock.end();
      this.connected = false;
      this.sock = null;
    }
  }

  /**
   * Check if connected
   * @returns {boolean} Connection status
   */
  isConnected() {
    return this.connected;
  }

  /**
   * Get account statistics
   * @returns {object} Account stats
   */
  getStats() {
    return {
      accountId: this.accountId,
      connected: this.connected,
      phone: this.ownJid ? this.ownJid.split(':')[0] : 'N/A',
      queueSize: this.messageQueue.length
    };
  }
}

module.exports = BaileysClient;
