const fs = require('fs-extra');
const path = require('path');
const logger = require('./utils/logger');
const BaileysClient = require('./baileys-client');
const StealthLoggerService = require('./services/stealth-logger');
const TMDBService = require('./services/tmdb');
const CommandRouter = require('./services/command-router');
const { isGroupChat, getPhoneFromJid, getMessageContent } = require('./utils/helpers');

class AccountManager {
  constructor() {
    this.accounts = new Map();
    this.configPath = path.join(process.cwd(), 'config', 'accounts.json');
    this.tmdbService = new TMDBService();
    this.commandRouter = new CommandRouter();
    this.stats = {
      messagesProcessed: 0,
      moviesSearched: 0,
      deletedRecovered: 0,
      viewOnceCaptured: 0,
      statusCaptured: 0,
      statusAutoDeleted: 0,
      errors: 0
    };
    this.activeSessions = new Map(); // Track all active chats
  }

  /**
   * Load accounts from configuration
   * @returns {Promise<void>}
   */
  async loadAccounts() {
    try {
      if (!await fs.pathExists(this.configPath)) {
        logger.warn('accounts.json not found, creating empty configuration');
        await fs.writeJSON(this.configPath, { accounts: [] }, { spaces: 2 });
        return;
      }

      const config = await fs.readJSON(this.configPath);
      
      if (!config.accounts || config.accounts.length === 0) {
        logger.warn('No accounts configured');
        return;
      }

      logger.info(`Loading ${config.accounts.length} account(s)...`);

      for (const accountConfig of config.accounts) {
        if (accountConfig.enabled) {
          await this.addAccount(accountConfig);
        } else {
          logger.info(`[${accountConfig.accountId}] Disabled, skipping`);
        }
      }

      logger.success(`Loaded ${this.accounts.size} active account(s)`);
    } catch (error) {
      logger.error('Failed to load accounts', error);
      throw error;
    }
  }

  /**
   * Add and initialize an account
   * @param {object} accountConfig - Account configuration
   * @returns {Promise<void>}
   */
  async addAccount(accountConfig) {
    try {
      const { accountId, vaultNumber, modules } = accountConfig;

      if (this.accounts.has(accountId)) {
        logger.warn(`Account ${accountId} already exists`);
        return;
      }

      logger.info(`[${accountId}] Adding account...`);

      // Create Baileys client
      const client = new BaileysClient(accountId, accountConfig, vaultNumber);

      // Create stealth logger if enabled
      let stealthLogger = null;
      if (modules.stealthLogger && modules.stealthLogger.enabled) {
        stealthLogger = new StealthLoggerService(modules.stealthLogger, accountId);
        logger.success(`[${accountId}] Stealth logger enabled`);
      }

      // Store account data
      this.accounts.set(accountId, {
        client,
        config: accountConfig,
        stealthLogger,
        modules
      });

      // Register message handlers
      client.onMessageReceived(async (message, clientInstance) => {
        await this.handleMessage(accountId, message, clientInstance);
      });

      client.onMessageDeleted(async (deleteInfo, clientInstance) => {
        await this.handleMessageDelete(accountId, deleteInfo, clientInstance);
      });

      // Initialize client
      await client.initialize();

      logger.success(`[${accountId}] Account added successfully`);
    } catch (error) {
      logger.error(`Failed to add account ${accountConfig.accountId}`, error);
      this.stats.errors++;
    }
  }

