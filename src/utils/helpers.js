const crypto = require('crypto');
const fs = require('fs-extra');
const path = require('path');

/**
 * Mask phone number for privacy
 * @param {string} phoneNumber - Full phone number
 * @returns {string} Masked phone number showing only last 4 digits
 */
function maskPhoneNumber(phoneNumber) {
  if (!phoneNumber || phoneNumber.length < 4) return phoneNumber;
  
  const maskingEnabled = process.env.MASK_PHONE_NUMBERS === 'true';
  if (!maskingEnabled) return phoneNumber;
  
  const last4 = phoneNumber.slice(-4);
  return 'XXXXXX' + last4;
}

/**
 * Format timestamp to user-friendly format
 * @param {number} timestamp - Unix timestamp
 * @returns {string} Formatted timestamp
 */
function formatTimestamp(timestamp) {
  const date = new Date(timestamp * 1000);
  const options = {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  };
  
  return date.toLocaleString('en-IN', options);
}

/**
 * Format uptime to human-readable string
 * @param {number} seconds - Uptime in seconds
 * @returns {string} Formatted uptime
 */
function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  
  let result = '';
  if (days > 0) result += `${days}d `;
  if (hours > 0) result += `${hours}h `;
  result += `${minutes}m`;
  
  return result;
}

/**
 * Format bytes to human-readable size
 * @param {number} bytes - Size in bytes
 * @returns {string} Formatted size
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Generate random delay for anti-ban
 * @param {number} min - Minimum delay in ms
 * @param {number} max - Maximum delay in ms
 * @returns {number} Random delay
 */
function getRandomDelay(min = 3000, max = 7000) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Sleep for specified milliseconds
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Extract message content from Baileys message structure
 * @param {object} message - Baileys message object
 * @returns {string} Message text content
 */
function getMessageContent(message) {
  if (!message) return '';
  
  return message.conversation ||
    message.extendedTextMessage?.text ||
    message.imageMessage?.caption ||
    message.videoMessage?.caption ||
    message.documentMessage?.caption ||
    '';
}

/**
 * Check if message is from a group
 * @param {string} jid - JID (chat identifier)
 * @returns {boolean} True if group chat
 */
function isGroupChat(jid) {
  return jid?.endsWith('@g.us') || false;
}

/**
 * Extract phone number from JID
 * @param {string} jid - JID (chat identifier)
 * @returns {string} Phone number
 */
function getPhoneFromJid(jid) {
  if (!jid) return '';
  return jid.split('@')[0].split(':')[0];
}

/**
 * Check if group name matches any in the list (case-insensitive partial match)
 * @param {string} groupName - Group name to check
 * @param {string[]} groupList - List of group names to match against
 * @returns {boolean} True if matches
 */
function matchesGroupName(groupName, groupList) {
  if (!groupName || !groupList || groupList.length === 0) return false;
  
  const lowerGroupName = groupName.toLowerCase();
  return groupList.some(name => 
    lowerGroupName.includes(name.toLowerCase()) || 
    name.toLowerCase().includes(lowerGroupName)
  );
}

/**
 * Generate unique message ID
 * @returns {string} Unique ID
 */
function generateId() {
  return `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

/**
 * Clean old files from directory
 * @param {string} directory - Directory path
 * @param {number} maxAge - Max age in milliseconds
 */
async function cleanOldFiles(directory, maxAge) {
  if (!await fs.pathExists(directory)) return;
  
  const files = await fs.readdir(directory);
  const now = Date.now();
  
  for (const file of files) {
    const filePath = path.join(directory, file);
    const stats = await fs.stat(filePath);
    
    if (now - stats.mtimeMs > maxAge) {
      await fs.remove(filePath);
    }
  }
}

/**
 * Exponential backoff retry logic
 * @param {Function} fn - Function to retry
 * @param {number} maxRetries - Maximum retry attempts
 * @param {number} baseDelay - Base delay in ms
 * @returns {Promise<any>} Result of function
 */
async function retryWithBackoff(fn, maxRetries = 3, baseDelay = 1000) {
  let lastError;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (i < maxRetries - 1) {
        const delay = baseDelay * Math.pow(2, i);
        await sleep(delay);
      }
    }
  }
  
  throw lastError;
}

module.exports = {
  maskPhoneNumber,
  formatTimestamp,
  formatUptime,
  formatBytes,
  getRandomDelay,
  sleep,
  getMessageContent,
  isGroupChat,
  getPhoneFromJid,
  matchesGroupName,
  generateId,
  cleanOldFiles,
  retryWithBackoff
};
