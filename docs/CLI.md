# 🎯 CLI Reference - WhatsApp Hybrid Bot v3.2

Complete reference for all command-line interface commands.

## Quick Reference

```bash
# Account Management
npm run account:add            # Add new account
npm run account:list          # List all accounts
npm run account:edit          # Edit account
npm run account:enable <id>   # Enable account
npm run account:disable <id>  # Disable account
npm run account:remove <id>   # Remove account

# Bot Control
npm start                     # Start in foreground
npm run start:pm2            # Start with PM2
npm run stop                 # Stop PM2 process
npm run restart              # Restart with PM2
npm run logs                 # Show PM2 logs
npm run status               # Show PM2 status

# Utilities
npm run health               # Show health dashboard URL
npm run stats                # Show statistics
npm run system               # System information
npm run clean                # Clean old cache
npm run test:tmdb           # Test TMDB API
npm run validate:config     # Validate configuration
npm run reset:sessions      # Delete all sessions
npm run factory:reset       # Factory reset (delete all)
```

## Account Management Commands

### account:add

Add a new WhatsApp account interactively.

**Usage:**
```bash
npm run account:add
```

**Interactive Prompts:**
1. Account ID (unique identifier)
2. Vault phone number
3. Description
4. Enable Movie Bot? (y/n)
5. Allowed groups (comma-separated)
6. Enable Stealth Logger? (y/n)
7. Excluded groups (comma-separated)

**Example:**
```bash
$ npm run account:add

🤖 Add New Account

? Account ID: personal
? Vault phone number: +919876543210
? Account description: Personal Account
? Enable Movie Bot module? Yes
? Allowed groups for Movie Bot: Movies, Cinema
? Enable Stealth Logger module? Yes
? Excluded groups for Stealth Logger: Family, Work

✅ Account 'personal' added successfully!

To connect this account, run: npm run start
The bot will show a QR code for you to scan.
```

### account:list

List all configured accounts with their status.

**Usage:**
```bash
npm run account:list
```

**Output:**
```bash
🤖 Configured Accounts
────────────────────────────────────────────────────────────────

personal ● ENABLED
  Description: Personal Account
  Vault: +919876543210
  Movie Bot: ✓
  Stealth Logger: ✓

work ○ DISABLED
  Description: Work Account
  Vault: +919876543211
  Movie Bot: ✗
  Stealth Logger: ✓

────────────────────────────────────────────────────────────────
```

### account:edit

Edit an existing account configuration.

**Usage:**
```bash
npm run account:edit
```

**Interactive:**
1. Select account from list
2. Update vault number
3. Update description
4. Enable/disable Movie Bot
5. Enable/disable Stealth Logger

**Example:**
```bash
$ npm run account:edit

? Select account to edit: personal - Personal Account
? Vault phone number: +919876543210
? Description: Personal Account - Updated
? Enable Movie Bot? Yes
? Enable Stealth Logger? Yes

✅ Account 'personal' updated successfully!
Restart the bot for changes to take effect: npm run restart
```

### account:enable <accountId>

Enable a disabled account.

**Usage:**
```bash
npm run account:enable <accountId>
```

**Example:**
```bash
$ npm run account:enable work

✅ Account 'work' enabled
Restart the bot: npm run restart
```

### account:disable <accountId>

Disable an account without deleting it.

**Usage:**
```bash
npm run account:disable <accountId>
```

**Example:**
```bash
$ npm run account:disable work

✅ Account 'work' disabled
Restart the bot: npm run restart
```

### account:remove <accountId>

Remove an account permanently.

**Usage:**
```bash
npm run account:remove <accountId>
```

**Interactive:**
1. Confirm removal
2. Choose to delete session files

**Example:**
```bash
$ npm run account:remove old-account

? Are you sure you want to remove account 'old-account'? Yes
? Also delete session files? Yes

✅ Account 'old-account' removed
```

## Bot Control Commands

### start

Start the bot in foreground mode (development).

**Usage:**
```bash
npm start
```

**Features:**
- Shows all logs in terminal
- Displays QR codes for scanning
- Stops with Ctrl+C
- Good for testing and debugging

