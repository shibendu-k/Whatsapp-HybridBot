# 🔒 Security Best Practices - WhatsApp Hybrid Bot v3.2

Important security considerations and best practices.

## ⚠️ Important Disclaimers

### WhatsApp Terms of Service

**This bot may violate WhatsApp's Terms of Service.** Usage of automated WhatsApp clients is against WhatsApp's official policies. Use this bot at your own risk. Potential consequences include:

- ⚠️ **Account Ban**: Temporary or permanent ban from WhatsApp
- ⚠️ **Number Blocking**: Your phone number may be blocked
- ⚠️ **Legal Issues**: Potential legal consequences depending on usage

**Recommendations:**
- Use with a secondary phone number, not your primary one
- Don't use for spam or unsolicited messages
- Respect privacy and consent of others
- Use for personal/educational purposes only

### Privacy Considerations

The Stealth Logger module captures:
- View-once messages (intended to disappear)
- Deleted messages
- Ephemeral content

**Ethical Usage:**
- ⚠️ Obtaining content someone intended to delete or hide may be unethical
- ⚠️ Violates the sender's privacy expectations
- ⚠️ May be illegal in your jurisdiction
- ⚠️ Use only with explicit consent or for legitimate monitoring purposes

## 🔐 Securing Your Installation

### 1. Protect API Keys and Credentials

**Never commit secrets to git:**

```bash
# Always ensure .env is in .gitignore
cat .gitignore | grep .env

# Check before committing
git status
git diff

# If accidentally committed:
git rm --cached .env
git commit -m "Remove .env from git"
```

**File Permissions:**

```bash
# Restrict .env access
chmod 600 .env

# Restrict config
chmod 600 config/accounts.json

# Restrict sessions
chmod 700 sessions/
```

### 2. Secure Phone Numbers

**Enable phone masking** in `.env`:
```env
MASK_PHONE_NUMBERS=true
```

This ensures phone numbers in logs show as:
```
XXXXXX1234  # Only last 4 digits visible
```

**Vault Number Security:**
- Don't share vault number publicly
- Use a dedicated number for vault (not personal)
- Regularly review captured content

### 3. Server Security

**If running on a server:**

```bash
# Enable UFW firewall
sudo ufw enable
sudo ufw default deny incoming
sudo ufw default allow outgoing

# Only allow SSH
sudo ufw allow ssh

# Only allow health dashboard from specific IP (optional)
sudo ufw allow from YOUR_IP to any port 8080

# Check status
sudo ufw status
```

**SSH Security:**

```bash
# Disable root login
sudo nano /etc/ssh/sshd_config
# Set: PermitRootLogin no

# Use SSH keys instead of passwords
ssh-keygen -t ed25519
# Add to ~/.ssh/authorized_keys

# Disable password authentication
sudo nano /etc/ssh/sshd_config
# Set: PasswordAuthentication no

# Restart SSH
sudo systemctl restart sshd
```

### 4. Keep Software Updated

```bash
# Update system packages
sudo apt update && sudo apt upgrade -y

# Update Node.js packages
npm update

# Check for security vulnerabilities
npm audit
npm audit fix

# Update PM2
npm update -g pm2
```

### 5. Secure Health Dashboard

The health dashboard exposes system information on port 8080.

**Option 1: Bind to localhost only**

Edit `src/services/health-monitor.js`:
```javascript
this.server = this.app.listen(this.port, 'localhost', () => {
  // Only accessible from the server itself
});
```

**Option 2: Add authentication**

Add to `src/services/health-monitor.js`:
```javascript
const basicAuth = require('express-basic-auth');

this.app.use(basicAuth({
  users: { 'admin': 'your-secure-password' },
  challenge: true
}));
```

Install dependency:
```bash
npm install express-basic-auth
```

**Option 3: Use reverse proxy with SSL**

```nginx
# /etc/nginx/sites-available/bot
server {
    listen 443 ssl;
    server_name bot.yourdomain.com;
    
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;
    
    location / {
        proxy_pass http://localhost:8080;
        auth_basic "Restricted";
        auth_basic_user_file /etc/nginx/.htpasswd;
    }
}
```

## 🛡️ Anti-Ban Measures

### Random Delays

The bot implements random delays (3-7 seconds) between actions to mimic human behavior.

**Don't override these delays** in production:

```javascript
// Good (uses random delay)
await client.sendMessage(jid, text);

// Bad (no delay, may trigger ban)
for (let i = 0; i < 100; i++) {
  await client.sock.sendMessage(jid, text);
}
```

### Rate Limiting

Configure reasonable rate limits in `config/accounts.json`:

```json
{
  "rateLimit": {
    "maxRequests": 10,    // Don't increase too much
    "windowMs": 60000     // Keep at least 1 minute
  }
}
```

### Account Behavior

**Do:**
- ✅ Start with one account, test for 24 hours
- ✅ Keep message volume low initially
- ✅ Gradually increase usage
- ✅ Use realistic response times
- ✅ Don't run 24/7 immediately

**Don't:**
- ❌ Send mass messages
- ❌ Respond instantly to every message
- ❌ Add too many accounts at once
- ❌ Use on brand new phone numbers
- ❌ Violate WhatsApp's spam policies

## 🔍 Privacy Best Practices

### Group Exclusions

