# 🛠️ Setup Guide - WhatsApp Hybrid Bot v3.2

Complete installation and setup instructions for the WhatsApp Hybrid Bot.

## System Requirements

### Minimum Requirements
- **OS**: Linux (Ubuntu 20.04+), macOS, or Windows with WSL2
- **RAM**: 512MB (for 1-2 accounts)
- **CPU**: 1 core @ 1GHz
- **Storage**: 2GB free space
- **Node.js**: v16.0.0 or higher
- **npm**: v7.0.0 or higher

### Recommended Requirements
- **OS**: Linux (Ubuntu 22.04 LTS)
- **RAM**: 1GB (for 8-10 accounts)
- **CPU**: 2 cores @ 2GHz
- **Storage**: 5GB free space
- **Node.js**: v18.x LTS
- **npm**: v9.x

## Installation on Ubuntu/Debian

### Step 1: Update System

```bash
sudo apt update && sudo apt upgrade -y
```

### Step 2: Install Node.js

```bash
# Install Node.js 18.x LTS
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# Verify installation
node --version  # Should show v18.x.x
npm --version   # Should show v9.x.x
```

### Step 3: Clone Repository

```bash
# Clone the repo
git clone https://github.com/shibendu-k/Whatsapp-HybridBot.git
cd Whatsapp-HybridBot

# Or if you have it as a zip
unzip Whatsapp-HybridBot.zip
cd Whatsapp-HybridBot
```

### Step 4: Install Dependencies

```bash
npm install
```

This will install all required packages including:
- @whiskeysockets/baileys
- axios, express
- qrcode-terminal
- winston, chalk
- commander, inquirer
- And more...

### Step 5: Configure Environment

```bash
# Copy example environment file
cp .env.example .env

# Edit with your preferred editor
nano .env
# or
vim .env
```

**Required configuration in .env:**

```env
TMDB_API_KEY=your_actual_api_key_here
```

### Step 6: Get TMDB API Key

