#!/usr/bin/env node
require('dotenv').config();
const { program } = require('commander');
const inquirer = require('inquirer');
const fs = require('fs-extra');
const path = require('path');
const chalk = require('chalk');
const axios = require('axios');

/**
 * Show health dashboard URL
 */
function showHealth() {
  const port = process.env.HEALTH_CHECK_PORT || 8080;
  console.log(chalk.blue('\n📊 Health Dashboard\n'));
  console.log(chalk.green(`  URL: http://localhost:${port}/health`));
  console.log(chalk.gray(`  Accounts: http://localhost:${port}/accounts`));
  console.log(chalk.gray(`  Stats: http://localhost:${port}/stats\n`));
}

/**
 * Show statistics from health endpoint
 */
async function showStats() {
  try {
    const port = process.env.HEALTH_CHECK_PORT || 8080;
    const response = await axios.get(`http://localhost:${port}/stats`, { timeout: 5000 });
    
    console.log(chalk.blue('\n📊 Statistics\n'));
    console.log(chalk.gray('─'.repeat(50)));
    
    const stats = response.data;
    console.log(`  Messages Processed: ${chalk.green(stats.messagesProcessed)}`);
    console.log(`  Movies Searched: ${chalk.green(stats.moviesSearched)}`);
    console.log(`  Deleted Recovered: ${chalk.green(stats.deletedRecovered)}`);
    console.log(`  View-Once Captured: ${chalk.green(stats.viewOnceCaptured)}`);
    console.log(`  Status Captured: ${chalk.green(stats.statusCaptured)}`);
    console.log(`  Errors: ${chalk.red(stats.errors)}`);
    console.log(`  Active Accounts: ${chalk.cyan(stats.activeAccounts)}`);
    console.log(`  Active Sessions: ${chalk.cyan(stats.activeSessions)}`);
    
    console.log(chalk.gray('─'.repeat(50) + '\n'));
  } catch (error) {
    console.log(chalk.red('\n❌ Could not fetch stats. Is the bot running?\n'));
  }
}

/**
 * Clean old cache files
 */
async function cleanCache() {
  console.log(chalk.blue('\n🧹 Cleaning Cache\n'));
  
  const tempStorage = process.env.TEMP_STORAGE_PATH || './temp_storage';
  
  if (!await fs.pathExists(tempStorage)) {
    console.log(chalk.yellow('  No temp storage found\n'));
    return;
  }

  const files = await fs.readdir(tempStorage);
  const now = Date.now();
  let cleaned = 0;

  for (const file of files) {
    const filePath = path.join(tempStorage, file);
    const stats = await fs.stat(filePath);
    
    // Delete files older than 3 days
    if (now - stats.mtimeMs > 259200000) {
      await fs.remove(filePath);
      cleaned++;
    }
  }

  console.log(chalk.green(`  ✓ Cleaned ${cleaned} old file(s)\n`));
}

/**
 * Show system information
 */
function showSystem() {
  console.log(chalk.blue('\n💻 System Information\n'));
  console.log(chalk.gray('─'.repeat(50)));
  
  const memoryUsage = process.memoryUsage();
  console.log(`  Node Version: ${chalk.green(process.version)}`);
  console.log(`  Platform: ${chalk.green(process.platform)}`);
  console.log(`  Architecture: ${chalk.green(process.arch)}`);
  console.log(`  Memory (Heap): ${chalk.cyan(Math.round(memoryUsage.heapUsed / 1024 / 1024))} MB / ${Math.round(memoryUsage.heapTotal / 1024 / 1024)} MB`);
  console.log(`  Memory (RSS): ${chalk.cyan(Math.round(memoryUsage.rss / 1024 / 1024))} MB`);
  console.log(`  Uptime: ${chalk.cyan(Math.floor(process.uptime()))} seconds`);
  
  console.log(chalk.gray('─'.repeat(50) + '\n'));
}

/**
 * Test TMDB API connection with retry logic for transient network errors
 */
