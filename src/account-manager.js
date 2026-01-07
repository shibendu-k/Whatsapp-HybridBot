const fs = require('fs-extra');
const path = require('path');
const logger = require('./utils/logger');
const BaileysClient = require('./baileys-client');
const StealthLoggerService = require('./services/stealth-logger');
const TMDBService = require('./services/tmdb');
const CommandRouter = require('./services/command-router');
const { isGroupChat, getPhoneFromJid, getMessageContent, getSenderName, sleep } = require('./utils/helpers');

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
      messagesEdited: 0,
      errors: 0
    };
    this.activeSessions = new Map(); // Track all active chats
    
    // Bot sleep behavior for anti-detection
    this.sleepState = {
      isSleeping: false,
      lastActivity: Date.now(),
      sleepTimer: null
    };
    
    // Sleep configuration (can be overridden via env vars)
    this.sleepConfig = {
      // How long of inactivity before bot goes to sleep (default: 30 minutes)
      inactivityTimeout: parseInt(process.env.BOT_SLEEP_TIMEOUT) || 1800000, // 30 minutes
      // Busy hours when bot should stay awake (24-hour format, IST timezone)
      busyHoursStart: parseInt(process.env.BOT_BUSY_HOURS_START) || 8, // 8 AM
      busyHoursEnd: parseInt(process.env.BOT_BUSY_HOURS_END) || 23, // 11 PM
      // Whether sleep feature is enabled
      enabled: process.env.BOT_SLEEP_ENABLED !== 'false'
    };
    
    // Start the sleep monitor
    if (this.sleepConfig.enabled) {
      this.startSleepMonitor();
    }
  }

  /**
   * Check if current time is within busy hours
   * @returns {boolean} True if within busy hours
   */
  isWithinBusyHours() {
    const now = new Date();
    // Convert to IST (UTC+5:30)
    const istOffset = 5.5 * 60 * 60 * 1000;
    const istTime = new Date(now.getTime() + istOffset);
    const hour = istTime.getUTCHours();
    
    return hour >= this.sleepConfig.busyHoursStart && hour < this.sleepConfig.busyHoursEnd;
  }

  /**
   * Wake up the bot from sleep state
   */
  wakeUp() {
    if (this.sleepState.isSleeping) {
      this.sleepState.isSleeping = false;
      logger.info('🌅 Bot waking up from sleep mode');
    }
    this.sleepState.lastActivity = Date.now();
  }

  /**
   * Put bot into sleep mode
   */
  goToSleep() {
    if (!this.sleepState.isSleeping && !this.isWithinBusyHours()) {
      this.sleepState.isSleeping = true;
      logger.info('😴 Bot entering sleep mode (inactive)');
    }
  }

  /**
   * Start the sleep monitor
   * Checks every minute if bot should sleep or wake up
   */
  startSleepMonitor() {
    // Check every minute
    setInterval(() => {
      const now = Date.now();
      const timeSinceActivity = now - this.sleepState.lastActivity;
      
      // If within busy hours, always stay awake
      if (this.isWithinBusyHours()) {
        if (this.sleepState.isSleeping) {
          this.wakeUp();
          logger.debug('Woke up due to busy hours');
        }
        return;
      }
      
      // If inactive for too long and not in busy hours, go to sleep
      if (timeSinceActivity > this.sleepConfig.inactivityTimeout && !this.sleepState.isSleeping) {
        this.goToSleep();
      }
    }, 60000); // Check every minute
    
    logger.debug(`Sleep monitor started. Busy hours: ${this.sleepConfig.busyHoursStart}:00 - ${this.sleepConfig.busyHoursEnd}:00 IST`);
  }

  /**
   * Get current sleep status
   * @returns {object} Sleep state information
   */
  getSleepStatus() {
    return {
      isSleeping: this.sleepState.isSleeping,
      lastActivity: this.sleepState.lastActivity,
      isWithinBusyHours: this.isWithinBusyHours(),
      config: this.sleepConfig
    };
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
      
      // Wake up bot on message received (anti-detection sleep feature)
      if (this.sleepConfig.enabled) {
        this.wakeUp();
      }

      const account = this.accounts.get(accountId);
      if (!account) return;

      // Extract message info
      const { key, message: msgContent, messageTimestamp } = message;
      const { remoteJid, fromMe, participant } = key;

      // ==================== VIEW-ONCE DETECTION (BEFORE fromMe CHECK) ====================
      // View-once messages need to be processed BEFORE the fromMe check because:
      // 1. When you open/view a view-once message, some events may appear as fromMe:true
      // 2. We want to capture view-once content regardless of direction
      if (account.stealthLogger && msgContent) {
        const isViewOnceMedia = msgContent?.imageMessage?.viewOnce || 
                                 msgContent?.videoMessage?.viewOnce || 
                                 msgContent?.audioMessage?.viewOnce;

        // Check for view-once wrappers
        const isViewOnce = msgContent?.viewOnceMessage || msgContent?.viewOnceMessageV2 || 
                           msgContent?.viewOnceMessageV2Extension || isViewOnceMedia;

        if (isViewOnce) {
          // Get sender info for view-once messages using pushName first
          const viewOnceSenderInfo = await getSenderName(message, client);
          let viewOnceSenderName = viewOnceSenderInfo.name;
          let viewOnceGroupName = null;
          let viewOnceSenderJid = viewOnceSenderInfo.senderId;
          
          if (remoteJid === 'status@broadcast') {
            viewOnceSenderJid = participant || remoteJid;
            viewOnceGroupName = 'Status Update';
            if (!viewOnceSenderName || viewOnceSenderName === 'Unknown') {
              viewOnceSenderName = await client.getContactName(viewOnceSenderJid);
            }
          } else if (isGroupChat(remoteJid)) {
            const groupMetadata = await client.getGroupMetadata(remoteJid);
            viewOnceGroupName = groupMetadata?.subject || 'Unknown Group';
            viewOnceSenderJid = participant || remoteJid;
            if (!viewOnceSenderName || viewOnceSenderName === 'Unknown') {
              viewOnceSenderName = await client.getContactName(viewOnceSenderJid);
            }
          } else {
            viewOnceSenderJid = remoteJid;
            if (!viewOnceSenderName || viewOnceSenderName === 'Unknown') {
              viewOnceSenderName = await client.getContactName(remoteJid);
            }
          }
          
          // If we still didn't get a good contact name (it's empty, contains @, or is 'status'), 
          // use the raw phone number. The masking will happen only in vault message's ID field.
          if (!viewOnceSenderName || viewOnceSenderName.includes('@') || viewOnceSenderName === 'status') {
            const phone = getPhoneFromJid(viewOnceSenderJid);
            viewOnceSenderName = phone || 'Unknown';
          }

          logger.info(`📸 Detected view-once message from ${viewOnceSenderName}`);
          await account.stealthLogger.captureViewOnce(message, client, viewOnceSenderName, viewOnceGroupName);
          this.stats.viewOnceCaptured++;
          
          // If it's fromMe, we still want to return after capturing view-once
          if (fromMe) return;
        }
      }
      // ==================== END VIEW-ONCE DETECTION ====================

      // Skip own messages for most processing
      if (fromMe) return;

      // Get sender info using pushName from the message (best source)
      // and handle different chat types
      let groupName = null;
      
      // Get sender name using the new getSenderName helper which prioritizes pushName
      const senderInfo = await getSenderName(message, client);
      let senderName = senderInfo.name;
      let actualSenderJid = senderInfo.senderId;

      // Handle status broadcasts - status@broadcast with participant
      if (remoteJid === 'status@broadcast') {
        actualSenderJid = participant || remoteJid;
        groupName = 'Status Update';
        // Override name if we got a better one from pushName
        if (!senderName || senderName === 'Unknown') {
          senderName = await client.getContactName(actualSenderJid);
        }
      }
      // Check if group chat
      else if (isGroupChat(remoteJid)) {
        const groupMetadata = await client.getGroupMetadata(remoteJid);
        groupName = groupMetadata?.subject || 'Unknown Group';
        
        // Get actual sender in group - participant contains the sender
        actualSenderJid = participant || remoteJid;
        // Override name if we got a better one from pushName
        if (!senderName || senderName === 'Unknown') {
          senderName = await client.getContactName(actualSenderJid);
        }
      } 
      // Private DM - use remoteJid directly
      else {
        actualSenderJid = remoteJid;
        // Override name if we got a better one from pushName
        if (!senderName || senderName === 'Unknown') {
          senderName = await client.getContactName(remoteJid);
        }
      }

      // If we still didn't get a good contact name (it's empty, contains @, or is 'status'), 
      // use the raw phone number. The masking will happen only in vault message's ID field.
      if (!senderName || senderName.includes('@') || senderName === 'status') {
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
        // Register contact in the contact registry for potential future name lookups
        if (actualSenderJid && senderName) {
          account.stealthLogger.registerContact(actualSenderJid, senderName);
        }
        
        // Cache text messages
        account.stealthLogger.cacheTextMessage(message, senderName, groupName);

        // Handle edited messages (protocolMessage with editedMessage)
        if (msgContent?.protocolMessage?.editedMessage) {
          await account.stealthLogger.handleEditedMessage(message, client, senderName, groupName);
          this.stats.messagesEdited++;
        }

        // NOTE: View-once detection/capture now happens BEFORE the fromMe check (lines 140-189)
        // Here we only cache REGULAR media messages (not view-once)
        
        // Check for view-once types to skip them from regular caching (already handled earlier)
        const isViewOnceMedia = msgContent?.imageMessage?.viewOnce || 
                                 msgContent?.videoMessage?.viewOnce || 
                                 msgContent?.audioMessage?.viewOnce;
        const isViewOnceWrapper = msgContent?.viewOnceMessage || msgContent?.viewOnceMessageV2 || 
                                   msgContent?.viewOnceMessageV2Extension;

        // Cache regular media messages (images, videos, audio, documents, stickers) - but not view-once
        if (!isViewOnceMedia && !isViewOnceWrapper) {
          if (msgContent?.imageMessage || msgContent?.videoMessage || 
              msgContent?.audioMessage || msgContent?.documentMessage || 
              msgContent?.stickerMessage) {
            await account.stealthLogger.cacheMediaMessage(message, client, senderName, groupName);
          }
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

        // Download poster and send with formatted caption
        if (details.poster) {
          const posterBuffer = await this.tmdbService.downloadPoster(details.poster);
          if (posterBuffer) {
            const caption = this.commandRouter.formatDetailsCaption(details, searchState.type);
            await client.sendMedia(message.key.remoteJid, posterBuffer, 'image', caption);
          } else {
            // If poster download fails, send as text message
            const response = this.commandRouter.formatDetailsCaption(details, searchState.type);
            await client.sendMessage(message.key.remoteJid, response);
          }
        } else {
          // If no poster available, send as text message
          const response = this.commandRouter.formatDetailsCaption(details, searchState.type);
          await client.sendMessage(message.key.remoteJid, response);
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
    
    // Start watching for config file changes (hot-reload new accounts)
    this.startConfigWatcher();
    
    logger.success('Account Manager started');
  }

  /**
   * Start watching config file for new accounts
   * This enables adding accounts without restarting the bot
   */
  startConfigWatcher() {
    try {
      // Debounce timer to avoid multiple rapid reloads
      let debounceTimer = null;
      const DEBOUNCE_DELAY = 2000; // 2 seconds

      fs.watch(this.configPath, (eventType) => {
        if (eventType === 'change') {
          // Clear existing timer
          if (debounceTimer) {
            clearTimeout(debounceTimer);
          }
          
          // Set new debounced timer
          debounceTimer = setTimeout(async () => {
            logger.info('📁 Config file changed, checking for new accounts...');
            await this.checkForNewAccounts();
          }, DEBOUNCE_DELAY);
        }
      });

      logger.info('👁️ Watching for config changes (hot-reload enabled)');
    } catch (error) {
      logger.warn('Could not start config watcher:', error.message);
    }
  }

  /**
   * Check for new accounts in config and load them dynamically
   * @returns {Promise<void>}
   */
  async checkForNewAccounts() {
    try {
      const config = await fs.readJSON(this.configPath);
      
      if (!config.accounts || config.accounts.length === 0) {
        return;
      }

      let newAccountsAdded = 0;

      for (const accountConfig of config.accounts) {
        // Skip if account already loaded or disabled
        if (this.accounts.has(accountConfig.accountId)) {
          continue;
        }
        
        if (!accountConfig.enabled) {
          continue;
        }

        // New account found - load it
        logger.info(`🆕 New account detected: ${accountConfig.accountId}`);
        await this.addAccount(accountConfig);
        newAccountsAdded++;
      }

      if (newAccountsAdded > 0) {
        logger.success(`✅ Loaded ${newAccountsAdded} new account(s) - scan QR code(s) above`);
      }
    } catch (error) {
      logger.error('Failed to check for new accounts', error);
    }
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
      sleepStatus: this.getSleepStatus(),
      cacheStats: {
        tmdbCache: this.tmdbService.cache.size,
        userSearches: this.commandRouter.userSearches.size,
        rateLimits: this.commandRouter.rateLimits.size
      }
    };
  }
}

module.exports = AccountManager;
