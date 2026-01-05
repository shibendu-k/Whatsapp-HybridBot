# 🔧 Configuration Guide - WhatsApp Hybrid Bot v3.2

Complete reference for all configuration options.

## Configuration Files

### 1. Environment Variables (.env)

Location: `/.env` (root directory)

```env
# ============================================
# REQUIRED SETTINGS
# ============================================

# TMDB API Key (Required for movie bot)
# Get from: https://www.themoviedb.org/settings/api
TMDB_API_KEY=your_api_key_here

# ============================================
# OPTIONAL SETTINGS
# ============================================

# Node Environment
# Options: development, production, test
NODE_ENV=production

# Logging Level
# Options: error, warn, info, debug
LOG_LEVEL=info

# System Configuration
MAX_ACCOUNTS=10
HEALTH_CHECK_PORT=8080
TEMP_STORAGE_PATH=./temp_storage
LOGS_PATH=./logs
SESSIONS_PATH=./sessions

# Feature Flags
ENABLE_MOVIE_BOT=true
ENABLE_STEALTH_LOGGER=true
ENABLE_HEALTH_CHECK=true

# Performance Settings
TIMEOUT=30000
MAX_RETRIES=10

# Security
MASK_PHONE_NUMBERS=true
```

### 2. Accounts Configuration (config/accounts.json)

Location: `/config/accounts.json`

```json
{
  "accounts": [
    {
      "accountId": "account1",
      "enabled": true,
      "vaultNumber": "+919876543210",
      "description": "Main Account",
      "modules": {
        "movieBot": {
          "enabled": true,
          "allowedGroups": [],
          "commandPrefix": "!",
          "rateLimit": {
            "maxRequests": 10,
            "windowMs": 60000
          },
          "timeout": 20000,
          "maxRetries": 10
        },
        "stealthLogger": {
          "enabled": true,
          "excludedGroups": [],
          "statusCacheDuration": 86400000,
          "mediaCacheDuration": 244800000,
          "maxFileSize": 157286400,
          "maxTextCache": 5000
        }
      }
    }
  ]
}
```

## Configuration Options Explained

### Account Settings

#### `accountId` (string, required)
Unique identifier for the account.
- Must be unique across all accounts
- Only letters, numbers, underscores, hyphens
- Example: `"account1"`, `"personal"`, `"work-bot"`

#### `enabled` (boolean, required)
Whether this account should be active.
- `true`: Account will connect on startup
- `false`: Account configuration preserved but not connected
- Change without deleting account data

#### `vaultNumber` (string, required)
WhatsApp number to receive captured content.
- Must include country code with `+`
- Format: `+[country code][number]`
- Example: `"+919876543210"` (India), `"+12025551234"` (US)

#### `description` (string, optional)
Human-readable description of the account.
- Shown in account list and dashboard
- Example: `"Main Account"`, `"Personal Bot"`, `"Work Monitor"`

### Movie Bot Configuration

#### `movieBot.enabled` (boolean)
Enable/disable movie search functionality.
- Default: `true`

#### `movieBot.allowedGroups` (array of strings)
List of group names where movie bot responds.
- Empty array `[]`: Works in all groups
- Partial name matching (case-insensitive)
- Example: `["Movies", "Cinema", "Film"]`

#### `movieBot.commandPrefix` (string)
Command prefix character.
- Default: `"!"`
- Single character recommended
- Example: `"/"`, `"."`, `"!"`

#### `movieBot.rateLimit.maxRequests` (number)
Maximum searches per time window.
- Default: `10`
- Per user, per account
- Prevents abuse

#### `movieBot.rateLimit.windowMs` (number)
Time window for rate limiting in milliseconds.
- Default: `60000` (1 minute)
- Example: `120000` (2 minutes)

#### `movieBot.timeout` (number)
TMDB API request timeout in milliseconds.
- Default: `20000` (20 seconds)
- Increase for slow connections

#### `movieBot.maxRetries` (number)
Maximum retry attempts for failed API calls.
- Default: `10`
- Exponential backoff applied

### Stealth Logger Configuration

#### `stealthLogger.enabled` (boolean)
Enable/disable stealth logging functionality.
- Default: `true`

#### `stealthLogger.excludedGroups` (array of strings)
Groups to exclude from ALL logging.
- Partial name matching (case-insensitive)
- No text caching, no media capture, no vault forwarding
- Example: `["Family", "Work", "Private"]`

#### `stealthLogger.statusCacheDuration` (number)
How long to keep status files in milliseconds.
- Default: `86400000` (24 hours)
- Auto-delete after this duration

#### `stealthLogger.mediaCacheDuration` (number)
How long to keep media files in milliseconds.
- Default: `244800000` (68 hours)
- Longer than status for recovery purposes

#### `stealthLogger.maxFileSize` (number)
Maximum media file size to capture in bytes.
- Default: `157286400` (150 MB)
- Files larger than this are skipped

#### `stealthLogger.maxTextCache` (number)
Maximum number of text messages to cache.
- Default: `5000`
- Oldest messages removed when limit reached
- Prevents unlimited memory growth

### Global Settings (config/default.json)

Location: `/config/default.json`