async function testTMDB() {
  console.log(chalk.blue('\n🎬 Testing TMDB API\n'));
  
  const apiKey = process.env.TMDB_API_KEY;
  
  if (!apiKey || apiKey === 'your_api_key_from_themoviedb.org') {
    console.log(chalk.red('  ❌ TMDB_API_KEY not configured in .env\n'));
    return;
  }

  const maxRetries = 3;
  const retryDelay = 2000; // 2 seconds between retries
  
  // Network error codes that are retryable
  const retryableErrors = ['ECONNRESET', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNREFUSED', 'EAI_AGAIN'];
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 1) {
        console.log(chalk.yellow(`  Retry attempt ${attempt}/${maxRetries}...`));
      }
      
      const start = Date.now();
      const response = await axios.get('https://api.themoviedb.org/3/configuration', {
        params: { api_key: apiKey },
        timeout: 15000 // Increased timeout
      });
      const duration = Date.now() - start;
      
      console.log(chalk.green(`  ✓ TMDB API connected successfully`));
      console.log(chalk.gray(`  Response time: ${duration}ms`));
      console.log(chalk.gray(`  Base URL: ${response.data.images.base_url}\n`));
      return; // Success, exit function
    } catch (error) {
      const isRetryable = retryableErrors.includes(error.code) || 
                          error.message?.includes('ECONNRESET') ||
                          error.message?.includes('timeout');
      
      if (error.response?.status === 401) {
        console.log(chalk.red('  ❌ Invalid API key\n'));
        return; // Don't retry invalid API key
      }
      
      if (isRetryable && attempt < maxRetries) {
        console.log(chalk.yellow(`  ⚠️  Network error (${error.code || error.message}), retrying in ${retryDelay/1000}s...`));
        await new Promise(resolve => setTimeout(resolve, retryDelay));
        continue;
      }
      
      // Final failure
      console.log(chalk.red(`  ❌ Connection failed: ${error.message}`));
      if (isRetryable) {
        console.log(chalk.yellow('\n  💡 This appears to be a network issue. Please check:'));
        console.log(chalk.gray('     - Your internet connection'));
        console.log(chalk.gray('     - Firewall/proxy settings'));
        console.log(chalk.gray('     - Try again in a few minutes\n'));
      } else {
        console.log('');
      }
    }
  }
}

/**
 * Validate configuration files
 */
async function validateConfig() {
  console.log(chalk.blue('\n✅ Validating Configuration\n'));
  
  let hasErrors = false;

  // Check .env
  if (!await fs.pathExists('.env')) {
    console.log(chalk.red('  ❌ .env file not found'));
    hasErrors = true;
  } else {
    console.log(chalk.green('  ✓ .env file exists'));
  }

  // Check TMDB API key
  if (!process.env.TMDB_API_KEY || process.env.TMDB_API_KEY === 'your_api_key_from_themoviedb.org') {
    console.log(chalk.red('  ❌ TMDB_API_KEY not configured'));
    hasErrors = true;
  } else {
    console.log(chalk.green('  ✓ TMDB_API_KEY configured'));
  }

  // Check accounts.json
  const accountsPath = path.join(process.cwd(), 'config', 'accounts.json');
  if (!await fs.pathExists(accountsPath)) {
    console.log(chalk.yellow('  ⚠️  accounts.json not found (will be created)'));
  } else {
    try {
      const config = await fs.readJSON(accountsPath);
      if (!config.accounts || !Array.isArray(config.accounts)) {
        console.log(chalk.red('  ❌ accounts.json is invalid'));
        hasErrors = true;
      } else {
        console.log(chalk.green(`  ✓ accounts.json valid (${config.accounts.length} account(s))`));
      }
    } catch (error) {
      console.log(chalk.red(`  ❌ accounts.json parse error: ${error.message}`));
      hasErrors = true;
    }
  }

  // Check directories
  const dirs = ['sessions', 'temp_storage', 'logs', 'config'];
  for (const dir of dirs) {
    if (!await fs.pathExists(dir)) {
      console.log(chalk.yellow(`  ⚠️  ${dir}/ directory missing (will be created)`));
    } else {
      console.log(chalk.green(`  ✓ ${dir}/ directory exists`));
    }
  }

  if (hasErrors) {
    console.log(chalk.red('\n❌ Configuration has errors\n'));
  } else {
    console.log(chalk.green('\n✅ Configuration is valid\n'));
  }
}

