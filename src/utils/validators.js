const fs = require('fs-extra');
const path = require('path');
const logger = require('./logger');

/**
 * Validate environment variables
 * @returns {object} Validation result
 */
function validateEnv() {
  const errors = [];
  const warnings = [];

  // Required variables
  if (!process.env.TMDB_API_KEY || process.env.TMDB_API_KEY === 'your_api_key_from_themoviedb.org') {
    errors.push('TMDB_API_KEY is not set or using example value');
  }

  // Optional but recommended
  if (!process.env.HEALTH_CHECK_PORT) {
    warnings.push('HEALTH_CHECK_PORT not set, using default 8080');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Validate accounts configuration
 * @param {object} config - Accounts configuration
 * @returns {object} Validation result
 */
function validateAccountsConfig(config) {
  const errors = [];
  
  if (!config || !config.accounts) {
    errors.push('accounts.json must have an "accounts" array');
    return { valid: false, errors };
  }

  if (!Array.isArray(config.accounts)) {
    errors.push('"accounts" must be an array');
    return { valid: false, errors };
  }

  config.accounts.forEach((account, index) => {
    const prefix = `Account ${index + 1}`;
    
    if (!account.accountId) {
      errors.push(`${prefix}: accountId is required`);
    }
    
    if (typeof account.enabled !== 'boolean') {
      errors.push(`${prefix}: enabled must be a boolean`);
    }
    
    if (!account.vaultNumber) {
      errors.push(`${prefix}: vaultNumber is required`);
    }
    
    if (!account.modules) {
      errors.push(`${prefix}: modules configuration is required`);
    }
  });

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Validate phone number format
 * @param {string} phone - Phone number
 * @returns {boolean} True if valid
 */
function isValidPhoneNumber(phone) {
  if (!phone) return false;
  // Basic validation: starts with + and contains digits
  return /^\+\d{10,15}$/.test(phone);
}

/**
 * Validate configuration file exists and is readable
 * @param {string} filePath - Path to config file
 * @returns {object} Validation result
 */
async function validateConfigFile(filePath) {
  const errors = [];
  
  try {
    if (!await fs.pathExists(filePath)) {
      errors.push(`Configuration file not found: ${filePath}`);
      return { valid: false, errors };
    }

    const content = await fs.readJSON(filePath);
    
    if (filePath.includes('accounts')) {
      return validateAccountsConfig(content);
    }
    
    return { valid: true, errors: [] };
  } catch (error) {
    errors.push(`Failed to read/parse configuration: ${error.message}`);
    return { valid: false, errors };
  }
}

/**
 * Ensure required directories exist
 * @returns {Promise<void>}
 */
async function ensureDirectories() {
  const directories = [
    process.env.TEMP_STORAGE_PATH || './temp_storage',
    process.env.LOGS_PATH || './logs',
    process.env.SESSIONS_PATH || './sessions',
    './config'
  ];

  for (const dir of directories) {
    await fs.ensureDir(dir);
  }
  
  logger.success('All required directories created/verified');
}

/**
 * Create default accounts.json if it doesn't exist
 * @returns {Promise<void>}
 */
async function ensureAccountsConfig() {
  const accountsPath = path.join(process.cwd(), 'config', 'accounts.json');
  const examplePath = path.join(process.cwd(), 'config', 'accounts.example.json');
  
  if (!await fs.pathExists(accountsPath)) {
    if (await fs.pathExists(examplePath)) {
      await fs.copy(examplePath, accountsPath);
      logger.info('Created accounts.json from example template');
    } else {
      // Create minimal config
      const minimalConfig = {
        accounts: []
      };
      await fs.writeJSON(accountsPath, minimalConfig, { spaces: 2 });
      logger.info('Created empty accounts.json');
    }
  }
}

module.exports = {
  validateEnv,
  validateAccountsConfig,
  isValidPhoneNumber,
  validateConfigFile,
  ensureDirectories,
  ensureAccountsConfig
};
