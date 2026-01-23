require('dotenv').config();
const dns = require('dns');
const logger = require('./utils/logger');
const { validateEnv, ensureDirectories, ensureAccountsConfig } = require('./utils/validators');
const AccountManager = require('./account-manager');
const HealthMonitor = require('./services/health-monitor');

// Suppress verbose libsignal error messages from Baileys
// These are internal Signal protocol session errors that are expected in multi-account setups
// The application handles these errors gracefully, so we filter the console output
const originalConsoleError = console.error;

// More specific patterns that uniquely identify libsignal errors from Baileys
const LIBSIGNAL_ERROR_PATTERNS = [
  // Match the exact error message format from libsignal
  /^Failed to decrypt message$/,
  /^with any known session\.\.\.$/,
  /^Session error:Error: Bad MAC Error: Bad MAC$/,
  // Match libsignal stack traces (these have very specific paths)
  /at Object\.verifyMAC \(.*\/libsignal\/src\/crypto\.js/,
  /at SessionCipher\.doDecryptWhisperMessage \(.*\/libsignal\/src\/session_cipher\.js/,
  /at async SessionCipher\.decryptWithSessions \(.*\/libsignal\/src\/session_cipher\.js/,
  /at async _asyncQueueExecutor \(.*\/libsignal\/src\/queue_job\.js/,
  // Match session closing messages
  /^Closing open session in favor of incoming prekey bundle$/,
  /^Closing session: SessionEntry \{$/,
  // Match session detail output lines (very specific format with leading whitespace)
  /^\s{2,}_chains: \{$/,
  /^\s{2,}registrationId: \d+,$/,
  /^\s{2,}currentRatchet: \{$/,
  /^\s{2,}ephemeralKeyPair: \{$/,
  /^\s{2,}'[A-Za-z0-9+/=]+': \{ chainKey: \[Object\], chainType: \d+, messageKeys: \{\} \},?$/,
  /^\s{2,}pubKey: <Buffer/,
  /^\s{2,}privKey: <Buffer/,
  /^\s{2,}lastRemoteEphemeralKey: <Buffer/,
  /^\s{2,}previousCounter: \d+,$/,
  /^\s{2,}rootKey: <Buffer/,
  /^\s{2,}baseKey: <Buffer/,
  /^\s{2,}baseKeyType: \d+,$/,
  /^\s{2,}closed: -?\d+,$/,
  /^\s{2,}used: \d+,$/,
  /^\s{2,}created: \d+,$/,
  /^\s{2,}remoteIdentityKey: <Buffer/,
  /^\s{2,}\}$/,
  /^\s{2,}\},$/
];

// Number of lines to suppress after detecting a libsignal error (covers stack trace)
const SUPPRESSION_LINE_COUNT = 10;

// Simple approach: if we see a libsignal error, suppress the next few lines as they're likely stack trace
// Note: Node.js is single-threaded for JS execution, so this simple counter is safe
let suppressNextLines = 0;

console.error = function(...args) {
  const message = args.join(' ');
  
  // Check if this message matches any libsignal error pattern
  const isLibsignalError = LIBSIGNAL_ERROR_PATTERNS.some(pattern => pattern.test(message));
  
  if (isLibsignalError) {
    // Start suppressing this line and the next several (stack trace continuation)
    suppressNextLines = SUPPRESSION_LINE_COUNT;
    return;
  }
  
  // If we're currently suppressing, decrement and skip this line
  if (suppressNextLines > 0) {
    suppressNextLines--;
    return;
  }
  
  // Pass through all other errors
  originalConsoleError.apply(console, args);
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
      // Log more details for debugging
      if (error.stack) {
        logger.error(`Stack: ${error.stack}`);
      }
      
      // Use the isRetryableError helper to check if this is a transient network error
      const { isRetryableError } = require('./utils/helpers');
      if (isRetryableError(error)) {
        logger.warn('Network-related error - bot will continue running');
      } else {
        this.shutdown();
      }
    });

    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled rejection', reason);
      // Log more details for debugging
      if (reason && reason.stack) {
        logger.error(`Rejection stack: ${reason.stack}`);
      }
      // Don't shutdown for unhandled rejections - just log them
      // This prevents crashes from transient API errors
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
