# 🔍 Troubleshooting Guide - WhatsApp Hybrid Bot v3.2

Common issues and their solutions.

## Quick Diagnostic Commands

```bash
# Check bot status
npm run status

# Validate configuration
npm run validate:config

# Test TMDB API
npm run test:tmdb

# View logs
npm run logs

# Check system resources
npm run system
```

## Connection Issues

### QR Code Not Showing

**Symptoms:**
- Terminal doesn't display QR code
- Bot starts but no QR appears

**Solutions:**

1. **Check Terminal Encoding:**
```bash
echo $LANG
# Should contain UTF-8
export LANG=en_US.UTF-8
source ~/.bashrc
```

2. **Use Different Terminal:**
- Try native terminal instead of SSH
- Use iTerm2 on macOS
- Use Windows Terminal on Windows

3. **Check Node Version:**
```bash
node --version
# Must be 16.0.0 or higher
```

### Can't Connect After Scanning QR

**Symptoms:**
- QR scanned successfully
- Connection closes immediately
- "Connection closed" error

**Solutions:**

1. **Reset Sessions:**
```bash
npm run reset:sessions
npm start
# Scan QR again
```

2. **Check Firewall:**
```bash
# Allow outbound connections on ports 443, 80
sudo ufw allow out 443
sudo ufw allow out 80
```

3. **Check Internet:**
```bash
ping google.com
# Should get responses
```

### Session Expired

**Symptoms:**
- "Session expired" error
- Need to scan QR frequently
- Connection not persisting

**Solutions:**

1. **Don't Force Close:**
- Use `npm run stop` instead of `kill -9`
- Let bot shutdown gracefully

2. **Check Session Permissions:**
```bash
ls -la sessions/
# Should be writable
chmod -R 755 sessions/
```

3. **Update Baileys:**
```bash
npm update @whiskeysockets/baileys
npm install
```

### Multi-Account Session Conflicts

**Symptoms:**
- Errors like "Closing open session in favor of incoming prekey bundle"
- "Bad MAC Error: Bad MAC" in logs
- "Failed to decrypt message with any known session"
- "Cannot derive from empty media key" errors
- Bot becomes unstable after adding second account

**Causes:**
These errors are common when running multiple WhatsApp accounts simultaneously. They occur due to:
- Signal protocol session conflicts between accounts
- Messages arriving during session transitions
- Missing or corrupted encryption keys in media messages

**Solutions:**

1. **These errors are now handled automatically** (as of v3.2.1):
   - The bot automatically skips messages with missing encryption keys
   - Transient decryption errors are logged at debug level only
   - Retry logic helps recover from temporary session conflicts

2. **If errors persist, try these steps:**
```bash
# Restart the bot to clear any stuck sessions
npm run restart

# If issues continue, reset sessions (will require re-scanning QR codes)
npm run reset:sessions
npm start
```

3. **Reduce Error Visibility:**
```bash
# Set log level to info to hide debug messages
# Edit .env:
LOG_LEVEL=info

# Restart:
npm run restart
```

4. **Monitor Bot Health:**
```bash
# Check health dashboard
open http://localhost:8080/health

# View recent logs
npm run logs --lines 50
```

**Note:** Session conflicts are normal in multi-account setups and are now handled gracefully. The bot will continue functioning normally despite these internal errors.

## Installation Issues

### "Cannot find module '@whiskeysockets/baileys'"

**Solution:**
```bash
rm -rf node_modules package-lock.json
npm install
```

### "EACCES: permission denied"

**Solution:**
```bash
# Don't use sudo with npm install
# Fix npm permissions:
mkdir ~/.npm-global
npm config set prefix '~/.npm-global'
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bashrc
source ~/.bashrc
```

### "gyp ERR! build error"

**Solution:**
```bash
# Install build tools
sudo apt install -y build-essential python3

# For macOS:
xcode-select --install

# Reinstall
npm install
```

## Configuration Issues

### "TMDB_API_KEY not configured"

**Solution:**
```bash
# Check .env
cat .env | grep TMDB_API_KEY

# If missing or example value:
nano .env
# Add: TMDB_API_KEY=your_actual_key

# Test:
npm run test:tmdb
```

### "Invalid phone number format"