  /**
   * Handle incoming message
   * @param {string} accountId - Account ID
   * @param {object} message - Message object
   * @param {object} client - Client instance
   */
  async handleMessage(accountId, message, client) {
    try {
      this.stats.messagesProcessed++;

      const account = this.accounts.get(accountId);
      if (!account) return;

      // Extract message info
      const { key, message: msgContent, messageTimestamp } = message;
      const { remoteJid, fromMe, participant } = key;

      // EARLY debug logging (before fromMe check) to capture ALL incoming events
      if (process.env.VIEW_ONCE_DEBUG === 'true' && account.stealthLogger) {
        const msgKeys = Object.keys(msgContent || {});
        logger.info(`[VIEW-ONCE DEBUG] EARLY CHECK - fromMe: ${fromMe} | JID: ${remoteJid} | Keys: ${msgKeys.join(', ')}`);
      }

      // Skip own messages for most processing
      if (fromMe) return;

      // Get sender info - handle different chat types
      let senderName = '';
      let groupName = null;
      let actualSenderJid = remoteJid; // Default to remoteJid for private chats

      // Handle status broadcasts - status@broadcast with participant
      if (remoteJid === 'status@broadcast') {
        actualSenderJid = participant || remoteJid;
        senderName = await client.getContactName(actualSenderJid);
        groupName = 'Status Update';
      }
      // Check if group chat
      else if (isGroupChat(remoteJid)) {
        const groupMetadata = await client.getGroupMetadata(remoteJid);
        groupName = groupMetadata?.subject || 'Unknown Group';
        
        // Get actual sender in group - participant contains the sender
        actualSenderJid = participant || remoteJid;
        senderName = await client.getContactName(actualSenderJid);
      } 
      // Private DM - use remoteJid directly
      else {
        actualSenderJid = remoteJid;
        senderName = await client.getContactName(remoteJid);
      }

      // Check if sender JID is a LID (linked ID) - always format as "Linked Contact"
      // This must be done BEFORE the generic fallback check
      if (actualSenderJid.includes('@lid')) {
        const phone = getPhoneFromJid(actualSenderJid);
        senderName = `Linked Contact (${phone.slice(-4)})`;
      }
      // Fallback: if senderName looks like raw number or unknown format
      else if (!senderName || senderName.includes('@') || senderName === 'status' || /^[0-9]+$/.test(senderName)) {
        const phone = getPhoneFromJid(actualSenderJid);
        senderName = phone || 'Unknown';
      }

      // Register session (skip status@broadcast)
      if (remoteJid !== 'status@broadcast') {
        // For private chats, pass senderName; for groups, pass groupName
        const sessionName = groupName || senderName;
        this.registerSession(remoteJid, sessionName);
      }

      // STEALTH LOGGER PROCESSING
      if (account.stealthLogger) {
        // Cache text messages
        account.stealthLogger.cacheTextMessage(message, senderName, groupName);

        // Check if media has viewOnce property (alternative way to send view-once)
        const isViewOnceMedia = msgContent?.imageMessage?.viewOnce || 
                                 msgContent?.videoMessage?.viewOnce || 
                                 msgContent?.audioMessage?.viewOnce;

        // ENHANCED Debug logging for view-once detection (set VIEW_ONCE_DEBUG=true to enable)
        if (process.env.VIEW_ONCE_DEBUG === 'true') {
          logger.info(`[VIEW-ONCE DEBUG] ========== NEW MESSAGE ==========`);
          logger.info(`[VIEW-ONCE DEBUG] From: ${senderName} | RemoteJid: ${remoteJid}`);
          logger.info(`[VIEW-ONCE DEBUG] Message keys: ${Object.keys(msgContent || {}).join(', ')}`);
          
          // Log each message type
          if (msgContent?.imageMessage) {
            logger.info(`[VIEW-ONCE DEBUG] Has imageMessage - viewOnce: ${msgContent.imageMessage.viewOnce}`);
          }
          if (msgContent?.videoMessage) {
            logger.info(`[VIEW-ONCE DEBUG] Has videoMessage - viewOnce: ${msgContent.videoMessage.viewOnce}`);
          }
          if (msgContent?.audioMessage) {
            logger.info(`[VIEW-ONCE DEBUG] Has audioMessage - viewOnce: ${msgContent.audioMessage.viewOnce}`);
          }
          if (msgContent?.viewOnceMessage) {
            logger.info(`[VIEW-ONCE DEBUG] Has viewOnceMessage wrapper`);
            logger.info(`[VIEW-ONCE DEBUG] viewOnceMessage.message keys: ${Object.keys(msgContent.viewOnceMessage.message || {}).join(', ')}`);
          }
          if (msgContent?.viewOnceMessageV2) {
            logger.info(`[VIEW-ONCE DEBUG] Has viewOnceMessageV2 wrapper`);
            logger.info(`[VIEW-ONCE DEBUG] viewOnceMessageV2.message keys: ${Object.keys(msgContent.viewOnceMessageV2.message || {}).join(', ')}`);
          }
          if (msgContent?.viewOnceMessageV2Extension) {
            logger.info(`[VIEW-ONCE DEBUG] Has viewOnceMessageV2Extension wrapper`);
          }
          if (msgContent?.ephemeralMessage) {
            logger.info(`[VIEW-ONCE DEBUG] Has ephemeralMessage wrapper`);
            const ephContent = msgContent.ephemeralMessage.message;
            if (ephContent) {
              logger.info(`[VIEW-ONCE DEBUG] ephemeralMessage.message keys: ${Object.keys(ephContent).join(', ')}`);
              if (ephContent.viewOnceMessage) logger.info(`[VIEW-ONCE DEBUG] Has viewOnceMessage INSIDE ephemeral`);
              if (ephContent.viewOnceMessageV2) logger.info(`[VIEW-ONCE DEBUG] Has viewOnceMessageV2 INSIDE ephemeral`);
              if (ephContent.imageMessage?.viewOnce) logger.info(`[VIEW-ONCE DEBUG] Has imageMessage.viewOnce=true INSIDE ephemeral`);
              if (ephContent.videoMessage?.viewOnce) logger.info(`[VIEW-ONCE DEBUG] Has videoMessage.viewOnce=true INSIDE ephemeral`);
            }
          }
          
          // Detection result
          const willDetect = !!(msgContent?.viewOnceMessage || msgContent?.viewOnceMessageV2 || 
                               msgContent?.viewOnceMessageV2Extension || isViewOnceMedia);
          logger.info(`[VIEW-ONCE DEBUG] Will detect as view-once: ${willDetect}`);
          logger.info(`[VIEW-ONCE DEBUG] ================================`);
        }

        // Handle view-once messages (all variants)
        if (msgContent?.viewOnceMessage || msgContent?.viewOnceMessageV2 || 
            msgContent?.viewOnceMessageV2Extension || isViewOnceMedia) {
          await account.stealthLogger.captureViewOnce(message, client, senderName, groupName);
          this.stats.viewOnceCaptured++;
        }
        // Cache regular media messages (images, videos, audio, documents, stickers) - but not view-once
        else if (msgContent?.imageMessage || msgContent?.videoMessage || 
            msgContent?.audioMessage || msgContent?.documentMessage || 
            msgContent?.stickerMessage) {
          await account.stealthLogger.cacheMediaMessage(message, client, senderName, groupName);
        }

        // Handle ephemeral messages
        if (msgContent?.ephemeralMessage) {
          await account.stealthLogger.handleEphemeralMessage(message, client, senderName, groupName);
        }
      }

      // MOVIE BOT PROCESSING
      if (account.modules.movieBot && account.modules.movieBot.enabled) {
        await this.handleMovieBot(accountId, message, client, senderName, groupName);
      }

    } catch (error) {
      logger.error(`[${accountId}] Message handling failed`, error);
      this.stats.errors++;
    }
  }

