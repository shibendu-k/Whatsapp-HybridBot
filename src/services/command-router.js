const logger = require('../utils/logger');
const { getMessageContent } = require('../utils/helpers');

class CommandRouter {
  constructor() {
    this.userSearches = new Map(); // Store user search states
    this.rateLimits = new Map(); // Store rate limit data per user
  }

  /**
   * Check rate limit for user
   * @param {string} userId - User ID
   * @param {object} config - Rate limit configuration
   * @returns {object} Rate limit status
   */
  checkRateLimit(userId, config) {
    const now = Date.now();
    const userLimit = this.rateLimits.get(userId) || { requests: [], resetTime: now + config.windowMs };
    
    // Remove old requests outside the window
    userLimit.requests = userLimit.requests.filter(time => now - time < config.windowMs);
    
    if (userLimit.requests.length >= config.maxRequests) {
      const oldestRequest = userLimit.requests[0];
      const remainingTime = Math.ceil((oldestRequest + config.windowMs - now) / 1000);
      return {
        allowed: false,
        remainingTime
      };
    }
    
    userLimit.requests.push(now);
    this.rateLimits.set(userId, userLimit);
    
    return { allowed: true };
  }

  /**
   * Store user search state
   * @param {string} userId - User ID
   * @param {object} searchData - Search results and type
   */
  setUserSearch(userId, searchData) {
    this.userSearches.set(userId, {
      ...searchData,
      timestamp: Date.now()
    });
    
    // Clean old searches (older than 10 minutes)
    setTimeout(() => {
      const search = this.userSearches.get(userId);
      if (search && Date.now() - search.timestamp > 600000) {
        this.userSearches.delete(userId);
      }
    }, 600000);
  }

  /**
   * Get user search state
   * @param {string} userId - User ID
   * @returns {object|null} Search state
   */
  getUserSearch(userId) {
    const search = this.userSearches.get(userId);
    if (!search) return null;
    
    // Check if expired (10 minutes)
    if (Date.now() - search.timestamp > 600000) {
      this.userSearches.delete(userId);
      return null;
    }
    
    return search;
  }

  /**
   * Parse command from message
   * @param {string} message - Message text
   * @param {string} prefix - Command prefix
   * @returns {object} Parsed command
   */
  parseCommand(message, prefix = '!') {
    const text = message.trim();
    
    // Check for number selection (1-5)
    if (/^[1-5]$/.test(text)) {
      return {
        type: 'selection',
        value: parseInt(text)
      };
    }
    
    // Check for commands
    if (text.startsWith(prefix)) {
      const parts = text.slice(prefix.length).split(' ');
      const command = parts[0].toLowerCase();
      const args = parts.slice(1).join(' ').trim();
      
      // Movie commands
      if (['movie', 'm'].includes(command)) {
        return {
          type: 'movie_search',
          query: args
        };
      }
      
      // Series commands
      if (['series', 's', 'tv'].includes(command)) {
        return {
          type: 'series_search',
          query: args
        };
      }
    }
    
    return { type: 'none' };
  }

  /**
   * Format search results message
   * @param {object[]} results - Search results
   * @param {string} type - 'movie' or 'series'
   * @returns {string} Formatted message
   */
  formatSearchResults(results, type) {
    if (!results || results.length === 0) {
      return `❌ No ${type}s found. Try a different search term.`;
    }
    
    const emoji = type === 'movie' ? '🎬' : '📺';
    let message = `${emoji} *Top ${results.length} ${type === 'movie' ? 'Movies' : 'Series'}:*\n\n`;
    
    results.forEach(item => {
      message += `*${item.index}.* ${item.title} (${item.year})\n`;
      message += `⭐ Rating: ${item.rating}/10\n\n`;
    });
    
    message += `Reply with a number (1-${results.length}) to get full details.`;
    
    return message;
  }

  /**
   * Format detailed information message
   * @param {object} details - Movie/Series details
   * @returns {string} Formatted message
   */
  formatDetails(details) {
    let message = `🎬 *${details.title}* (${details.year})\n`;
    message += `━━━━━━━━━━━━━━━━\n\n`;
    message += `⭐ *IMDB Rating:* ${details.rating}/10\n\n`;
    message += `📄 *Description:*\n${details.description}\n\n`;
    message += `🎭 *Cast:* ${details.cast}\n\n`;
    message += `📺 *Streaming:* ${details.streaming}\n\n`;
    
    if (details.trailer) {
      message += `🎥 *Trailer:* ${details.trailer}\n\n`;
    }
    
    message += `🔗 *Watch:* ${details.watchLink}`;
    
    return message;
  }

