#!/usr/bin/env node
const { program } = require('commander');
const inquirer = require('inquirer');
const fs = require('fs-extra');
const path = require('path');
const chalk = require('chalk');

const configPath = path.join(process.cwd(), 'config', 'accounts.json');

/**
 * Load accounts configuration
 */
async function loadConfig() {
  if (!await fs.pathExists(configPath)) {
    return { accounts: [] };
  }
  return await fs.readJSON(configPath);
}

/**
 * Save accounts configuration
 */
async function saveConfig(config) {
  await fs.ensureDir(path.dirname(configPath));
  await fs.writeJSON(configPath, config, { spaces: 2 });
}

/**
 * Add new account
 */
async function addAccount() {
  console.log(chalk.blue('\n🤖 Add New Account\n'));

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'accountId',
      message: 'Account ID (unique identifier):',
      validate: (input) => {
        if (!input || input.trim().length === 0) {
          return 'Account ID is required';
        }
        if (!/^[a-zA-Z0-9_-]+$/.test(input)) {
          return 'Account ID can only contain letters, numbers, underscores and hyphens';
        }
        return true;
      }
    },
    {
      type: 'input',
      name: 'vaultNumber',
      message: 'Vault phone number (with country code, e.g., +919876543210):',
      validate: (input) => {
        if (!input || !input.startsWith('+')) {
          return 'Phone number must start with + and country code';
        }
        if (!/^\+\d{10,15}$/.test(input)) {
          return 'Invalid phone number format';
        }
        return true;
      }
    },
    {
      type: 'input',
      name: 'description',
      message: 'Account description (optional):',
      default: 'WhatsApp Account'
    },
    {
      type: 'confirm',
      name: 'enableMovieBot',
      message: 'Enable Movie Bot module?',
      default: true
    },
    {
      type: 'input',
      name: 'allowedGroups',
      message: 'Allowed groups for Movie Bot (comma-separated, leave empty for all):',
      default: '',
      when: (answers) => answers.enableMovieBot
    },
    {
      type: 'confirm',
      name: 'enableStealthLogger',
      message: 'Enable Stealth Logger module?',
      default: true
    },
    {
      type: 'input',
      name: 'excludedGroups',
      message: 'Excluded groups for Stealth Logger (comma-separated):',
      default: '',
      when: (answers) => answers.enableStealthLogger
    }
  ]);

  const config = await loadConfig();

  // Check if account ID already exists
  if (config.accounts.find(acc => acc.accountId === answers.accountId)) {
    console.log(chalk.red(`\n❌ Account ID '${answers.accountId}' already exists!\n`));
    return;
  }

  // Create account configuration
  const newAccount = {
    accountId: answers.accountId,
    enabled: true,
    vaultNumber: answers.vaultNumber,
    description: answers.description,
    modules: {
      movieBot: {
        enabled: answers.enableMovieBot,
        allowedGroups: answers.allowedGroups 
          ? answers.allowedGroups.split(',').map(g => g.trim()).filter(g => g.length > 0)
          : [],
        commandPrefix: '!',
        rateLimit: {
          maxRequests: 10,
          windowMs: 60000
        },
        timeout: 20000,
        maxRetries: 10
      },
      stealthLogger: {
        enabled: answers.enableStealthLogger,
        excludedGroups: answers.excludedGroups
          ? answers.excludedGroups.split(',').map(g => g.trim()).filter(g => g.length > 0)
          : [],
        statusCacheDuration: 86400000,
        mediaCacheDuration: 244800000,
        maxFileSize: 157286400,
        maxTextCache: 5000
      }
    }
  };

  config.accounts.push(newAccount);
  await saveConfig(config);

  console.log(chalk.green(`\n✅ Account '${answers.accountId}' added successfully!\n`));
  console.log(chalk.cyan('If the bot is already running, a QR code will appear automatically in the bot console.'));
  console.log(chalk.cyan('If the bot is not running, start it with: npm run start\n'));
}

/**
 * List all accounts
 */
async function listAccounts() {
  const config = await loadConfig();

  if (config.accounts.length === 0) {
    console.log(chalk.yellow('\n📭 No accounts configured\n'));
    console.log(chalk.cyan('Add an account with: npm run account:add\n'));
    return;
  }

  console.log(chalk.blue('\n🤖 Configured Accounts\n'));
  console.log(chalk.gray('─'.repeat(80)));

  config.accounts.forEach((account, index) => {
    const status = account.enabled 
      ? chalk.green('● ENABLED') 
      : chalk.red('○ DISABLED');
    
    console.log(`\n${chalk.bold(account.accountId)} ${status}`);
    console.log(`  Description: ${account.description}`);
    console.log(`  Vault: ${account.vaultNumber}`);
    console.log(`  Movie Bot: ${account.modules.movieBot.enabled ? chalk.green('✓') : chalk.gray('✗')}`);
    console.log(`  Stealth Logger: ${account.modules.stealthLogger.enabled ? chalk.green('✓') : chalk.gray('✗')}`);
  });

  console.log(chalk.gray('\n' + '─'.repeat(80) + '\n'));
}

