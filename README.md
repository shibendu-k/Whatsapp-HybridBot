# 🤖 WhatsApp Hybrid Bot v3.2

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D16.0.0-brightgreen)](https://nodejs.org/)
[![Baileys](https://img.shields.io/badge/Baileys-6.6.0-blue)](https://github.com/WhiskeySockets/Baileys)

A powerful multi-account WhatsApp bot built with Baileys, featuring movie search capabilities and stealth logging for view-once messages, deleted messages, and ephemeral content.

## ✨ Features

### 🎬 Movie Bot
- Search movies and TV series using TMDB API
- Get detailed information including IMDB ratings, cast, and streaming platforms
- Automatic poster image download and display
- Rate limiting to prevent abuse (10 searches per 60 seconds)
- Group-based access control

### 🕵️ Stealth Logger
- **View-Once Media Capture**: Automatically save view-once images, videos, and audio
- **Deleted Message Recovery**: Cache and recover deleted text and media messages
- **Ephemeral Message Handling**: Capture disappearing messages before they vanish
- **Status Monitoring**: Track WhatsApp status updates
- **Group Exclusions**: Exclude specific groups from logging
- **Vault System**: Securely forward captured content to a designated vault account

### 🔄 Multi-Account Support
- Run multiple WhatsApp accounts in a single process
- Independent configuration per account
- Isolated message processing
- Memory-efficient (90MB per account)
- Sequential QR code scanning for easy setup

### 📊 Health Monitoring
- Real-time web dashboard on port 8080
- Account status monitoring
- Performance statistics
- Cache and memory usage tracking
- Auto-refreshing HTML interface

## 🚀 Quick Start

### Prerequisites
- Node.js 16+ and npm 7+
- TMDB API key (free from [themoviedb.org](https://www.themoviedb.org/settings/api))
- Linux/macOS/Windows with WSL2

### Installation

```bash
# Clone the repository
git clone https://github.com/shibendu-k/Whatsapp-HybridBot.git
cd Whatsapp-HybridBot

# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Edit .env and add your TMDB API key
nano .env  # or use your preferred editor

# Add your first account
npm run account:add

# Start the bot
npm start
```

### First Run

1. When you start the bot, it will display a QR code in the terminal
2. Open WhatsApp on your phone
3. Go to **Settings → Linked Devices → Link a Device**
4. Scan the QR code shown in the terminal
5. Wait for the bot to connect (you'll see "Connected to WhatsApp!")

## 📖 Usage

### Movie Search Commands

In any WhatsApp chat (or configured groups):

```
!movie Inception          # Search for a movie
!m Avatar                 # Short form for movie search
!series Breaking Bad      # Search for a TV series
!s Game of Thrones       # Short form for series search
!tv Stranger Things      # Alternative series command

# After search results appear:
1                        # Select option 1
2                        # Select option 2
... (up to 5)
```

### Account Management

```bash
# Add new account
npm run account:add

# List all accounts
npm run account:list

# Edit account configuration
npm run account:edit

# Enable/disable accounts
npm run account:enable <accountId>
npm run account:disable <accountId>

# Remove account
npm run account:remove <accountId>
```

### Utility Commands

```bash
# View health dashboard
npm run health

# Show statistics
npm run stats

# Test TMDB API
npm run test:tmdb

# Validate configuration
npm run validate:config

# Clean old cache files
npm run clean

# System information
npm run system

# Reset all sessions
npm run reset:sessions

# Factory reset (delete everything)
npm run factory:reset
```

### Process Management (PM2)

```bash
# Start with PM2
npm run start:pm2

# View logs
npm run logs

# Check status
npm run status

# Restart
npm run restart

# Stop
npm run stop
```

## 🔧 Configuration

### Environment Variables (.env)

```env
# Required
TMDB_API_KEY=your_api_key_here

# Optional
NODE_ENV=production
LOG_LEVEL=info
HEALTH_CHECK_PORT=8080
MAX_ACCOUNTS=10
MASK_PHONE_NUMBERS=true
```

### Account Configuration (config/accounts.json)

Each account can be configured independently:

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
          "allowedGroups": ["Movies", "Friends"],
          "commandPrefix": "!",
          "rateLimit": {
            "maxRequests": 10,
            "windowMs": 60000
          }
        },
        "stealthLogger": {
          "enabled": true,
          "excludedGroups": ["Family", "Work"],
          "maxTextCache": 5000
        }
      }
    }
  ]
}
```

## 🏗️ Architecture

### Technology Stack
- **Framework**: @whiskeysockets/baileys (WebSocket-based WhatsApp client)
- **Runtime**: Node.js 16+
- **Movie Data**: TMDB API
- **Process Manager**: PM2
- **Web Server**: Express
- **CLI**: Commander + Inquirer

### Memory Usage
- Base (Node.js + Services): ~40MB
- Per Account: ~90MB
- Total for 3 accounts: ~310MB
- Maximum accounts on 1GB RAM: 8-10

### Key Components
- **BaileysClient**: WhatsApp connection management
- **AccountManager**: Multi-account orchestration
- **TMDBService**: Movie/series search with caching
- **StealthLoggerService**: Message capture and vault forwarding
- **CommandRouter**: Message parsing and rate limiting
- **HealthMonitor**: Web dashboard and statistics

## 🔒 Security Features

- **Phone Number Masking**: Hide sensitive phone numbers in logs
- **Anti-Ban Protection**: Random delays (3-7 seconds) between actions
- **Rate Limiting**: Prevent API abuse
- **Group Exclusions**: Privacy-focused group filtering
- **Session Isolation**: Each account has isolated session storage
- **No Puppeteer**: Direct WebSocket connection (no browser vulnerabilities)

## 📊 Monitoring

Access the web dashboard at `http://localhost:8080/health` to view:

- System uptime and memory usage
- Message processing statistics
- Account connection status
- Cache sizes and health
- Error counts

## 🐛 Troubleshooting

### Bot won't connect
```bash
# Check if sessions are corrupted
npm run reset:sessions

# Validate configuration
npm run validate:config

# Check logs
npm run logs
```

### QR code not showing
- Make sure terminal supports UTF-8
- Try running in a different terminal
- Check if port 8080 is available

### High memory usage
- Reduce number of active accounts
- Clear cache: `npm run clean`
- Check for memory leaks in logs

### TMDB API errors
```bash
# Test API connection
npm run test:tmdb

# Check API key in .env
cat .env | grep TMDB_API_KEY
```

## 📚 Documentation

For detailed documentation, see the `/docs` directory:

- [Setup Guide](docs/SETUP.md) - Detailed installation instructions
- [Configuration Guide](docs/CONFIG.md) - All configuration options
- [Architecture](docs/ARCHITECTURE.md) - System design and internals
- [CLI Reference](docs/CLI.md) - All command-line tools
- [Troubleshooting](docs/TROUBLESHOOTING.md) - Common issues and solutions
- [Security](docs/SECURITY.md) - Best practices and guidelines

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## ⚠️ Disclaimer

This bot is for educational and personal use only. Usage of WhatsApp bots may violate WhatsApp's Terms of Service. Use at your own risk. The developers are not responsible for any consequences arising from the use of this software.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [Baileys](https://github.com/WhiskeySockets/Baileys) - WhatsApp Web API
- [TMDB](https://www.themoviedb.org/) - Movie database API
- All contributors and users

## 📞 Support

For issues and questions:
- Open an issue on GitHub
- Check existing issues for solutions
- Read the documentation in `/docs`

---

**Made with ❤️ for the WhatsApp automation community**