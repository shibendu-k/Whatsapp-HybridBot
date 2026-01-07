const express = require('express');
const logger = require('../utils/logger');
const { formatUptime, formatBytes, maskPhoneNumber } = require('../utils/helpers');

class HealthMonitor {
  constructor(accountManager) {
    this.accountManager = accountManager;
    this.app = express();
    this.port = parseInt(process.env.HEALTH_CHECK_PORT) || 8080;
    this.maxPortRetries = parseInt(process.env.HEALTH_CHECK_PORT_RETRIES) || 5;
    this.startTime = Date.now();
    this.version = '3.2.0';
    
    this.setupRoutes();
  }

  /**
   * Setup Express routes
   */
  setupRoutes() {
    this.app.get('/health', (req, res) => {
      this.handleHealth(req, res);
    });

    this.app.get('/accounts', (req, res) => {
      this.handleAccounts(req, res);
    });

    this.app.get('/chats', (req, res) => {
      this.handleChats(req, res);
    });

    this.app.get('/stats', (req, res) => {
      this.handleStats(req, res);
    });

    this.app.get('/', (req, res) => {
      res.redirect('/health');
    });
  }

  /**
   * Handle /health endpoint
   */
  handleHealth(req, res) {
    const uptime = Math.floor((Date.now() - this.startTime) / 1000);
    const memory = process.memoryUsage();
    const stats = this.accountManager.getStats();
    const accounts = this.accountManager.getAllAccounts();

    const data = {
      status: 'online',
      version: this.version,
      uptime: formatUptime(uptime),
      uptimeSeconds: uptime,
      memory: {
        heapUsed: formatBytes(memory.heapUsed),
        heapTotal: formatBytes(memory.heapTotal),
        rss: formatBytes(memory.rss)
      },
      stats: {
        messages: stats.messagesProcessed,
        messagesEdited: stats.messagesEdited || 0,
        movies: stats.moviesSearched,
        deleted: stats.deletedRecovered,
        viewOnce: stats.viewOnceCaptured,
        status: stats.statusCaptured,
        statusAutoDeleted: stats.statusAutoDeleted || 0,
        errors: stats.errors
      },
      caches: {
        text: stats.cacheStats ? 'Active' : 'N/A',
        media: stats.cacheStats ? 'Active' : 'N/A',
        searches: stats.cacheStats?.userSearches || 0,
        chats: stats.activeSessions || 0
      },
      accounts: {
        total: accounts.length,
        connected: accounts.filter(a => a.connected).length
      }
    };

    // HTML response
    const html = this.generateHealthHTML(data);
    res.send(html);
  }