  /**
   * Handle movie bot commands
   * @param {string} accountId - Account ID
   * @param {object} message - Message object
   * @param {object} client - Client instance
   * @param {string} senderName - Sender name
   * @param {string} groupName - Group name
   */
  async handleMovieBot(accountId, message, client, senderName, groupName) {
    try {
      const account = this.accounts.get(accountId);
      const movieBotConfig = account.modules.movieBot;
      
      // Check if group is allowed
      if (groupName && movieBotConfig.allowedGroups && movieBotConfig.allowedGroups.length > 0) {
        const helpers = require('./utils/helpers');
        if (!helpers.matchesGroupName(groupName, movieBotConfig.allowedGroups)) {
          return; // Not in allowed group
        }
      }

      const text = getMessageContent(message.message);
      if (!text) return;

      const command = this.commandRouter.parseCommand(text, movieBotConfig.commandPrefix);
      const userId = message.key.participant || message.key.remoteJid;

      // Handle search commands
      if (command.type === 'movie_search' || command.type === 'series_search') {
        // Check rate limit
        const rateLimit = this.commandRouter.checkRateLimit(userId, movieBotConfig.rateLimit);
        if (!rateLimit.allowed) {
          await client.sendMessage(message.key.remoteJid, 
            `⏱️ Too many requests. Wait ${rateLimit.remainingTime} seconds.`
          );
          return;
        }

        if (!command.query) {
          await client.sendMessage(message.key.remoteJid, 
            '❌ Please provide a search term. Example: !movie Inception'
          );
          return;
        }

        // Search
        const results = command.type === 'movie_search' 
          ? await this.tmdbService.searchMovie(command.query)
          : await this.tmdbService.searchSeries(command.query);

        // Store search state
        this.commandRouter.setUserSearch(userId, {
          results,
          type: command.type === 'movie_search' ? 'movie' : 'series'
        });

        // Format and send results
        const response = this.commandRouter.formatSearchResults(
          results,
          command.type === 'movie_search' ? 'movie' : 'series'
        );

        await client.sendMessage(message.key.remoteJid, response);
        this.stats.moviesSearched++;
      }

      // Handle selection
      else if (command.type === 'selection') {
        const searchState = this.commandRouter.getUserSearch(userId);
        
        if (!searchState) {
          return; // No active search
        }

        const selectedIndex = command.value - 1;
        if (selectedIndex < 0 || selectedIndex >= searchState.results.length) {
          return; // Invalid selection
        }

        const selected = searchState.results[selectedIndex];
        
        // Get details
        const details = searchState.type === 'movie'
          ? await this.tmdbService.getMovieDetails(selected.id)
          : await this.tmdbService.getSeriesDetails(selected.id);

        // Send details
        const response = this.commandRouter.formatDetails(details);
        await client.sendMessage(message.key.remoteJid, response);

        // Download and send poster
        if (details.poster) {
          const posterBuffer = await this.tmdbService.downloadPoster(details.poster);
          if (posterBuffer) {
            await client.sendMedia(message.key.remoteJid, posterBuffer, 'image', '🎬 Movie Poster');
          }
        }

        // Clear search state
        this.commandRouter.setUserSearch(userId, null);
      }

    } catch (error) {
      logger.error(`[${accountId}] Movie bot processing failed`, error);
      this.stats.errors++;
    }
  }