**Solution:**
- Must start with `+`
- Include country code
- Example: `+919876543210` (India)
- Example: `+12025551234` (US)
- No spaces or dashes

### "accounts.json parse error"

**Solution:**
```bash
# Validate JSON syntax
cat config/accounts.json | jq .

# If jq not installed:
sudo apt install jq

# Or use online validator:
# Copy content and paste at jsonlint.com

# Fix and validate:
npm run validate:config
```

## Runtime Issues

### High Memory Usage

**Symptoms:**
- Bot using >900MB RAM
- System running slow
- OOM errors

**Solutions:**

1. **Reduce Active Accounts:**
```bash
npm run account:disable <accountId>
npm run restart
```

2. **Clear Cache:**
```bash
npm run clean
```

3. **Increase Swap (Linux):**
```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

4. **Set Memory Limit:**
Edit `ecosystem.config.js`:
```javascript
max_memory_restart: '800M'  // Lower limit
```

### Bot Crashes Frequently

**Symptoms:**
- Process stops unexpectedly
- PM2 shows many restarts
- "out of memory" errors

**Solutions:**

1. **Check Logs:**
```bash
npm run logs
# Look for error patterns
```

2. **Check System Resources:**
```bash
free -h  # Memory
df -h    # Disk
top      # CPU
```

3. **Reduce Cache Sizes:**
Edit `config/accounts.json`:
```json
{
  "stealthLogger": {
    "maxTextCache": 1000,  // Reduce from 5000
    "maxFileSize": 52428800  // 50MB instead of 150MB
  }
}
```

### Messages Not Being Processed

**Symptoms:**
- Bot connected but not responding
- Movie commands ignored
- No logging happening

**Solutions:**

1. **Check Group Configuration:**
```bash
# If allowedGroups is set, bot only works in those groups
# Edit config/accounts.json to allow all:
"allowedGroups": []
```

2. **Check Message Queue:**
```bash
# View health dashboard
open http://localhost:8080/health
# Check "Queue Size" for each account
```

3. **Restart Bot:**
```bash
npm run restart
```

## Movie Bot Issues

### "No movies found"

**Solutions:**

1. **Test TMDB API:**
```bash
npm run test:tmdb
# Should show success
```

2. **Check API Key:**
```bash
cat .env | grep TMDB_API_KEY
# Should not be example value
```

3. **Try Different Query:**
```
!movie Matrix
!m Inception
!series Breaking Bad
```

### Rate Limiting Triggered

**Symptoms:**
- "Too many requests" message
- 60 second wait time

**Solutions:**

1. **Wait for Window to Reset:**
- Default: 10 requests per 60 seconds
- Just wait 1 minute

2. **Adjust Rate Limit:**
Edit `config/accounts.json`:
```json
{
  "rateLimit": {
    "maxRequests": 20,  // Increase
    "windowMs": 120000  // 2 minutes
  }
}
```

3. **Clear Rate Limit Cache:**
```bash
npm run restart
```

### Poster Not Sending

**Symptoms:**
- Movie details appear
- But no poster image

**Solutions:**

1. **Check Network:**
```bash
ping image.tmdb.org
```

2. **Check File Size Limit:**
- WhatsApp has 16MB limit for images
- TMDB posters are usually <1MB

3. **Check Logs:**
```bash
npm run logs | grep -i poster
# Look for download errors
```

## Stealth Logger Issues

### View-Once Not Capturing

**Symptoms:**
- View-once messages not forwarded to vault
- No media in temp_storage

**Solutions:**

1. **Verify Baileys Support:**
```bash
# This requires Baileys 6.0+
npm list @whiskeysockets/baileys
# Should show 6.6.0 or higher
```

2. **Check Exclusions:**
```bash
# Make sure group is not excluded
cat config/accounts.json | grep -A 5 excludedGroups
```

3. **Verify Vault Number:**
```bash
# Check vault number is correct
cat config/accounts.json | grep vaultNumber
# Should be your actual WhatsApp number
```

### Deleted Messages Not Recovering

**Symptoms:**
- Deleted messages not sent to vault
- No recovery happening

**Solutions:**

1. **Message Must Be Cached First:**
- Bot only recovers messages it saw before deletion
- Can't recover messages from before bot started

2. **Check Cache Size:**
```bash
# View health dashboard
open http://localhost:8080/health
# Check cache sizes
```

3. **Increase Cache:**
Edit `config/accounts.json`:
```json
{
  "stealthLogger": {
    "maxTextCache": 10000  // Increase
  }
}
```

## PM2 Issues

### "PM2 command not found"

**Solution:**
```bash
sudo npm install -g pm2
```

### Can't See Logs

**Solution:**
```bash
# Check if bot is running
pm2 list