**Always exclude sensitive groups:**

```json
{
  "stealthLogger": {
    "excludedGroups": [
      "Family",
      "Work",
      "Medical",
      "Legal",
      "Banking",
      "Personal"
    ]
  }
}
```

### Data Retention

**Limit cache sizes:**

```json
{
  "stealthLogger": {
    "maxTextCache": 1000,        // Lower = less data stored
    "statusCacheDuration": 3600000,  // 1 hour instead of 24
    "mediaCacheDuration": 86400000   // 24 hours instead of 68
  }
}
```

**Regular cleanup:**

```bash
# Schedule daily cleanup
crontab -e

# Add:
0 2 * * * cd /path/to/bot && npm run clean
```

### Vault Security

**Secure the vault account:**
- Use a dedicated device for vault number
- Enable WhatsApp two-factor authentication
- Regularly review and delete old captures
- Don't share vault with others
- Use end-to-end encrypted backups if available

## 📁 Data Security

### Backup Sensitive Data

```bash
# Backup sessions (contains auth tokens)
tar -czf sessions-backup-$(date +%Y%m%d).tar.gz sessions/
chmod 600 sessions-backup-*.tar.gz

# Store securely, e.g., encrypt:
gpg -c sessions-backup-*.tar.gz
rm sessions-backup-*.tar.gz  # Keep only .gpg file
```

### Secure File Permissions

```bash
# Restrict all sensitive directories
chmod 700 sessions/
chmod 700 temp_storage/
chmod 700 logs/
chmod 600 .env
chmod 600 config/accounts.json

# Verify
ls -la
```

### Clean Up on Removal

When removing the bot:

```bash
# Secure cleanup
npm run factory:reset

# Or manual:
shred -vfz -n 10 .env
shred -vfz -n 10 config/accounts.json
rm -rf sessions/
rm -rf temp_storage/
rm -rf logs/
```

## 🚨 Incident Response

### If Account Gets Banned

1. **Stop the bot immediately:**
```bash
npm run stop
```

2. **Don't try to reconnect** - May make it worse

3. **Wait 24-48 hours** before retrying

4. **Use a different number** if permanently banned

5. **Review what triggered it:**
   - Check logs
   - Reduce message volume
   - Increase delays
   - Disable aggressive features

### If Credentials Are Compromised

1. **Immediately reset sessions:**
```bash
npm run reset:sessions
```

2. **Change all passwords:**
   - WhatsApp account
   - Server access
   - API keys

3. **Review logs for unauthorized access:**
```bash
grep -i "unauthorized" logs/*
```

4. **Enable WhatsApp 2FA**

### If Vault Content Is Exposed

1. **Delete vault content immediately**

2. **Inform affected parties** if their privacy was compromised

3. **Review access logs:**
```bash
# Check who accessed the system
last -a
who
```

4. **Strengthen vault security:**
   - Change vault number
   - Add authentication to dashboard
   - Review exclusion lists

## 🔐 Compliance

### GDPR Compliance (Europe)

If subject to GDPR:

1. **Data Minimization**: Only capture what you need
2. **Right to Erasure**: Implement data deletion on request
3. **Consent**: Obtain explicit consent before logging
4. **Data Breach Notification**: Have an incident response plan
5. **Privacy Policy**: Document what you collect and why

**Implementation:**

```bash
# Add data export function
npm run export-data --user=+919876543210

# Add data deletion function  
npm run delete-data --user=+919876543210
```

### Other Jurisdictions

- Check local laws regarding message interception
- Ensure compliance with wiretapping laws
- Obtain consent where required
- Maintain audit logs

## ✅ Security Checklist

Before deploying to production:

- [ ] `.env` is in `.gitignore`
- [ ] `MASK_PHONE_NUMBERS=true` in `.env`
- [ ] File permissions restricted (700/600)
- [ ] SSH key authentication enabled
- [ ] Password authentication disabled
- [ ] Firewall configured (only necessary ports)
- [ ] Health dashboard secured (auth or localhost only)
- [ ] Sensitive groups added to exclusion list
- [ ] Cache sizes limited reasonably
- [ ] Regular backups scheduled
- [ ] Backup encryption configured
- [ ] Rate limits configured conservatively
- [ ] Software update schedule established
- [ ] Incident response plan documented
- [ ] Vault account secured with 2FA
- [ ] Legal compliance reviewed
- [ ] Privacy policy documented
- [ ] User consent obtained (where applicable)

## 📚 Additional Resources

- [WhatsApp Terms of Service](https://www.whatsapp.com/legal/terms-of-service)
- [WhatsApp Privacy Policy](https://www.whatsapp.com/legal/privacy-policy)
- [GDPR Official Text](https://gdpr-info.eu/)
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)

## ⚖️ Legal Disclaimer

**The developers and contributors of this project:**

- Do NOT encourage violation of any Terms of Service
- Are NOT responsible for any misuse of this software
- Are NOT liable for any account bans or legal consequences
- Provide this software "as is" without warranty
- Recommend using only for educational purposes
- Advise consulting with legal counsel before deployment

**By using this software, you agree:**

- To use it at your own risk
- To comply with all applicable laws and regulations
- To respect others' privacy and rights
- To not hold the developers liable for any consequences

---

**Security is everyone's responsibility. Stay safe! 🔒**