**Output:**
```bash
╔════════════════════════════════════════╗
║  WhatsApp Hybrid Bot v3.2 - Baileys  ║
╚════════════════════════════════════════╝

ℹ️  Validating environment...
✅ Environment validated
ℹ️  Setting up directories...
✅ All required directories created/verified
ℹ️  Initializing account manager...
✅ Loaded 1 active account(s)
✅ WhatsApp Hybrid Bot is running!

📊 Health Dashboard: http://localhost:8080/health
Press Ctrl+C to stop
```

### start:pm2

Start the bot with PM2 (production).

**Usage:**
```bash
npm run start:pm2
```

**Features:**
- Runs in background
- Auto-restart on crash
- Memory monitoring
- Log management
- Survives SSH disconnection

**Setup PM2 Auto-Start:**
```bash
npm run start:pm2
pm2 save
pm2 startup
# Run the command it shows
```

### stop

Stop the PM2 process.

**Usage:**
```bash
npm run stop
```

**Example:**
```bash
$ npm run stop
[PM2] Stopping whatsapp-hybrid-bot
✓ Process stopped
```

### restart

Restart the PM2 process (apply configuration changes).

**Usage:**
```bash
npm run restart
```

**When to use:**
- After editing accounts.json
- After enabling/disabling accounts
- After changing .env variables
- After updates

### logs

Show real-time logs from PM2.

**Usage:**
```bash
npm run logs
```

**Features:**
- Tail -f style output
- Shows all console output
- Ctrl+C to exit
- Auto-scrolling

**Example:**
```bash
$ npm run logs
[PM2] Streaming logs for whatsapp-hybrid-bot

2026-01-05T10:30:45.123Z ℹ️  Message received
2026-01-05T10:30:46.456Z 🎬 Searching movie: Inception
2026-01-05T10:30:47.789Z ✅ Found 5 movies
```

### status

Show PM2 process status.

**Usage:**
```bash
npm run status
```

**Output:**
```bash
┌─────┬─────────────────────────┬─────────────┬─────────┬─────────┬──────────┬────────┬──────┬───────────┬──────────┬──────────┬──────────┐
│ id  │ name                    │ namespace   │ version │ mode    │ pid      │ uptime │ ↺    │ status    │ cpu      │ mem      │ user     │
├─────┼─────────────────────────┼─────────────┼─────────┼─────────┼──────────┼────────┼──────┼───────────┼──────────┼──────────┼──────────┤
│ 0   │ whatsapp-hybrid-bot     │ default     │ 3.2.0   │ fork    │ 12345    │ 3h     │ 0    │ online    │ 0%       │ 320 MB   │ ubuntu   │
└─────┴─────────────────────────┴─────────────┴─────────┴─────────┴──────────┴────────┴──────┴───────────┴──────────┴──────────┴──────────┘
```

## Utility Commands

### health

Show health dashboard URL and endpoints.

**Usage:**
```bash
npm run health
```

**Output:**
```bash
📊 Health Dashboard

  URL: http://localhost:8080/health
  Accounts: http://localhost:8080/accounts
  Stats: http://localhost:8080/stats
```

### stats

Show bot statistics from API.

**Usage:**
```bash
npm run stats
```

**Output:**
```bash
📊 Statistics
──────────────────────────────────────────────────
  Messages Processed: 1523
  Movies Searched: 45
  Deleted Recovered: 12
  View-Once Captured: 8
  Status Captured: 0
  Errors: 2
  Active Accounts: 2
  Active Sessions: 15
──────────────────────────────────────────────────
```

### system

Show system resource information.

**Usage:**
```bash
npm run system
```

**Output:**
```bash
💻 System Information
──────────────────────────────────────────────────
  Node Version: v18.17.0
  Platform: linux
  Architecture: x64
  Memory (Heap): 285 MB / 512 MB
  Memory (RSS): 320 MB
  Uptime: 10847 seconds
──────────────────────────────────────────────────
```

### clean

Clean old cache files from temp storage.

**Usage:**
```bash
npm run clean
```

**Output:**
```bash
🧹 Cleaning Cache

  ✓ Cleaned 15 old file(s)
```

