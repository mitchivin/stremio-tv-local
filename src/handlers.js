/**
 * handlers.js
 * Defines the catalog handler and (channel-only) stream handler.
 *
 * Content type behaviour:
 *  - "movie" / "series" / "tv": this addon provides the catalog row; the user's
 *    installed streaming addons supply the actual streams via the item's ID.
 *    We deliberately do NOT register a stream handler for any of these
 *    types so Stremio falls through naturally to other addons.
 */

'use strict';

const { fetchResilient } = require('./fetch-utils');

/**
 * Build a Stremio MetaPreview for a movie/series/tv-type item (library or external addon item).
 * The id must match what external addons expect (IMDB ID or addon-specific ID).
 * baseUrl is used to resolve relative /logos/ paths to absolute URLs for Stremio.
 */
function libraryMeta(item, baseUrl) {
  const type = item.type || 'movie';
  let poster = item.thumbnail || '';
  // Resolve relative logo paths — Stremio needs absolute URLs
  if (poster.startsWith('/') && baseUrl) {
    poster = baseUrl + poster;
  }
  return {
    id: item.id,
    type: type,
    name: item.title,
    description: item.description || '',
    poster: poster,
    posterShape: type === 'tv' ? 'square' : 'poster',
    background: poster,
    imdbRating: item.imdbRating || undefined,
  };
}

/**
 * Register both handlers on the given addonBuilder instance.
 */
function registerHandlers(builder, configProvider) {
  // ── Catalog handler ────────────────────────────────────────────────────────
  builder.defineCatalogHandler(function (args) {
    const { type, id, extra } = args;
    const cfg = configProvider();
    const { rows, baseUrl } = cfg;

    // Match row by ID and type
    const rowId = id;

    const row = rows.find((r) => r.id === rowId && (r.contentType || 'movie') === type);
    if (!row || !Array.isArray(row.items)) return Promise.resolve({ metas: [] });

    const skip = parseInt(extra?.skip || 0, 10);
    const allMetas = row.items
      .filter((s) => s && (s.type || 'movie') === type)
      .map((s) => libraryMeta(s, baseUrl));

    const metas = skip >= allMetas.length ? [] : allMetas.slice(skip);
    console.log(
      `[catalog] "${row.name}" (${type}/${rowId}) skip=${skip} → ${metas.length} item(s)`
    );
    return Promise.resolve({ metas });
  });

  // ── Meta handler for custom channels ──────────────────────────────────────
  builder.defineMetaHandler(function ({ type: _type, id }) {
    if (!id.startsWith('stremirow-')) return Promise.resolve({ meta: null });
    const cfg = configProvider();
    const { rows, baseUrl } = cfg;
    for (const row of rows) {
      const item = (row.items || []).find((i) => i.id === id);
      if (item) {
        return Promise.resolve({ meta: libraryMeta(item, baseUrl) });
      }
    }
    return Promise.resolve({ meta: null });
  });

  // ── Stream handler for custom channels ────────────────────────────────────
  
  // Helper: Resolve channel by name + source type (survives ID changes)
  async function resolveChannelId(addonUrl, channelName, sourceType) {
    try {
      // Fetch current catalog from MIPTV
      const catalogUrl = `${addonUrl}/catalog/tv/miptv-combined-channels.json`;
      const res = await fetchResilient(catalogUrl, {
        timeout: 5000,
        maxRetries: 1,
        headers: { 'User-Agent': 'stremirow/1.0' }
      });
      
      if (!res.ok) return null;
      
      const data = await res.json();
      const channels = data.metas || [];
      
      // Find matching channel by name (case-insensitive, ignore [BU] suffix)
      const normalizedSearch = channelName.toLowerCase().replace(/\s*\[bu\]$/i, '').trim();
      
      for (const ch of channels) {
        const normalizedCh = (ch.name || '').toLowerCase().replace(/\s*\[bu\]$/i, '').trim();
        if (normalizedCh === normalizedSearch) {
          // Check if source type matches
          const isBackup = ch.id && ch.id.startsWith('miptv-backup-');
          const isPrimary = ch.id && ch.id.match(/^miptv-(primary|news|sports|entertainment)-/);
          
          if (sourceType === 'backup' && isBackup) return ch.id;
          if (sourceType === 'primary' && isPrimary) return ch.id;
          // If no source type specified, return first match
          if (!sourceType) return ch.id;
        }
      }
      
      return null;
    } catch (e) {
      console.error('[resolveChannelId] Failed:', e.message);
      return null;
    }
  }
  
  builder.defineStreamHandler(async function ({ id }) {
    if (!id.startsWith('stremirow-')) return { streams: [] };
    const config = configProvider();
    const { rows } = config;
    let sources = [];

    for (const row of rows) {
      const item = (row.items || []).find((i) => i.id === id);
      if (item && Array.isArray(item.sources)) {
        sources = item.sources;
        break;
      }
    }

    if (!sources.length && config._orphanCustomChannels) {
      const orphan = config._orphanCustomChannels.find((i) => i.id === id);
      if (orphan && Array.isArray(orphan.sources)) {
        sources = orphan.sources;
      }
    }

    if (!sources.length) return { streams: [] };

    const streams = [];
    for (let srcIdx = 0; srcIdx < sources.length; srcIdx++) {
      const src = sources[srcIdx];
      try {
        // Use name-based lookup if available, fallback to stored ID
        let resolvedId = src.channelId;
        if (src.channelName) {
          const sourceType = src.sourceType || (src.channelId?.includes('backup') ? 'backup' : 'primary');
          const lookedUp = await resolveChannelId(src.addonUrl, src.channelName, sourceType);
          if (lookedUp) {
            resolvedId = lookedUp;
            console.log(`[stream] Resolved "${src.channelName}" → ${lookedUp}`);
          } else {
            console.warn(`[stream] Could not resolve "${src.channelName}", using stored ID`);
          }
        }
        
        const url = `${src.addonUrl}/stream/tv/${encodeURIComponent(resolvedId)}.json`;
        
        // Use resilient fetch with timeouts and retry
        const res = await fetchResilient(url, {
          timeout: 5000,
          maxRetries: 2,
          retryDelay: 300,
          headers: { 'User-Agent': 'stremirow/1.0' }
        });
        
        if (!res.ok) {
          console.warn(`[stream] Source ${srcIdx} returned status ${res.status}: ${src.addonUrl}`);
          continue;
        }
        
        const data = await res.json();
        const sourceName = srcIdx === 0 ? 'Primary' : `Backup ${srcIdx}`;
        (data.streams || []).forEach((s) => {
          // Extract URL from the stream for the title
          let streamUrl = s.url || '';
          let urlTitle;
          try {
            const urlObj = new URL(streamUrl);
            urlTitle = urlObj.hostname.replace(/^www\./, '');
          } catch {
            urlTitle = streamUrl.split('/')[2] || streamUrl.substring(0, 30);
          }
          streams.push({ ...s, name: sourceName, title: urlTitle });
        });
      } catch (e) {
        console.error(`[stream] failed ${src.addonUrl}:`, e.message);
      }
    }

    return { streams };
  });
}

module.exports = { registerHandlers };