/**
 * Reset all sessions
 */
async function resetSessions() {
  const { confirm } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirm',
      message: chalk.yellow('This will delete all session files. Are you sure?'),
      default: false
    }
  ]);

  if (!confirm) {
    console.log(chalk.gray('\n  Cancelled\n'));
    return;
  }

  const sessionsPath = path.join(process.cwd(), 'sessions');
  
  if (await fs.pathExists(sessionsPath)) {
    await fs.remove(sessionsPath);
    await fs.ensureDir(sessionsPath);
    console.log(chalk.green('\n✅ All sessions deleted\n'));
    console.log(chalk.yellow('You will need to scan QR codes again when you start the bot\n'));
  } else {
    console.log(chalk.yellow('\n⚠️  No sessions directory found\n'));
  }
}

/**
 * Factory reset - delete everything
 */
async function factoryReset() {
  console.log(chalk.red('\n⚠️  FACTORY RESET - THIS CANNOT BE UNDONE\n'));
  
  const { confirm } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirm',
      message: chalk.red('Delete all data (sessions, logs, config)? This CANNOT be undone!'),
      default: false
    }
  ]);

  if (!confirm) {
    console.log(chalk.gray('\n  Cancelled\n'));
    return;
  }

  const { doubleConfirm } = await inquirer.prompt([
    {
      type: 'input',
      name: 'doubleConfirm',
      message: 'Type "DELETE" to confirm:',
      validate: (input) => input === 'DELETE' || 'You must type DELETE'
    }
  ]);

  if (doubleConfirm !== 'DELETE') {
    console.log(chalk.gray('\n  Cancelled\n'));
    return;
  }

  const pathsToDelete = [
    'sessions',
    'temp_storage',
    'logs',
    'config/accounts.json'
  ];

  for (const p of pathsToDelete) {
    const fullPath = path.join(process.cwd(), p);
    if (await fs.pathExists(fullPath)) {
      await fs.remove(fullPath);
      console.log(chalk.gray(`  Deleted ${p}`));
    }
  }

  console.log(chalk.green('\n✅ Factory reset complete\n'));
  console.log(chalk.yellow('The bot is now in a fresh state. Reconfigure with:\n'));
  console.log(chalk.cyan('  1. Copy .env.example to .env'));
  console.log(chalk.cyan('  2. Set TMDB_API_KEY in .env'));
  console.log(chalk.cyan('  3. Run: npm run account:add\n'));
}

// CLI setup
program
  .name('commands')
  .description('WhatsApp Hybrid Bot utility commands');

program
  .command('health')
  .description('Show health dashboard URL')
  .action(showHealth);

program
  .command('stats')
  .description('Show bot statistics')
  .action(showStats);

program
  .command('clean')
  .description('Clean old cache files')
  .action(cleanCache);

program
  .command('system')
  .description('Show system information')
  .action(showSystem);

program
  .command('test-tmdb')
  .description('Test TMDB API connection')
  .action(testTMDB);

program
  .command('validate')
  .description('Validate configuration')
  .action(validateConfig);

program
  .command('reset-sessions')
  .description('Delete all session files')
  .action(resetSessions);

program
  .command('factory-reset')
  .description('Factory reset (delete everything)')
  .action(factoryReset);

// If run directly
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    program.help();
  } else {
    program.parse(process.argv);
  }
}

module.exports = {
  showHealth,
  showStats,
  cleanCache,
  showSystem,
  testTMDB,
  validateConfig,
  resetSessions,
  factoryReset
};