```json
{
  "app": {
    "name": "WhatsApp Hybrid Bot",
    "version": "3.2.0",
    "timezone": "Asia/Kolkata"
  },
  "performance": {
    "maxAccounts": 10,
    "memoryPerAccount": 90,
    "cleanupInterval": 21600000
  },
  "antiSan": {
    "minDelay": 3000,
    "maxDelay": 7000,
    "ipv4Preference": true
  },
  "cache": {
    "textMessageExpiry": 10800000,
    "userSearchExpiry": 600000,
    "tmdbResultExpiry": 3600000
  }
}
```

## Configuration Examples

### Example 1: Personal Use (Single Account, Full Features)

`.env`:
```env
TMDB_API_KEY=abc123xyz
NODE_ENV=production
MASK_PHONE_NUMBERS=true
```

`accounts.json`:
```json
{
  "accounts": [
    {
      "accountId": "personal",
      "enabled": true,
      "vaultNumber": "+919876543210",
      "description": "Personal Account",
      "modules": {
        "movieBot": {
          "enabled": true,
          "allowedGroups": [],
          "commandPrefix": "!",
          "rateLimit": {
            "maxRequests": 10,
            "windowMs": 60000
          }
        },
        "stealthLogger": {
          "enabled": true,
          "excludedGroups": ["Family"],
          "maxTextCache": 5000
        }
      }
    }
  ]
}
```

### Example 2: Movie Bot Only (No Logging)

```json
{
  "accounts": [
    {
      "accountId": "moviebot",
      "enabled": true,
      "vaultNumber": "+919876543210",
      "description": "Movie Search Bot",
      "modules": {
        "movieBot": {
          "enabled": true,
          "allowedGroups": ["Movies", "Cinema"],
          "commandPrefix": "/",
          "rateLimit": {
            "maxRequests": 20,
            "windowMs": 60000
          }
        },
        "stealthLogger": {
          "enabled": false,
          "excludedGroups": [],
          "maxTextCache": 0
        }
      }
    }
  ]
}
```

### Example 3: Multi-Account Setup

```json
{
  "accounts": [
    {
      "accountId": "work",
      "enabled": true,
      "vaultNumber": "+919876543210",
      "description": "Work Account",
      "modules": {
        "movieBot": {
          "enabled": false
        },
        "stealthLogger": {
          "enabled": true,
          "excludedGroups": ["HR", "Management"]
        }
      }
    },
    {
      "accountId": "personal",
      "enabled": true,
      "vaultNumber": "+919876543211",
      "description": "Personal Account",
      "modules": {
        "movieBot": {
          "enabled": true,
          "allowedGroups": []
        },
        "stealthLogger": {
          "enabled": true,
          "excludedGroups": ["Family"]
        }
      }
    },
    {
      "accountId": "moviebot",
      "enabled": true,
      "vaultNumber": "+919876543212",
      "description": "Dedicated Movie Bot",
      "modules": {
        "movieBot": {
          "enabled": true,
          "allowedGroups": []
        },
        "stealthLogger": {
          "enabled": false
        }
      }
    }
  ]
}
```

## Editing Configuration

### Method 1: CLI (Recommended)

```bash
# Add new account (interactive)
npm run account:add

# Edit existing account
npm run account:edit

# List all accounts
npm run account:list
```

### Method 2: Manual Editing

```bash
# Edit accounts.json
nano config/accounts.json

# Validate after editing
npm run validate:config

# Restart bot
npm run restart
```

### Method 3: Programmatic

```javascript
const fs = require('fs-extra');
const path = require('path');

async function addAccount() {
  const configPath = path.join(process.cwd(), 'config', 'accounts.json');
  const config = await fs.readJSON(configPath);
  
  config.accounts.push({
    accountId: 'new-account',
    enabled: true,
    vaultNumber: '+919876543210',
    description: 'New Account',
    modules: { /* ... */ }
  });
  
  await fs.writeJSON(configPath, config, { spaces: 2 });
}
```

## Configuration Validation

Validate your configuration:

```bash
npm run validate:config
```

This checks:
- ✓ .env file exists
- ✓ TMDB_API_KEY is set
- ✓ accounts.json is valid JSON
- ✓ Required fields are present
- ✓ Phone numbers are valid format
- ✓ Directories exist

## Dynamic Configuration

Configuration changes that require restart:
- Adding/removing accounts
- Changing vault numbers
- Enabling/disabling modules
- Changing rate limits

Configuration changes that don't require restart:
- Editing environment log level
- Changing health check port (takes effect on next start)

## Best Practices

1. **Backup Configuration**: Before major changes, backup `config/accounts.json`
2. **Test TMDB Key**: Run `npm run test:tmdb` after setting API key
3. **Validate After Edits**: Always run `npm run validate:config`
4. **Use CLI When Possible**: Interactive prompts prevent errors
5. **Keep Secrets Safe**: Never commit `.env` to git
6. **Document Custom Settings**: Add comments in accounts.json
7. **Start Simple**: Begin with one account, add more later

## Troubleshooting

### "Invalid configuration"
```bash
npm run validate:config
```
Shows exactly what's wrong.

### Changes not taking effect
```bash
npm run restart
```
Some changes require restart.

### Lost configuration
```bash
cp config/accounts.example.json config/accounts.json
```
Start fresh from example.

---

For more help, see [SETUP.md](SETUP.md) or [TROUBLESHOOTING.md](TROUBLESHOOTING.md)