**What it cleans:**
- Files older than 3 days in temp_storage/
- View-once media
- Status captures
- Temporary downloads

### test:tmdb

Test TMDB API connection and credentials.

**Usage:**
```bash
npm run test:tmdb
```

**Success Output:**
```bash
🎬 Testing TMDB API

  ✓ TMDB API connected successfully
  Response time: 234ms
  Base URL: https://image.tmdb.org/t/p/
```

**Failure Output:**
```bash
🎬 Testing TMDB API

  ❌ Invalid API key
```

### validate:config

Validate all configuration files.

**Usage:**
```bash
npm run validate:config
```

**Output:**
```bash
✅ Validating Configuration

  ✓ .env file exists
  ✓ TMDB_API_KEY configured
  ✓ accounts.json valid (2 account(s))
  ✓ sessions/ directory exists
  ✓ temp_storage/ directory exists
  ✓ logs/ directory exists
  ✓ config/ directory exists

✅ Configuration is valid
```

### reset:sessions

Delete all session files (requires re-scanning QR codes).

**Usage:**
```bash
npm run reset:sessions
```

**Interactive:**
```bash
$ npm run reset:sessions

? This will delete all session files. Are you sure? Yes

✅ All sessions deleted

You will need to scan QR codes again when you start the bot
```

**When to use:**
- Session corruption
- "Could not connect" errors
- Moving to different device
- Testing fresh setup

### factory:reset

Complete factory reset (delete EVERYTHING).

**Usage:**
```bash
npm run factory:reset
```

**⚠️ WARNING: THIS IS DESTRUCTIVE**

**Interactive:**
```bash
$ npm run factory:reset

⚠️  FACTORY RESET - THIS CANNOT BE UNDONE

? Delete all data (sessions, logs, config)? This CANNOT be undone! Yes
? Type "DELETE" to confirm: DELETE

  Deleted sessions
  Deleted temp_storage
  Deleted logs
  Deleted config/accounts.json

✅ Factory reset complete

The bot is now in a fresh state. Reconfigure with:
  1. Copy .env.example to .env
  2. Set TMDB_API_KEY in .env
  3. Run: npm run account:add
```

## Advanced Usage

### Chaining Commands

```bash
# Clean, validate, restart
npm run clean && npm run validate:config && npm run restart

# Add account and start immediately
npm run account:add && npm run start:pm2

# Full reset and reconfigure
npm run factory:reset && cp .env.example .env && npm run account:add
```

### Using with Watch

```bash
# Development mode with auto-reload
npm install -g nodemon
nodemon src/index.js
```

### Custom Scripts

Add to `package.json`:
```json
{
  "scripts": {
    "dev": "NODE_ENV=development nodemon src/index.js",
    "prod": "NODE_ENV=production node src/index.js",
    "backup": "tar -czf backup-$(date +%Y%m%d).tar.gz config/ sessions/",
    "restore": "tar -xzf backup.tar.gz"
  }
}
```

## Keyboard Shortcuts

When running with `npm start`:

- **Ctrl+C**: Stop bot gracefully
- **Ctrl+Z**: Suspend process (use `fg` to resume)
- **Ctrl+D**: EOF (equivalent to exit)

When viewing logs with `npm run logs`:

- **Ctrl+C**: Exit log view (bot keeps running)
- **Space**: Pause/resume scrolling
- **Shift+G**: Jump to end

## Troubleshooting Commands

```bash
# Check if bot is running
ps aux | grep "node.*index.js"

# Check port usage
lsof -i :8080

# View raw PM2 info
pm2 info whatsapp-hybrid-bot

# View PM2 logs location
pm2 info whatsapp-hybrid-bot | grep "log path"

# Monitor PM2 in real-time
pm2 monit

# Check Node.js memory usage
node --expose-gc src/index.js --trace-gc
```

---

For more information, see:
- [SETUP.md](SETUP.md) - Installation guide
- [CONFIG.md](CONFIG.md) - Configuration reference
- [TROUBLESHOOTING.md](TROUBLESHOOTING.md) - Problem solving