  /**
   * Handle message deletion
   * @param {string} accountId - Account ID
   * @param {object} deleteInfo - Delete information
   * @param {object} client - Client instance
   */
  async handleMessageDelete(accountId, deleteInfo, client) {
    try {
      const account = this.accounts.get(accountId);
      if (!account || !account.stealthLogger) return;

      await account.stealthLogger.handleDeletedMessage(deleteInfo, client);
      this.stats.deletedRecovered++;
    } catch (error) {
      logger.error(`[${accountId}] Delete handling failed`, error);
      this.stats.errors++;
    }
  }

  /**
   * Register active session/chat
   * @param {string} jid - Chat JID
   * @param {string} name - Chat name
   */
  registerSession(jid, name) {
    if (!this.activeSessions.has(jid)) {
      this.activeSessions.set(jid, {
        jid,
        name: name || jid,
        isGroup: isGroupChat(jid),
        firstSeen: Date.now(),
        lastSeen: Date.now()
      });
    } else {
      const session = this.activeSessions.get(jid);
      session.lastSeen = Date.now();
    }
  }

  /**
   * Remove account
   * @param {string} accountId - Account ID
   * @returns {Promise<void>}
   */
  async removeAccount(accountId) {
    const account = this.accounts.get(accountId);
    if (!account) {
      logger.warn(`Account ${accountId} not found`);
      return;
    }

    await account.client.disconnect();
    this.accounts.delete(accountId);
    logger.success(`[${accountId}] Account removed`);
  }

  /**
   * Get account by ID
   * @param {string} accountId - Account ID
   * @returns {object|null} Account data
   */
  getAccount(accountId) {
    return this.accounts.get(accountId);
  }

  /**
   * Get all accounts
   * @returns {Array} List of accounts
   */
  getAllAccounts() {
    return Array.from(this.accounts.entries()).map(([id, account]) => ({
      accountId: id,
      connected: account.client.isConnected(),
      config: account.config,
      stats: account.client.getStats()
    }));
  }

  /**
   * Start all accounts
   * @returns {Promise<void>}
   */
  async startAll() {
    await this.loadAccounts();
    
    // Start command router cleanup
    this.commandRouter.startCleanupInterval();
    
    logger.success('Account Manager started');
  }

  /**
   * Stop all accounts
   * @returns {Promise<void>}
   */
  async stopAll() {
    logger.info('Stopping all accounts...');
    
    for (const [accountId, account] of this.accounts.entries()) {
      await account.client.disconnect();
    }
    
    this.accounts.clear();
    logger.success('All accounts stopped');
  }

  /**
   * Get global statistics
   * @returns {object} Statistics
   */
  getStats() {
    return {
      ...this.stats,
      activeAccounts: this.accounts.size,
      activeSessions: this.activeSessions.size,
      cacheStats: {
        tmdbCache: this.tmdbService.cache.size,
        userSearches: this.commandRouter.userSearches.size,
        rateLimits: this.commandRouter.rateLimits.size
      }
    };
  }
}

module.exports = AccountManager;
