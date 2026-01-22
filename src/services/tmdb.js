const axios = require('axios');
const logger = require('../utils/logger');
const { retryWithBackoff, sleep } = require('../utils/helpers');

class TMDBService {
  constructor() {
    this.apiKey = process.env.TMDB_API_KEY;
    this.baseURL = 'https://api.themoviedb.org/3';
    this.timeout = parseInt(process.env.TIMEOUT) || 20000;
    this.maxRetries = parseInt(process.env.MAX_RETRIES) || 10;
    this.cache = new Map();
    this.cacheExpiry = 3600000; // 1 hour
    
    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: this.timeout,
      headers: {
        'Accept': 'application/json'
      }
    });
  }

  /**
   * Get country flag emoji from ISO code
   * @param {string} isoCode - Two-letter country ISO code
   * @returns {string} Flag emoji
   */
  getCountryFlag(isoCode) {
    if (!isoCode || isoCode.length !== 2) return '';
    const codePoints = isoCode
      .toUpperCase()
      .split('')
      .map(char => 0x1F1E6 - 65 + char.charCodeAt());
    return String.fromCodePoint(...codePoints);
  }

  /**
   * Get cached result or fetch new
   * @param {string} key - Cache key
   * @param {Function} fetchFn - Function to fetch if not cached
   * @returns {Promise<any>} Result
   */
  async getCached(key, fetchFn) {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
      logger.debug(`TMDB cache hit: ${key}`);
      return cached.data;
    }

    const data = await fetchFn();
    this.cache.set(key, { data, timestamp: Date.now() });
    
    // Clean old cache entries
    if (this.cache.size > 1000) {
      const oldestKeys = Array.from(this.cache.entries())
        .sort((a, b) => a[1].timestamp - b[1].timestamp)
        .slice(0, 500)
        .map(([key]) => key);
      oldestKeys.forEach(key => this.cache.delete(key));
    }
    
    return data;
  }

  /**
   * Search for movies
   * @param {string} query - Search query
   * @returns {Promise<object[]>} Top 5 movie results
   */
  async searchMovie(query) {
    const cacheKey = `movie:${query.toLowerCase()}`;
    
    try {
      return await this.getCached(cacheKey, async () => {
        return retryWithBackoff(async () => {
          logger.movie(`Searching movie: ${query}`);
          
          const response = await this.client.get('/search/movie', {
            params: {
              api_key: this.apiKey,
              query: query,
              language: 'en-US',
              page: 1,
              region: 'IN'
            }
          });

          // Safely handle response data
          const results = (response?.data?.results || []).slice(0, 5).map((movie, index) => ({
            index: index + 1,
            id: movie.id,
            title: movie.title || 'Unknown Title',
            year: movie.release_date ? movie.release_date.split('-')[0] : 'N/A',
            rating: movie.vote_average || 'N/A',
            overview: movie.overview || 'No overview available'
          }));

          logger.success(`Found ${results.length} movies for: ${query}`);
          return results;
        }, this.maxRetries, 1000);
      });
    } catch (error) {
      logger.error(`TMDB movie search failed for "${query}": ${error.message}`);
      // Return empty array instead of throwing to prevent crashes
      return [];
    }
  }

  /**
   * Search for TV series
   * @param {string} query - Search query
   * @returns {Promise<object[]>} Top 5 series results
   */
  async searchSeries(query) {
    const cacheKey = `series:${query.toLowerCase()}`;
    
    try {
      return await this.getCached(cacheKey, async () => {
        return retryWithBackoff(async () => {
          logger.movie(`Searching series: ${query}`);
          
          const response = await this.client.get('/search/tv', {
            params: {
              api_key: this.apiKey,
              query: query,
              language: 'en-US',
              page: 1
            }
          });

          // Safely handle response data
          const results = (response?.data?.results || []).slice(0, 5).map((series, index) => ({
            index: index + 1,
            id: series.id,
            title: series.name || 'Unknown Title',
            year: series.first_air_date ? series.first_air_date.split('-')[0] : 'N/A',
            rating: series.vote_average || 'N/A',
            overview: series.overview || 'No overview available'
          }));

          logger.success(`Found ${results.length} series for: ${query}`);
          return results;
        }, this.maxRetries, 1000);
      });
    } catch (error) {
      logger.error(`TMDB series search failed for "${query}": ${error.message}`);
      // Return empty array instead of throwing to prevent crashes
      return [];
    }
  }

  /**
   * Get detailed movie information
   * @param {number} movieId - TMDB movie ID
   * @returns {Promise<object|null>} Movie details or null on failure
   */
  async getMovieDetails(movieId) {
    const cacheKey = `movie-details:${movieId}`;
    
    try {
      return await this.getCached(cacheKey, async () => {
        return retryWithBackoff(async () => {
          logger.movie(`Fetching movie details: ${movieId}`);
          
          // Fetch multiple endpoints in parallel with individual error handling
          const [details, credits, videos, watchProviders, externalIds] = await Promise.all([
            this.client.get(`/movie/${movieId}`, {
              params: { api_key: this.apiKey, language: 'en-US' }
            }).catch(err => { logger.debug(`Failed to fetch movie details: ${err.message}`); return { data: {} }; }),
            this.client.get(`/movie/${movieId}/credits`, {
              params: { api_key: this.apiKey }
            }).catch(err => { logger.debug(`Failed to fetch credits: ${err.message}`); return { data: { cast: [] } }; }),
            this.client.get(`/movie/${movieId}/videos`, {
              params: { api_key: this.apiKey, language: 'en-US' }
            }).catch(err => { logger.debug(`Failed to fetch videos: ${err.message}`); return { data: { results: [] } }; }),
            this.client.get(`/movie/${movieId}/watch/providers`, {
              params: { api_key: this.apiKey }
            }).catch(err => { logger.debug(`Failed to fetch watch providers: ${err.message}`); return { data: { results: {} } }; }),
            this.client.get(`/movie/${movieId}/external_ids`, {
              params: { api_key: this.apiKey }
            }).catch(err => { logger.debug(`Failed to fetch external IDs: ${err.message}`); return { data: {} }; })
          ]);

          const movie = details.data || {};
          
          // Handle case where main movie data is missing
          if (!movie.title) {
            throw new Error('Movie data not found');
          }
          
          const cast = (credits.data?.cast || []).slice(0, 5).map(actor => actor.name);
          
          // Find trailer (prioritize Hindi, Bengali, English)
          const videoResults = videos.data?.results || [];
          const trailer = videoResults.find(v => v.type === 'Trailer' && v.site === 'YouTube' && 
            ['hi', 'bn', 'en'].includes(v.iso_639_1)) || 
            videoResults.find(v => v.type === 'Trailer' && v.site === 'YouTube');

          // Get Indian streaming providers
          const providers = watchProviders.data?.results?.IN;
          const streaming = [];
          const streamingDetails = [];
          if (providers?.flatrate) {
            providers.flatrate.forEach(p => {
              streaming.push(p.provider_name);
              streamingDetails.push({
                name: p.provider_name,
                logo: p.logo_path ? `https://image.tmdb.org/t/p/original${p.logo_path}` : null
              });
            });
          }

          // Get origin country with flag
          const originCountry = movie.origin_country && movie.origin_country.length > 0 
            ? movie.origin_country[0] 
            : movie.production_countries && movie.production_countries.length > 0
              ? movie.production_countries[0].iso_3166_1
              : null;
          const countryFlag = originCountry ? this.getCountryFlag(originCountry) : '';

          // Get genres
          const genres = movie.genres && movie.genres.length > 0
            ? movie.genres.map(g => g.name).join(', ')
            : 'N/A';

          // Get collection/universe info
          let collectionInfo = null;
          if (movie.belongs_to_collection) {
            collectionInfo = {
              name: movie.belongs_to_collection.name,
              id: movie.belongs_to_collection.id
            };
          }

          // Get IMDb link
          const imdbId = externalIds.data?.imdb_id;
          const imdbLink = imdbId ? `https://www.imdb.com/title/${imdbId}` : null;

          // Build watch links - JustWatch aggregates all platforms on one page
          const movieTitle = movie.title || 'unknown';
          const justWatchLink = `https://www.justwatch.com/in/movie/${movieTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

          return {
            title: movie.title,
            releaseDate: movie.release_date || 'N/A',
            year: movie.release_date ? movie.release_date.split('-')[0] : 'N/A',
            rating: movie.vote_average ? movie.vote_average.toFixed(1) : 'N/A',
            description: movie.overview || 'No description available',
            cast: cast.length > 0 ? cast : [],
            genres,
            originCountry,
            countryFlag,
            poster: movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : null,
            trailer: trailer ? `https://www.youtube.com/watch?v=${trailer.key}` : null,
            streaming: streaming.length > 0 ? streaming : [],
            streamingDetails,
            justWatchLink,
            collectionInfo,
            imdbLink,
            runtime: movie.runtime || null
          };
        }, this.maxRetries, 1000);
      });
    } catch (error) {
      logger.error(`TMDB movie details failed for ID ${movieId}: ${error.message}`);
      return null;
    }
  }

  /**
   * Get detailed series information
   * @param {number} seriesId - TMDB series ID
   * @returns {Promise<object|null>} Series details or null on failure
   */
  async getSeriesDetails(seriesId) {
    const cacheKey = `series-details:${seriesId}`;
    
    try {
      return await this.getCached(cacheKey, async () => {
        return retryWithBackoff(async () => {
          logger.movie(`Fetching series details: ${seriesId}`);
          
          // Fetch multiple endpoints in parallel with individual error handling
          const [details, credits, videos, watchProviders, externalIds] = await Promise.all([
            this.client.get(`/tv/${seriesId}`, {
              params: { api_key: this.apiKey, language: 'en-US' }
            }).catch(err => { logger.debug(`Failed to fetch series details: ${err.message}`); return { data: {} }; }),
            this.client.get(`/tv/${seriesId}/credits`, {
              params: { api_key: this.apiKey }
            }).catch(err => { logger.debug(`Failed to fetch credits: ${err.message}`); return { data: { cast: [] } }; }),
            this.client.get(`/tv/${seriesId}/videos`, {
              params: { api_key: this.apiKey, language: 'en-US' }
            }).catch(err => { logger.debug(`Failed to fetch videos: ${err.message}`); return { data: { results: [] } }; }),
            this.client.get(`/tv/${seriesId}/watch/providers`, {
              params: { api_key: this.apiKey }
            }).catch(err => { logger.debug(`Failed to fetch watch providers: ${err.message}`); return { data: { results: {} } }; }),
            this.client.get(`/tv/${seriesId}/external_ids`, {
              params: { api_key: this.apiKey }
            }).catch(err => { logger.debug(`Failed to fetch external IDs: ${err.message}`); return { data: {} }; })
          ]);

          const series = details.data || {};
          
          // Handle case where main series data is missing
          if (!series.name) {
            throw new Error('Series data not found');
          }
          
          const cast = (credits.data?.cast || []).slice(0, 5).map(actor => actor.name);
          
          const videoResults = videos.data?.results || [];
          const trailer = videoResults.find(v => v.type === 'Trailer' && v.site === 'YouTube' && 
            ['hi', 'bn', 'en'].includes(v.iso_639_1)) || 
            videoResults.find(v => v.type === 'Trailer' && v.site === 'YouTube');

          const providers = watchProviders.data?.results?.IN;
          const streaming = [];
          const streamingDetails = [];
          if (providers?.flatrate) {
            providers.flatrate.forEach(p => {
              streaming.push(p.provider_name);
              streamingDetails.push({
                name: p.provider_name,
                logo: p.logo_path ? `https://image.tmdb.org/t/p/original${p.logo_path}` : null
              });
            });
          }

          // Get origin country with flag
          const originCountry = series.origin_country && series.origin_country.length > 0 
            ? series.origin_country[0] 
            : series.production_countries && series.production_countries.length > 0
              ? series.production_countries[0].iso_3166_1
              : null;
          const countryFlag = originCountry ? this.getCountryFlag(originCountry) : '';

          // Get genres
          const genres = series.genres && series.genres.length > 0
            ? series.genres.map(g => g.name).join(', ')
            : 'N/A';

          // Get IMDb link
          const imdbId = externalIds.data?.imdb_id;
          const imdbLink = imdbId ? `https://www.imdb.com/title/${imdbId}` : null;

          // Build watch link - JustWatch aggregates all platforms on one page
          const seriesName = series.name || 'unknown';
          const justWatchLink = `https://www.justwatch.com/in/tv-show/${seriesName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

          return {
            title: series.name,
            releaseDate: series.first_air_date || 'N/A',
            year: series.first_air_date ? series.first_air_date.split('-')[0] : 'N/A',
            rating: series.vote_average ? series.vote_average.toFixed(1) : 'N/A',
            description: series.overview || 'No description available',
            cast: cast.length > 0 ? cast : [],
            genres,
            originCountry,
            countryFlag,
            poster: series.poster_path ? `https://image.tmdb.org/t/p/w500${series.poster_path}` : null,
            trailer: trailer ? `https://www.youtube.com/watch?v=${trailer.key}` : null,
            streaming: streaming.length > 0 ? streaming : [],
            streamingDetails,
            justWatchLink,
            imdbLink,
            numberOfSeasons: series.number_of_seasons || null,
            numberOfEpisodes: series.number_of_episodes || null,
            status: series.status || 'N/A'
          };
        }, this.maxRetries, 1000);
      });
    } catch (error) {
      logger.error(`TMDB series details failed for ID ${seriesId}: ${error.message}`);
      return null;
    }
  }

  /**
   * Download poster image
   * @param {string} url - Poster URL
   * @returns {Promise<Buffer>} Image buffer
   */
  async downloadPoster(url) {
    if (!url) return null;
    
    try {
      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: this.timeout
      });
      return Buffer.from(response.data);
    } catch (error) {
      logger.error(`Failed to download poster: ${error.message}`);
      return null;
    }
  }

  /**
   * Test TMDB API connectivity
   * @returns {Promise<object>} Test result
   */
  async testConnection() {
    try {
      const start = Date.now();
      const response = await this.client.get('/configuration', {
        params: { api_key: this.apiKey }
      });
      const duration = Date.now() - start;
      
      return {
        success: true,
        duration,
        message: `TMDB API connected successfully (${duration}ms)`
      };
    } catch (error) {
      return {
        success: false,
        message: `TMDB API connection failed: ${error.message}`
      };
    }
  }
}

module.exports = TMDBService;