  /**
   * Generate health dashboard HTML
   */
  generateHealthHTML(data) {
    return `
<!DOCTYPE html>
<html>
<head>
  <title>WhatsApp Hybrid Bot - Health Dashboard</title>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      padding: 12px;
      min-height: 100vh;
    }
    .container {
      max-width: 1200px;
      margin: 0 auto;
    }
    .header {
      background: white;
      padding: 15px 20px;
      border-radius: 10px;
      margin-bottom: 15px;
      box-shadow: 0 4px 6px rgba(0,0,0,0.1);
    }
    .header h1 {
      color: #333;
      margin-bottom: 8px;
      font-size: 1.3em;
    }
    .status {
      display: inline-block;
      padding: 4px 12px;
      background: #10b981;
      color: white;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
    }
    .grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 12px;
      margin-bottom: 15px;
    }
    .card {
      background: white;
      padding: 15px;
      border-radius: 10px;
      box-shadow: 0 4px 6px rgba(0,0,0,0.1);
    }
    .card h2 {
      color: #667eea;
      font-size: 16px;
      margin-bottom: 12px;
      display: flex;
      align-items: center;
    }
    .card h2::before {
      content: '📊';
      margin-right: 8px;
      font-size: 20px;
    }
    .stat-row {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid #f0f0f0;
      font-size: 14px;
    }
    .stat-row:last-child {
      border-bottom: none;
    }
    .stat-label {
      color: #666;
      font-weight: 500;
    }
    .stat-value {
      color: #333;
      font-weight: 600;
    }
    .footer {
      text-align: center;
      color: white;
      margin-top: 20px;
      opacity: 0.9;
      font-size: 12px;
    }
    .nav {
      display: flex;
      gap: 8px;
      margin-top: 12px;
      flex-wrap: wrap;
    }
    .nav a {
      display: inline-block;
      padding: 8px 16px;
      background: #667eea;
      color: white;
      text-decoration: none;
      border-radius: 5px;
      font-weight: 600;
      transition: background 0.3s;
      font-size: 13px;
    }
    .nav a:hover {
      background: #5568d3;
    }
    /* Tablet and Desktop */
    @media (min-width: 600px) {
      body { padding: 20px; }
      .header { padding: 25px 30px; }
      .header h1 { font-size: 1.6em; }
      .grid { grid-template-columns: repeat(2, 1fr); gap: 20px; }
      .card { padding: 20px; }
      .card h2 { font-size: 18px; }
      .stat-row { font-size: 15px; padding: 10px 0; }
      .nav a { padding: 10px 20px; font-size: 14px; }
    }
    @media (min-width: 900px) {
      .grid { grid-template-columns: repeat(2, 1fr); }
    }
  </style>
  <script>
    setTimeout(() => location.reload(), 30000); // Auto-refresh every 30 seconds
  </script>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🤖 WhatsApp Hybrid Bot v${data.version}</h1>
      <span class="status">${data.status.toUpperCase()}</span>
      <div class="nav">
        <a href="/health">Health</a>
        <a href="/accounts">Accounts</a>
        <a href="/chats">Chats</a>
      </div>
    </div>

    <div class="grid">
      <div class="card">
        <h2>System Info</h2>
        <div class="stat-row">
          <span class="stat-label">Uptime</span>
          <span class="stat-value">${data.uptime}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Memory (Heap)</span>
          <span class="stat-value">${data.memory.heapUsed} / ${data.memory.heapTotal}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Memory (RSS)</span>
          <span class="stat-value">${data.memory.rss}</span>
        </div>
      </div>

      <div class="card">
        <h2>Statistics</h2>
        <div class="stat-row">
          <span class="stat-label">Messages Processed</span>
          <span class="stat-value">${data.stats.messages}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Messages Edited</span>
          <span class="stat-value">${data.stats.messagesEdited || 0}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Movies Searched</span>
          <span class="stat-value">${data.stats.movies}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Deleted Recovered</span>
          <span class="stat-value">${data.stats.deleted}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">View-Once Captured</span>
          <span class="stat-value">${data.stats.viewOnce}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Status Auto-Deleted</span>
          <span class="stat-value">${data.stats.statusAutoDeleted}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Errors</span>
          <span class="stat-value">${data.stats.errors}</span>
        </div>
      </div>

      <div class="card">
        <h2>Accounts</h2>
        <div class="stat-row">
          <span class="stat-label">Total Accounts</span>
          <span class="stat-value">${data.accounts.total}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Connected</span>
          <span class="stat-value">${data.accounts.connected}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Active Chats</span>
          <span class="stat-value">${data.caches.chats}</span>
        </div>
      </div>

      <div class="card">
        <h2>Cache Status</h2>
        <div class="stat-row">
          <span class="stat-label">Text Cache</span>
          <span class="stat-value">${data.caches.text}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Media Cache</span>
          <span class="stat-value">${data.caches.media}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">User Searches</span>
          <span class="stat-value">${data.caches.searches}</span>
        </div>
      </div>
    </div>

    <div class="footer">
      <p>Auto-refreshing every 30 seconds • WhatsApp Hybrid Bot v${data.version}</p>
    </div>
  </div>
</body>
</html>
    `;
  }

