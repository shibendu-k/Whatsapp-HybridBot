require('dotenv').config();
const dns = require('dns');
const logger = require('./utils/logger');
const { validateEnv, ensureDirectories, ensureAccountsConfig } = require('./utils/validators');
const AccountManager = require('./account-manager');
const HealthMonitor = require('./services/health-monitor');

// Suppress verbose libsignal error messages
// These are internal Signal protocol session errors that are expected in multi-account setups
// The application handles these errors gracefully, so we filter the console output
const originalConsoleError = console.error;
const originalConsoleLog = console.log;

const LIBSIGNAL_ERROR_PATTERNS = [
  /Failed to decrypt message/i,
  /with any known session/i,
  /Session error:Error: Bad MAC/i,
  /at Object\.verifyMAC/i,
  /at SessionCipher\.doDecryptWhisperMessage/i,
  /at async SessionCipher\.decryptWithSessions/i,
  /at async _asyncQueueExecutor/i,
  /Closing open session in favor of incoming prekey bundle/i,
  /Closing session: SessionEntry/i,
  /_chains:/i,
  /registrationId:/i,
  /currentRatchet:/i,
  /ephemeralKeyPair:/i,
  /chainKey: \[Object\]/i,
  /chainType:/i
];

// Track if we're in a libsignal error block
let suppressingLibsignalError = false;

console.error = function(...args) {
  const message = args.join(' ');
  
  // Check if this message matches any libsignal error pattern
  const isLibsignalError = LIBSIGNAL_ERROR_PATTERNS.some(pattern => pattern.test(message));
  
  if (isLibsignalError) {
    suppressingLibsignalError = true;
    // Don't log this error - it's already handled by the application
    return;
  }
  
  // Reset suppression flag if we see a non-libsignal message
  if (suppressingLibsignalError && !message.includes('  ') && message.length > 0) {
    suppressingLibsignalError = false;
  }
  
  // If we're still in a libsignal error block (stack trace), skip it
  if (suppressingLibsignalError) {
    return;
  }
  
  // Pass through all other errors
  originalConsoleError.apply(console, args);
};

console.log = function(...args) {
  const message = args.join(' ');
  
  // Check if this is part of a libsignal error output
  const isLibsignalError = LIBSIGNAL_ERROR_PATTERNS.some(pattern => pattern.test(message));
  
  if (isLibsignalError) {
    suppressingLibsignalError = true;
    return;
  }
  
  // Reset suppression flag if we see a normal message
  if (suppressingLibsignalError && !message.includes('  ') && message.length > 0) {
    suppressingLibsignalError = false;
  }
  
  // If we're in a libsignal error block, skip it
  if (suppressingLibsignalError) {
    return;
  }
  
  // Pass through all other logs
  originalConsoleLog.apply(console, args);
};

// Set IPv4 first for better network performance
if (dns.setDefaultResultOrder) {
  try {
    dns.setDefaultResultOrder('ipv4first');
    logger.debug('DNS: IPv4 preference set');
  } catch (error) {
    logger.debug('DNS: Could not set IPv4 preference');
  }
}

class WhatsAppHybridBot {
  constructor() {
    this.accountManager = null;
    this.healthMonitor = null;
    this.isShuttingDown = false;
  }

  /**
   * Initialize the bot
   */
  async initialize() {
    try {
      logger.system('╔════════════════════════════════════════╗');
      logger.system('║  WhatsApp Hybrid Bot v3.2 - Baileys  ║');
      logger.system('╚════════════════════════════════════════╝');
      logger.info('');

      // Validate environment
      logger.info('Validating environment...');
      const envValidation = validateEnv();
      
      if (!envValidation.valid) {
        logger.error('Environment validation failed:');
        envValidation.errors.forEach(error => logger.error(`  - ${error}`));
        process.exit(1);
      }

      if (envValidation.warnings.length > 0) {
        envValidation.warnings.forEach(warning => logger.warn(warning));
      }

      logger.success('Environment validated');

      // Ensure directories exist
      logger.info('Setting up directories...');
      await ensureDirectories();
      await ensureAccountsConfig();

      // Initialize account manager
      logger.info('Initializing account manager...');
      this.accountManager = new AccountManager();
      
      // Start all accounts
      await this.accountManager.startAll();

      // Start health monitor if enabled
      if (process.env.ENABLE_HEALTH_CHECK !== 'false') {
        logger.info('Starting health monitor...');
        this.healthMonitor = new HealthMonitor(this.accountManager);
        await this.healthMonitor.start();
      }

      logger.success('');
      logger.success('✅ WhatsApp Hybrid Bot is running!');
      logger.info('');
      
      if (this.healthMonitor) {
        logger.info(`📊 Health Dashboard: http://localhost:${process.env.HEALTH_CHECK_PORT || 8080}/health`);
      }
      
      logger.info('Press Ctrl+C to stop');
      logger.info('');

      // Start periodic stats logging (every 6 hours)
      this.statsInterval = setInterval(() => {
        const stats = this.accountManager.getStats();
        logger.info(`📊 Stats: Movies=${stats.moviesSearched}, Deleted=${stats.deletedRecovered}, ViewOnce=${stats.viewOnceCaptured}, StatusAutoDelete=${stats.statusAutoDeleted}`);
      }, 6 * 60 * 60 * 1000);

      // Signal PM2 that we're ready
      if (process.send) {
        process.send('ready');
      }

    } catch (error) {
      logger.error('Initialization failed', error);
      process.exit(1);
    }
  }

  /**
   * Graceful shutdown
   */
  async shutdown() {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;

    logger.info('');
    logger.warn('Shutting down gracefully...');

    try {
      // Clear intervals
      if (this.statsInterval) {
        clearInterval(this.statsInterval);
      }

      // Stop health monitor
      if (this.healthMonitor) {
        logger.info('Stopping health monitor...');
        await this.healthMonitor.stop();
      }

      // Stop all accounts
      if (this.accountManager) {
        logger.info('Stopping all accounts...');
        await this.accountManager.stopAll();
      }

      logger.success('Shutdown complete');
      process.exit(0);
    } catch (error) {
      logger.error('Error during shutdown', error);
      process.exit(1);
    }
  }

  /**
   * Setup signal handlers
   */
  setupSignalHandlers() {
    process.on('SIGINT', () => {
      logger.warn('\nReceived SIGINT signal');
      this.shutdown();
    });

    process.on('SIGTERM', () => {
      logger.warn('\nReceived SIGTERM signal');
      this.shutdown();
    });

    process.on('uncaughtException', (error) => {
      logger.error('Uncaught exception', error);
      this.shutdown();
    });

    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled rejection', reason);
    });
  }

  /**
   * Start the bot
   */
  async start() {
    this.setupSignalHandlers();
    await this.initialize();
  }
}

// Start the bot if run directly
if (require.main === module) {
  const bot = new WhatsAppHybridBot();
  bot.start().catch((error) => {
    logger.error('Failed to start bot', error);
    process.exit(1);
  });
}

module.exports = WhatsAppHybridBot;
