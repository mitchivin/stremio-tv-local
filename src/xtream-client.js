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
   * Convert Xtream stream to MIPTV format
   */
  convertToMIPTVFormat(streams) {
    return streams.map(stream => {
      const categoryName = this.sanitizeCategoryName(stream.category_name || 'Unknown');
      const streamUrl = this.getStreamUrl(stream.stream_id, stream.container_extension || 'm3u8');
      
      return {
        name: stream.name || 'Unknown Channel',
        url: streamUrl,
        group: categoryName,
        logo: stream.stream_icon || '',
        id: stream.stream_id,
        epg_id: stream.epg_channel_id || ''
      };
    });
  }

  /**
   * Sanitize category name for group-title
   */
  sanitizeCategoryName(name) {
    if (!name) return 'Unknown';
    return name
      .replace(/[^a-zA-Z0-9 &\-]/g, '')
      .trim();
  }

  /**
   * Get channels formatted for MIPTV
   */
  async getMIPTVChannels() {
    try {
      console.log('[Xtream] Fetching live streams...');
      const streams = await this.getLiveStreams();
      console.log(`[Xtream] Got ${streams.length} streams`);
      
      if (streams.length === 0) {
        console.warn('[Xtream] No streams returned from API');
        return [];
      }

      const formatted = this.convertToMIPTVFormat(streams);
      console.log(`[Xtream] Converted ${formatted.length} channels to MIPTV format`);
      return formatted;
    } catch (error) {
      console.error('[Xtream] Error getting MIPTV channels:', error);
      return [];
    }
  }
}

module.exports = XtreamClient;