  /**
   * Handle /accounts endpoint
   */
  handleAccounts(req, res) {
    const accounts = this.accountManager.getAllAccounts();
    
    const html = `
<!DOCTYPE html>
<html>
<head>
  <title>WhatsApp Hybrid Bot - Accounts</title>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      padding: 12px;
      min-height: 100vh;
    }
    .container { max-width: 1200px; margin: 0 auto; }
    .header {
      background: white;
      padding: 15px 20px;
      border-radius: 10px;
      margin-bottom: 15px;
      box-shadow: 0 4px 6px rgba(0,0,0,0.1);
    }
    .header h1 {
      font-size: 1.3em;
      margin-bottom: 10px;
    }
    .nav {
      display: flex;
      gap: 8px;
      margin-top: 12px;
      flex-wrap: wrap;
    }
    .nav a {
      display: inline-block;
      padding: 8px 16px;
      background: #667eea;
      color: white;
      text-decoration: none;
      border-radius: 5px;
      font-weight: 600;
      font-size: 13px;
    }
    .account-card {
      background: white;
      padding: 15px;
      border-radius: 10px;
      margin-bottom: 12px;
      box-shadow: 0 4px 6px rgba(0,0,0,0.1);
    }
    .account-card h3 {
      color: #667eea;
      margin-bottom: 10px;
      font-size: 1em;
    }
    .status-badge {
      display: inline-block;
      padding: 3px 8px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 600;
      margin-left: 8px;
    }
    .connected { background: #10b981; color: white; }
    .disconnected { background: #ef4444; color: white; }
    .info-row {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid #f0f0f0;
      font-size: 14px;
    }
    @media (min-width: 600px) {
      body { padding: 20px; }
      .header { padding: 25px 30px; }
      .header h1 { font-size: 1.5em; }
      .nav a { padding: 10px 20px; font-size: 14px; }
      .account-card { padding: 20px; }
      .account-card h3 { font-size: 1.1em; }
      .info-row { font-size: 15px; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🤖 Accounts Overview</h1>
      <div class="nav">
        <a href="/health">Health</a>
        <a href="/accounts">Accounts</a>
        <a href="/chats">Chats</a>
      </div>
    </div>
    
    ${accounts.map(account => `
      <div class="account-card">
        <h3>
          ${account.accountId}
          <span class="status-badge ${account.connected ? 'connected' : 'disconnected'}">
            ${account.connected ? 'CONNECTED' : 'DISCONNECTED'}
          </span>
        </h3>
        <div class="info-row">
          <span>Phone:</span>
          <strong>${maskPhoneNumber(account.stats.phone)}</strong>
        </div>
        <div class="info-row">
          <span>Movie Bot:</span>
          <strong>${account.config.modules.movieBot.enabled ? 'Enabled' : 'Disabled'}</strong>
        </div>
        <div class="info-row">
          <span>Stealth Logger:</span>
          <strong>${account.config.modules.stealthLogger.enabled ? 'Enabled' : 'Disabled'}</strong>
        </div>
        <div class="info-row">
          <span>Queue Size:</span>
          <strong>${account.stats.queueSize}</strong>
        </div>
      </div>
    `).join('')}
    
    ${accounts.length === 0 ? '<div class="account-card"><p>No accounts configured</p></div>' : ''}
  </div>
</body>
</html>
    `;
    
    res.send(html);
  }