  /**
   * Format detailed information as caption for poster
   * @param {object} details - Movie/Series details
   * @param {string} type - 'movie' or 'series'
   * @returns {string} Formatted caption
   */
  formatDetailsCaption(details, type) {
    const emoji = type === 'movie' ? '🎬' : '📺';
    let caption = '';
    
    // Title with country flag
    caption += `${emoji} *${details.title}`;
    if (details.countryFlag) {
      caption += ` ${details.countryFlag}`;
    }
    caption += `*\n`;
    caption += `━━━━━━━━━━━━━━━━━━━━\n\n`;
    
    // Release date
    caption += `📅 *Release Date:* ${details.releaseDate}\n`;
    
    // Genre
    caption += `🎭 *Genre:* ${details.genres}\n`;
    
    // Rating
    caption += `⭐ *Rating:* ${details.rating}/10\n`;
    
    // For series, add season/episode info
    if (type === 'series') {
      if (details.numberOfSeasons) {
        caption += `📺 *Seasons:* ${details.numberOfSeasons}`;
        if (details.numberOfEpisodes) {
          caption += ` | *Episodes:* ${details.numberOfEpisodes}`;
        }
        caption += `\n`;
      }
      if (details.status && details.status !== 'N/A') {
        caption += `📊 *Status:* ${details.status}\n`;
      }
    } else if (type === 'movie' && details.runtime) {
      caption += `⏱️ *Runtime:* ${details.runtime} min\n`;
    }
    
    caption += `\n`;
    
    // Story/Description
    caption += `📖 *Story:*\n${details.description}\n\n`;
    
    // Collection/Universe info
    if (details.collectionInfo) {
      caption += `🌌 *Part of:* ${details.collectionInfo.name}\n\n`;
    }
    
    // Top 5 actors horizontally with emojis
    if (details.cast && details.cast.length > 0) {
      caption += `👥 *Cast:*\n`;
      caption += details.cast.map((actor, i) => `   ${i + 1}. ${actor}`).join('\n');
      caption += `\n\n`;
    }
    
    // Trailer
    if (details.trailer) {
      caption += `🎥 *Trailer:*\n${details.trailer}\n\n`;
    }
    
    // Streaming platforms
    if (details.streaming && details.streaming.length > 0) {
      caption += `📺 *Available on:*\n`;
      details.streaming.forEach(platform => {
        caption += `   • ${platform}\n`;
      });
      caption += `\n`;
    } else {
      caption += `📺 *Streaming:* Not available on major platforms\n\n`;
    }
    
    // Watch links
    if (details.watchLinks && details.watchLinks.length > 0) {
      caption += `🔗 *Watch Links:*\n`;
      const uniquePlatforms = [...new Set(details.watchLinks.map(w => w.platform))];
      uniquePlatforms.forEach(platform => {
        const link = details.watchLinks.find(w => w.platform === platform)?.link;
        if (link) {
          caption += `   • ${platform}: ${link}\n`;
        }
      });
      caption += `\n`;
    }
    
    // IMDb link
    if (details.imdbLink) {
      caption += `⭐ *IMDb:* ${details.imdbLink}\n`;
    }
    
    caption += `\n━━━━━━━━━━━━━━━━━━━━\n`;
    caption += `_Powered by TMDB_`;
    
    return caption;
  }

  /**
   * Clean up expired data periodically
   */
  startCleanupInterval() {
    setInterval(() => {
      const now = Date.now();
      
      // Clean user searches
      for (const [userId, search] of this.userSearches.entries()) {
        if (now - search.timestamp > 600000) {
          this.userSearches.delete(userId);
        }
      }
      
      // Clean rate limits
      for (const [userId, limit] of this.rateLimits.entries()) {
        limit.requests = limit.requests.filter(time => now - time < 60000);
        if (limit.requests.length === 0) {
          this.rateLimits.delete(userId);
        }
      }
      
      logger.debug(`Cleaned up command router cache. Searches: ${this.userSearches.size}, Rate limits: ${this.rateLimits.size}`);
    }, 300000); // Every 5 minutes
  }
}

module.exports = CommandRouter;
