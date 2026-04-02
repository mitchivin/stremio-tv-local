/**
 * Xtream Codes API Client
 * Fetches live TV channels from Xtream API using native fetch
 */

require('dotenv').config();

const XTREAM_URL = process.env.XTREAM_URL || 'http://ayegi.xyz';
const XTREAM_USERNAME = process.env.XTREAM_USERNAME;
const XTREAM_PASSWORD = process.env.XTREAM_PASSWORD;

class XtreamClient {
  constructor() {
    this.baseUrl = XTREAM_URL.replace(/\/$/, '');
    this.username = XTREAM_USERNAME;
    this.password = XTREAM_PASSWORD;
  }

  /**
   * Make API request using native fetch
   */
  async apiRequest(action, params = {}) {
    const url = new URL(`${this.baseUrl}/player_api.php`);
    url.searchParams.append('username', this.username);
    url.searchParams.append('password', this.password);
    url.searchParams.append('action', action);
    
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.append(key, value);
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      const response = await fetch(url.toString(), {
        signal: controller.signal,
        headers: {
          'User-Agent': 'MIPTV-Addon/1.0'
        }
      });
      
      clearTimeout(timeout);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      return await response.json();
    } catch (error) {
      clearTimeout(timeout);
      throw error;
    }
  }

  /**
   * Get all live TV categories
   */
  async getLiveCategories() {
    try {
      const data = await this.apiRequest('get_live_categories');
      return data || [];
    } catch (error) {
      console.error('[Xtream] Failed to get categories:', error.message);
      return [];
    }
  }

  /**
   * Get all live TV streams
   */
  async getLiveStreams() {
    try {
      const data = await this.apiRequest('get_live_streams');
      return data || [];
    } catch (error) {
      console.error('[Xtream] Failed to get live streams:', error.message);
      return [];
    }
  }

  /**
   * Generate stream URL for a channel
   */
  getStreamUrl(streamId, extension = 'm3u8') {
    return `${this.baseUrl}/live/${this.username}/${this.password}/${streamId}.${extension}`;
  }

  /**
   * Convert Xtream stream to MIPTV format with category mapping
   */
  convertToMIPTVFormat(streams, categoryMap) {
    return streams.map(stream => {
      // Look up category name by ID
      let categoryName = 'Unknown';
      if (stream.category_id && categoryMap[stream.category_id]) {
        categoryName = categoryMap[stream.category_id];
      } else if (stream.category_name) {
        categoryName = stream.category_name;
      }
      
      const sanitizedCategory = this.sanitizeCategoryName(categoryName);
      // Use 'ts' (MPEG-TS) format for more stable live TV streaming
      const streamUrl = this.getStreamUrl(stream.stream_id, 'ts');
      
      return {
        name: stream.name || 'Unknown Channel',
        url: streamUrl,
        group: sanitizedCategory,
        logo: stream.stream_icon || '',
        id: stream.stream_id,
        epg_id: stream.epg_channel_id || '',
        category_id: stream.category_id
      };
    });
  }

  /**
   * Sanitize category name for group-title
   */
  sanitizeCategoryName(name) {
    if (!name) return 'Unknown';
    // Keep more characters, just trim and basic cleanup
    return name
      .replace(/[^\w\s&|\.\/\-\(\)\[\]]/g, '')
      .trim() || 'Unknown';
  }

  /**
   * Get channels formatted for MIPTV with proper category mapping
   */
  async getMIPTVChannels() {
    try {
      // Fetch categories first to build ID mapping
      console.log('[Xtream] Fetching categories...');
      const categories = await this.getLiveCategories();
      console.log(`[Xtream] Got ${categories.length} categories`);
      
      // Build category ID to name map
      const categoryMap = {};
      categories.forEach(cat => {
        if (cat.category_id && cat.category_name) {
          categoryMap[cat.category_id] = cat.category_name;
        }
      });
      
      // Debug: log first few categories
      const catIds = Object.keys(categoryMap).slice(0, 5);
      console.log('[Xtream] Sample categories:', catIds.map(id => `${id}: ${categoryMap[id]}`));
      
      console.log('[Xtream] Fetching live streams...');
      const streams = await this.getLiveStreams();
      console.log(`[Xtream] Got ${streams.length} streams`);
      
      // Debug: check first few streams for category_id
      if (streams.length > 0) {
        console.log('[Xtream] Sample stream category_ids:', streams.slice(0, 5).map(s => s.category_id || 'null'));
      }
      
      if (streams.length === 0) {
        console.warn('[Xtream] No streams returned from API');
        return [];
      }

      const formatted = this.convertToMIPTVFormat(streams, categoryMap);
      console.log(`[Xtream] Converted ${formatted.length} channels to MIPTV format`);
      return formatted;
    } catch (error) {
      console.error('[Xtream] Error getting MIPTV channels:', error);
      return [];
    }
  }
}

module.exports = XtreamClient;
