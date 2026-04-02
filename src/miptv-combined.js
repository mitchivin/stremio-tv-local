/**
 * miptv-combined.js
 * MIPTV addon that fetches TV channels from Xtream API with category support
 * Mounted at /miptv-combined/ by the main Express app.
 */

'use strict';

const { addonBuilder, getRouter } = require('stremio-addon-sdk');
const XtreamClient = require('./xtream-client');

let cache = null;
let categoriesCache = null;

function slugify(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function slugifyCategory(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function getCache() {
  const now = Date.now();
  if (cache && now < cache.expiry) return cache;

  const allChannels = [];
  const seen = new Set();

  console.log('[MIPTV] Fetching from Xtream API...');

  // Specific categories to include (exact matches)
  const allowedCategories = [
    'NZ| NEW ZEALAND HD/4K',
    'UK| GENERAL',
    'UK| BBC IPLAYER',
    'UK| SPORT HD/4K', // category 54 - UK| SPORT RAW VIP DOLBY
    'US| ENTERTAINMENT',
    'US| SPORT',
  ];
  
  // Also allow any category starting with AU|
  const allowedPrefixes = ['AU|'];

  try {
    const xtream = new XtreamClient();
    
    // Fetch channels
    const xtreamChannels = await xtream.getMIPTVChannels();
    console.log(`[MIPTV] Got ${xtreamChannels.length} channels from Xtream`);

    for (const entry of xtreamChannels) {
      const id = `miptv-xtream-${slugify(entry.name)}`;
      if (seen.has(id)) continue;
      
      const group = entry.group || 'Unknown';
      
      // Check if category is in allowed list or starts with allowed prefix
      const isAllowed = allowedCategories.includes(group) || 
                        allowedPrefixes.some(prefix => group.startsWith(prefix));
      
      if (!isAllowed) continue;
      
      seen.add(id);
      
      allChannels.push({
        id,
        name: entry.name,
        logo: entry.logo,
        url: entry.url,
        source: 'xtream',
        group: group,
      });
    }
    
    // Build categories from actual filtered channels
    const uniqueGroups = new Set(allChannels.map(ch => ch.group));
    categoriesCache = Array.from(uniqueGroups).sort();
    
  } catch (err) {
    console.error('[MIPTV] Xtream fetch failed:', err.message);
  }

  cache = { allChannels, expiry: now + 60 * 60 * 1000 };
  console.log(`[MIPTV] Cache built: ${allChannels.length} total channels, ${categoriesCache?.length || 0} categories`);
  return cache;
}

const manifest = {
  id: 'org.miptv-combined.iptv',
  version: '1.0.7',
  name: 'MIPTV (Filtered)',
  description: 'MIPTV — US, UK, AU, NZ channels only',
  resources: ['catalog', 'meta', { name: 'stream', types: ['tv'], idPrefixes: ['miptv-'] }],
  types: ['tv'],
  catalogs: [
    {
      type: 'tv',
      id: 'miptv-combined-channels',
      name: 'Channels',
    },
  ],
  idPrefixes: ['miptv-'],
};

const builder = new addonBuilder(manifest);

// Helper to get all categories
async function getCategories() {
  await getCache(); // Ensure cache is populated
  return categoriesCache || ['All'];
}

builder.defineCatalogHandler(async ({ type, id }) => {
  if (type !== 'tv' || id !== 'miptv-combined-channels') return { metas: [] };
  
  try {
    console.log(`[MIPTV] Catalog request: ${id}`);
    const { allChannels } = await getCache();
    
    console.log(`[MIPTV] Returning ${allChannels.length} filtered channels`);
    return {
      metas: allChannels.map((ch) => ({
        id: ch.id,
        type: 'tv',
        name: ch.name,
        poster: ch.logo || undefined,
        posterShape: 'square',
      })),
    };
  } catch (err) {
    console.error('[MIPTV] Catalog error:', err.message);
    return { metas: [] };
  }
});

builder.defineMetaHandler(async ({ id }) => {
  if (id.startsWith('miptv-')) {
    try {
      const { allChannels } = await getCache();
      const ch = allChannels.find(c => c.id === id);
      if (!ch) return { meta: null };
      return {
        meta: {
          id,
          type: 'tv',
          name: ch.name,
          poster: ch.logo || undefined,
          posterShape: 'square',
        },
      };
    } catch {
      return { meta: null };
    }
  }
  return { meta: null };
});

builder.defineStreamHandler(async ({ id }) => {
  try {
    const { allChannels } = await getCache();
    if (id.startsWith('miptv-')) {
      const ch = allChannels.find(c => c.id === id);
      if (!ch) return { streams: [] };
      
      // Extract domain from URL for the title
      let urlTitle;
      try {
        const urlObj = new URL(ch.url);
        urlTitle = urlObj.hostname.replace(/^www\./, '');
      } catch {
        urlTitle = ch.url.split('/')[2] || ch.url.substring(0, 30);
      }
      
      return {
        streams: [
          { url: ch.url, name: 'Xtream', title: urlTitle, behaviorHints: { notWebReady: false } },
        ],
      };
    }
    return { streams: [] };
  } catch (err) {
    console.error('[MIPTV] Stream error:', err.message);
    return { streams: [] };
  }
});

module.exports = getRouter(builder.getInterface());