  /**
   * Handle /chats endpoint - Shows all registered chats
   */
  handleChats(req, res) {
    const sessions = Array.from(this.accountManager.activeSessions.values());
    
    const html = `
<!DOCTYPE html>
<html>
<head>
  <title>WhatsApp Hybrid Bot - Chat Registry</title>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
      padding: 12px;
      min-height: 100vh;
    }
    .container {
      max-width: 1200px;
      margin: 0 auto;
      background: white;
      border-radius: 15px;
      padding: 20px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
    }
    h1 {
      color: #f5576c;
      margin-bottom: 20px;
      text-align: center;
      font-size: 1.5em;
    }
    .nav {
      display: flex;
      gap: 8px;
      margin-bottom: 15px;
      justify-content: center;
      flex-wrap: wrap;
    }
    .nav a {
      display: inline-block;
      padding: 8px 16px;
      background: #f5576c;
      color: white;
      text-decoration: none;
      border-radius: 5px;
      font-weight: 600;
      transition: background 0.3s;
      font-size: 13px;
    }
    .nav a:hover { background: #e04560; }
    .chat-grid {
      display: grid;
      gap: 12px;
    }
    .chat-card {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 15px;
      border-radius: 12px;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 12px;
      transition: transform 0.2s;
    }
    .chat-card:hover {
      transform: translateY(-3px);
    }
    .chat-icon {
      font-size: 2em;
    }
    .chat-info {
      flex: 1;
      min-width: 150px;
    }
    .chat-name {
      font-size: 1em;
      font-weight: bold;
      margin-bottom: 4px;
      word-break: break-word;
    }
    .chat-id {
      font-size: 0.8em;
      opacity: 0.8;
    }
    .chat-badges {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .chat-badge {
      background: rgba(255,255,255,0.2);
      padding: 4px 12px;
      border-radius: 15px;
      font-size: 0.75em;
      font-weight: bold;
    }
    .empty-state {
      text-align: center;
      padding: 40px 15px;
      color: #6b7280;
    }
    .empty-state-icon {
      font-size: 3em;
      margin-bottom: 15px;
    }
    .stats-summary {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 15px;
      border-radius: 12px;
      margin-bottom: 15px;
      text-align: center;
    }
    .stats-summary h2 {
      font-size: 1.2em;
      margin-bottom: 8px;
    }
    .stats-summary p {
      font-size: 0.9em;
    }
    @media (min-width: 600px) {
      body { padding: 20px; }
      .container { padding: 30px; }
      h1 { font-size: 2em; }
      .nav a { padding: 10px 20px; font-size: 14px; }
      .chat-card { padding: 20px; }
      .chat-icon { font-size: 2.5em; }
      .chat-name { font-size: 1.1em; }
      .stats-summary h2 { font-size: 1.4em; }
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>💬 Chat Registry</h1>
    
    <div class="nav">
      <a href="/health">Health</a>
      <a href="/accounts">Accounts</a>
      <a href="/chats">Chats</a>
    </div>
    
    ${sessions.length > 0 ? `
    <div class="stats-summary">
      <h2>Total Registered Chats: ${sessions.length}</h2>
      <p>Groups: ${sessions.filter(s => s.isGroup).length} | Private: ${sessions.filter(s => !s.isGroup).length}</p>
    </div>
    
    <div class="chat-grid">
      ${sessions.map(chat => {
        // Mask phone numbers in chat name/id for privacy
        let displayName = chat.name || 'Unknown';
        // If not a group, mask the phone number portion (handles @lid, @s.whatsapp.net formats)
        if (!chat.isGroup) {
          // Check if name already contains "Linked Contact" format
          if (displayName.startsWith('Linked Contact')) {
            // Already formatted, keep as is
          }
          // Check if it's a raw JID or just numbers
          else if (displayName.includes('@') || /^[0-9]+$/.test(displayName)) {
            // Extract just the number part and mask it
            const numberMatch = displayName.match(/([0-9]+)/);
            if (numberMatch) {
              // Check if it's a LID
              if (displayName.includes('@lid') || chat.jid?.includes('@lid')) {
                displayName = 'Linked Contact (' + numberMatch[1].slice(-4) + ')';
              } else {
                displayName = maskPhoneNumber(numberMatch[1]);
              }
            }
          }
        }
        return `
      <div class="chat-card">
        <div class="chat-icon">${chat.isGroup ? '👥' : '👤'}</div>
        <div class="chat-info">
          <div class="chat-name">${displayName}</div>
          <div class="chat-id">First seen: ${new Date(chat.firstSeen).toLocaleString()}</div>
        </div>
        <div class="chat-badges">
          <span class="chat-badge">${chat.isGroup ? 'GROUP' : 'PRIVATE'}</span>
          ${chat.jid?.includes('@lid') ? '<span class="chat-badge">LINKED</span>' : ''}
        </div>
      </div>
      `;
      }).join('')}
    </div>
    ` : `
    <div class="empty-state">
      <div class="empty-state-icon">📭</div>
      <h2>No Chats Registered Yet</h2>
      <p>Send a message in any chat to register it</p>
    </div>
    `}
  </div>
</body>
</html>
    `;
    
    res.send(html);
  }

  /**
   * Handle /stats endpoint
   */
  handleStats(req, res) {
    const stats = this.accountManager.getStats();
    res.json(stats);
  }

  /**
   * Start health check server with port retry logic
   * @returns {Promise<void>}
   */
  async start() {
    const originalPort = this.port;
    let currentPort = originalPort;
    let attempt = 0;

    while (attempt <= this.maxPortRetries) {
      try {
        await this.tryBindToPort(currentPort);
        this.port = currentPort;
        logger.success(`Health check server running on http://localhost:${currentPort}`);
        return;
      } catch (error) {
        if (error.code === 'EADDRINUSE') {
          if (attempt < this.maxPortRetries) {
            const nextPort = currentPort + 1;
            logger.warn(`Port ${currentPort} is already in use, trying port ${nextPort}...`);
            currentPort = nextPort;
            attempt++;
          } else {
            logger.warn(`All ports ${originalPort}-${currentPort} are in use, health check server disabled`);
            logger.warn('The bot will continue without health monitoring');
            this.server = null;
            return; // Don't throw - allow bot to continue without health monitoring
          }
        } else {
          logger.error('Health check server error', error);
          throw error;
        }
      }
    }
  }

  /**
   * Try to bind server to a specific port
   * @param {number} port - Port to bind to
   * @returns {Promise<void>}
   */
  tryBindToPort(port) {
    return new Promise((resolve, reject) => {
      this.server = this.app.listen(port, () => {
        resolve();
      });

      this.server.on('error', (error) => {
        reject(error);
      });
    });
  }

  /**
   * Stop health check server
   */
  stop() {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          logger.info('Health check server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}

module.exports = HealthMonitor;