# If not running:
npm run start:pm2

# View logs:
pm2 logs whatsapp-hybrid-bot

# Or use npm script:
npm run logs
```

### Bot Not Auto-Starting on Reboot

**Solution:**
```bash
# Setup startup script
pm2 startup
# Run the command it shows

# Save current state
pm2 save

# Test:
sudo reboot
# Wait and check:
pm2 list
```

## Port Issues

### "Port 8080 already in use"

**Solution:**

1. **Find Process:**
```bash
lsof -i :8080
# Note the PID
```

2. **Kill Process:**
```bash
kill <PID>
```

3. **Or Change Port:**
Edit `.env`:
```
HEALTH_CHECK_PORT=8081
```

Restart:
```bash
npm run restart
```

## File System Issues

### "ENOSPC: no space left"

**Solution:**

1. **Check Disk Space:**
```bash
df -h
```

2. **Clean Cache:**
```bash
npm run clean
```

3. **Clean Logs:**
```bash
rm -rf logs/*.log
```

4. **Clear Old Sessions:**
```bash
# Backup first!
tar -czf sessions-backup.tar.gz sessions/
rm -rf sessions/*/
npm run reset:sessions
```

### "EACCES: permission denied"

**Solution:**
```bash
# Fix permissions
sudo chown -R $USER:$USER .
chmod -R 755 .
```

## Network Issues

### Slow TMDB API Responses

**Solution:**

1. **Check Connection:**
```bash
time curl https://api.themoviedb.org/3/configuration?api_key=YOUR_KEY
```

2. **Increase Timeout:**
Edit `.env`:
```
TIMEOUT=45000  # 45 seconds
```

3. **Use VPN:**
- Some regions have slower access to TMDB

### WhatsApp Connection Dropping

**Solution:**

1. **Check Internet Stability:**
```bash
ping -c 100 google.com
# Look for packet loss
```

2. **Use Wired Connection:**
- More stable than WiFi

3. **Check NAT/Firewall:**
```bash
# Allow WhatsApp servers
# Ports: 80, 443, 5222
```

## Getting More Help

### Enable Debug Logging

Edit `.env`:
```
LOG_LEVEL=debug
```

Restart:
```bash
npm run restart
```

### Collect Diagnostic Information

```bash
# System info
npm run system > diagnostic.txt

# Configuration validation
npm run validate:config >> diagnostic.txt

# PM2 status
pm2 status >> diagnostic.txt

# Recent logs
npm run logs --lines 100 >> diagnostic.txt

# Send diagnostic.txt when asking for help
```

### Report an Issue

When reporting issues on GitHub, include:

1. **Environment:**
   - OS and version
   - Node.js version
   - npm version

2. **Configuration:**
   - Number of accounts
   - Enabled modules
   - (Don't include API keys or phone numbers!)

3. **Error Messages:**
   - Complete error output
   - Stack traces

4. **Steps to Reproduce:**
   - What you did
   - What you expected
   - What actually happened

5. **Logs:**
   - Recent logs (with sensitive data removed)

## Still Having Issues?

1. Try factory reset (CAREFUL - deletes everything):
```bash
npm run factory:reset
```

2. Check GitHub issues:
```bash
https://github.com/shibendu-k/Whatsapp-HybridBot/issues
```

3. Read all documentation:
   - [SETUP.md](SETUP.md)
   - [CONFIG.md](CONFIG.md)
   - [CLI.md](CLI.md)
   - [ARCHITECTURE.md](ARCHITECTURE.md)

---

Most issues are solved by:
1. ✅ Validating configuration
2. ✅ Testing TMDB API
3. ✅ Resetting sessions
4. ✅ Checking logs
5. ✅ Restarting the bot