/**
 * Edit account
 */
async function editAccount() {
  const config = await loadConfig();

  if (config.accounts.length === 0) {
    console.log(chalk.yellow('\n📭 No accounts to edit\n'));
    return;
  }

  const { accountId } = await inquirer.prompt([
    {
      type: 'list',
      name: 'accountId',
      message: 'Select account to edit:',
      choices: config.accounts.map(acc => ({
        name: `${acc.accountId} - ${acc.description}`,
        value: acc.accountId
      }))
    }
  ]);

  const account = config.accounts.find(acc => acc.accountId === accountId);
  if (!account) {
    console.log(chalk.red('\n❌ Account not found\n'));
    return;
  }

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'vaultNumber',
      message: 'Vault phone number:',
      default: account.vaultNumber
    },
    {
      type: 'input',
      name: 'description',
      message: 'Description:',
      default: account.description
    },
    {
      type: 'confirm',
      name: 'enableMovieBot',
      message: 'Enable Movie Bot?',
      default: account.modules.movieBot.enabled
    },
    {
      type: 'confirm',
      name: 'enableStealthLogger',
      message: 'Enable Stealth Logger?',
      default: account.modules.stealthLogger.enabled
    }
  ]);

  // Update account
  account.vaultNumber = answers.vaultNumber;
  account.description = answers.description;
  account.modules.movieBot.enabled = answers.enableMovieBot;
  account.modules.stealthLogger.enabled = answers.enableStealthLogger;

  await saveConfig(config);

  console.log(chalk.green(`\n✅ Account '${accountId}' updated successfully!\n`));
  console.log(chalk.yellow('Restart the bot for changes to take effect: npm run restart\n'));
}

/**
 * Enable account
 */
async function enableAccount(accountId) {
  const config = await loadConfig();
  const account = config.accounts.find(acc => acc.accountId === accountId);

  if (!account) {
    console.log(chalk.red(`\n❌ Account '${accountId}' not found\n`));
    return;
  }

  if (account.enabled) {
    console.log(chalk.yellow(`\n⚠️  Account '${accountId}' is already enabled\n`));
    return;
  }

  account.enabled = true;
  await saveConfig(config);

  console.log(chalk.green(`\n✅ Account '${accountId}' enabled\n`));
  console.log(chalk.yellow('Restart the bot: npm run restart\n'));
}

/**
 * Disable account
 */
async function disableAccount(accountId) {
  const config = await loadConfig();
  const account = config.accounts.find(acc => acc.accountId === accountId);

  if (!account) {
    console.log(chalk.red(`\n❌ Account '${accountId}' not found\n`));
    return;
  }

  if (!account.enabled) {
    console.log(chalk.yellow(`\n⚠️  Account '${accountId}' is already disabled\n`));
    return;
  }

  account.enabled = false;
  await saveConfig(config);

  console.log(chalk.green(`\n✅ Account '${accountId}' disabled\n`));
  console.log(chalk.yellow('Restart the bot: npm run restart\n'));
}

/**
 * Remove account
 */
async function removeAccount(accountId) {
  const config = await loadConfig();
  const accountIndex = config.accounts.findIndex(acc => acc.accountId === accountId);

  if (accountIndex === -1) {
    console.log(chalk.red(`\n❌ Account '${accountId}' not found\n`));
    return;
  }

  const { confirm } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirm',
      message: chalk.yellow(`Are you sure you want to remove account '${accountId}'?`),
      default: false
    }
  ]);

  if (!confirm) {
    console.log(chalk.gray('\n  Cancelled\n'));
    return;
  }

  const { deleteSession } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'deleteSession',
      message: 'Also delete session files?',
      default: false
    }
  ]);

  config.accounts.splice(accountIndex, 1);
  await saveConfig(config);

  if (deleteSession) {
    const sessionPath = path.join(process.cwd(), 'sessions', accountId);
    if (await fs.pathExists(sessionPath)) {
      await fs.remove(sessionPath);
      console.log(chalk.gray(`  Session files deleted`));
    }
  }

  console.log(chalk.green(`\n✅ Account '${accountId}' removed\n`));
}

// CLI setup
program
  .name('account')
  .description('Manage WhatsApp bot accounts');

program
  .command('add')
  .description('Add a new account')
  .action(addAccount);

program
  .command('list')
  .description('List all accounts')
  .action(listAccounts);

program
  .command('edit')
  .description('Edit an account')
  .action(editAccount);

program
  .command('enable <accountId>')
  .description('Enable an account')
  .action(enableAccount);

program
  .command('disable <accountId>')
  .description('Disable an account')
  .action(disableAccount);

program
  .command('remove <accountId>')
  .description('Remove an account')
  .action(removeAccount);

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
  addAccount,
  listAccounts,
  editAccount,
  enableAccount,
  disableAccount,
  removeAccount
};