1. Go to [https://www.themoviedb.org/](https://www.themoviedb.org/)
2. Create a free account
3. Go to Settings → API
4. Request an API key (choose "Developer" option)
5. Accept the terms and fill out the form
6. Copy your API key (v3 auth)
7. Paste it in your `.env` file

### Step 7: Add Your First Account

```bash
npm run account:add
```

Answer the prompts:
- **Account ID**: `account1` (or your choice)
- **Vault Number**: `+919876543210` (your WhatsApp number with country code)
- **Description**: `Main Account` (or your choice)
- **Enable Movie Bot**: `Yes`
- **Allowed Groups**: Leave empty for all groups, or specify names
- **Enable Stealth Logger**: `Yes` (if you want this feature)
- **Excluded Groups**: Specify any groups to exclude

### Step 8: Start the Bot

```bash
# For testing/development (shows logs in terminal)
npm start

# For production (with PM2)
npm run start:pm2
```

### Step 9: Scan QR Code

1. The terminal will display a QR code
2. Open WhatsApp on your phone
3. Go to **Settings** → **Linked Devices**
4. Tap **Link a Device**
5. Scan the QR code shown in the terminal
6. Wait for "Connected to WhatsApp!" message

### Step 10: Verify Installation

```bash
# Check if bot is running
npm run status

# View health dashboard
# Open browser and go to: http://localhost:8080/health

# Or from command line:
npm run health
```

## Installation on macOS

### Step 1: Install Homebrew (if not installed)

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

### Step 2: Install Node.js

```bash
brew install node@18
node --version
npm --version
```

### Step 3-10: Follow Ubuntu Steps

The rest of the steps are identical to Ubuntu installation.

## Installation on Windows (WSL2)

### Step 1: Enable WSL2

1. Open PowerShell as Administrator
2. Run: `wsl --install`
3. Restart your computer
4. Open Ubuntu from Start menu

### Step 2: Follow Ubuntu Installation

Once in WSL2 Ubuntu terminal, follow all Ubuntu installation steps above.

## Installation on Oracle Cloud Free Tier

Perfect for running on Oracle's Always Free resources (1GB RAM ARM instance).

### Step 1: Create Instance

1. Create Oracle Cloud account
2. Create Compute Instance:
   - Shape: VM.Standard.A1.Flex (ARM)
   - CPUs: 2
   - RAM: 1GB
   - OS: Ubuntu 22.04
   - Add your SSH key

### Step 2: Connect via SSH

```bash
ssh ubuntu@<your-instance-ip>
```

### Step 3: Install Dependencies

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs git

# Verify
node --version
npm --version
```

### Step 4: Clone and Setup

```bash
# Clone repository
git clone https://github.com/shibendu-k/Whatsapp-HybridBot.git
cd Whatsapp-HybridBot

# Install dependencies
npm install

# Setup environment
cp .env.example .env
nano .env  # Add your TMDB API key

# Add account
npm run account:add

# Install PM2 globally
sudo npm install -g pm2

# Start bot
npm run start:pm2

# Save PM2 configuration
pm2 save

# Setup PM2 startup script
pm2 startup
# Copy and run the command it shows

# Check status
pm2 status
```

### Step 5: Configure Firewall (Optional)

If you want to access health dashboard from outside:

```bash
# Open port 8080 in Oracle Cloud
# Go to: Instance → Virtual Cloud Network → Security Lists
# Add Ingress Rule: Source 0.0.0.0/0, Port 8080

# Also open in instance firewall
sudo ufw allow 8080
```

## Installation with Docker (Future)

Docker support is planned for future releases. For now, use native installation.

## Post-Installation

### Configure Multiple Accounts

```bash
# Add second account
npm run account:add

# List all accounts
npm run account:list

# Edit account
npm run account:edit
```

### Setup Auto-Start on Reboot

If using PM2:

```bash
pm2 startup
# Run the command it shows

pm2 save
```

### Configure Allowed Groups

Edit `config/accounts.json`:

```json
{
  "modules": {
    "movieBot": {
      "allowedGroups": ["Movies", "Cinema", "Film Club"]
    }
  }
}
```

Then restart:

```bash
npm run restart
```

### Configure Excluded Groups

Edit `config/accounts.json`:

```json
{
  "modules": {
    "stealthLogger": {
      "excludedGroups": ["Family", "Work", "Personal"]
    }
  }
}
```

Then restart:

```bash
npm run restart
```

## Verification

### Test Movie Bot

1. Send message in WhatsApp: `!movie Inception`
2. Bot should respond with 5 movie results
3. Reply with `1` to get full details
4. Bot should send movie info + poster image

### Test TMDB API

```bash
npm run test:tmdb
```

Should show: "✓ TMDB API connected successfully"

### Check Health Dashboard

Open browser: `http://localhost:8080/health`

Should show:
- System info
- Statistics
- Account status
- Cache status

### Check Logs

```bash
# If running with PM2
npm run logs

# If running with npm start
# Logs are shown in terminal
```

## Troubleshooting

### "Cannot find module '@whiskeysockets/baileys'"

```bash
# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install
```

### "TMDB_API_KEY not configured"

```bash
# Check .env file
cat .env | grep TMDB_API_KEY

# Should not be the example value
# If it is, edit .env and add real API key
nano .env
```

### "Port 8080 already in use"

```bash
# Find process using port
sudo lsof -i :8080

# Kill it (replace PID with actual number)
kill -9 <PID>

# Or change port in .env
echo "HEALTH_CHECK_PORT=8081" >> .env
```

### QR Code Not Showing

```bash
# Check terminal encoding
echo $LANG  # Should include UTF-8

# If not, add to ~/.bashrc
export LANG=en_US.UTF-8

# Reload
source ~/.bashrc

# Try again
npm start
```

### Session Expired / Need to Rescan

```bash
# Delete old session
npm run reset:sessions

# Start again
npm start

# Scan new QR code
```

## Next Steps

After successful installation:

1. Read [Configuration Guide](CONFIG.md) for advanced options
2. Read [Architecture](ARCHITECTURE.md) to understand how it works
3. Read [CLI Reference](CLI.md) for all available commands
4. Read [Security](SECURITY.md) for best practices

## Getting Help

If you encounter issues:

1. Check [Troubleshooting Guide](TROUBLESHOOTING.md)
2. Search existing GitHub issues
3. Create a new issue with:
   - OS version
   - Node.js version
   - Error message
   - Steps to reproduce

---

**Installation complete! Your bot should now be running. 🎉**