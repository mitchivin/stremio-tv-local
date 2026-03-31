/**
 * miptv-combined.js
 * Combined MIPTV addon that fetches TV channels from multiple sources
 * Mounted at /miptv-combined/ by the main Express app.
 */

'use strict';

const { addonBuilder, getRouter } = require('stremio-addon-sdk');
const fs = require('fs');
const path = require('path');

const MIPTV_SOURCES = [
  'file://src/public/channels.m3u',
];

const MIPTV_BACKUP_SOURCE = 'file://src/public/backup.m3u';

const FETCH_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  Accept: '*/*',
};

// Non-English language patterns to exclude
const NON_ENGLISH_PATTERNS = [
  /🇵🇹|🇧🇷|🇪🇸|🇫🇷|🇮🇹|🇩🇪|🇨🇿|🇮🇳/, // Country flags (non-English speaking)
  /português|português|español|français|italiano|deutsch|čeština|hindi/i, // Language names
  /DUNIA|NASIONAL|DAERAH|OLAHRAGA|BERITA|AGAMA|ANAK|GAYA HIDUP|PENGETAHUAN|BOLA \|/, // Indonesian/Asian
  /Animação|Clássico|Comédia|Cultura|Documentário|Educação|Entretenimento|Família|Infantil|Legislativo|Lifestyle|Religião|Variedades|Viagem|Auto 🏍|Outdoor/, // Portuguese/Spanish/other
];

// Content types to exclude (movies, series, radio, music, etc.)
const CONTENT_TO_EXCLUDE = [
  /movie|film|cinema|série|series|serial|radio|music|song|podcast|audio|documentary|doc\s|anime|cartoon|kids|children|adult|xxx|erotic|shop|telegram|buy me|coffee/i,
];

// Top-level channel name filters (applied before parsing)
const CHANNEL_PREFIXES_TO_SKIP = [
  'AF', // Afghanistan
];

let cache = null;

function slugify(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function parseM3U(text) {
  const entries = [];
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('#EXTINF')) continue;
    const logo = (lines[i].match(/tvg-logo="([^"]+)"/i) || [])[1] || '';
    const group = (lines[i].match(/group-title="([^"]+)"/i) || [])[1] || '';
    const name = (lines[i].match(/,\s*(.+)$/) || [])[1]?.trim() || '';
    let url = null;
    for (let j = i + 1; j < lines.length && j < i + 4; j++) {
      if (!lines[j].startsWith('#')) {
        url = lines[j];
        break;
      }
    }
    if (url && name) entries.push({ group, name, logo, url });
  }
  return entries;
}

async function getCache() {
  const now = Date.now();
  if (cache && now < cache.expiry) return cache;

  const allChannels = [];
  const seen = new Set();

  console.log('[MIPTV Combined] Fetching sources...');

  // Fetch all sources in parallel with timeout handling
  const results = await Promise.allSettled([
    (async () => {
      let text = '';
      for (const source of MIPTV_SOURCES) {
        try {
          if (source.startsWith('file://')) {
            text = fs.readFileSync(source.replace('file://', ''), 'utf8');
          } else {
            const res = await fetch(source, { redirect: 'follow', headers: FETCH_HEADERS, signal: AbortSignal.timeout(10000) });
            if (res.ok) {
              text = await res.text();
              if (text.length > 100) break;
            }
          }
        } catch (err) {
          console.error(`[MIPTV Combined] Failed ${source}:`, err.message);
        }
      }
      return { source: 'primary', text };
    })(),
    (async () => {
      let text = '';
      try {
        if (MIPTV_BACKUP_SOURCE.startsWith('file://')) {
          text = fs.readFileSync(MIPTV_BACKUP_SOURCE.replace('file://', ''), 'utf8');
        } else {
          const res = await fetch(MIPTV_BACKUP_SOURCE, { redirect: 'follow', headers: FETCH_HEADERS, signal: AbortSignal.timeout(8000) });
          if (res.ok) {
            text = await res.text();
          }
        }
      } catch (err) {
        console.error(`[MIPTV Combined] Failed to fetch backup:`, err.message);
      }
      return { source: 'backup', text };
    })(),
  ]);

  results.forEach((result) => {
    if (result.status !== 'fulfilled' || !result.value.text) return;
    
    const { source, text } = result.value;
    console.log(`[MIPTV Combined] Parsing ${source} (${text.length} bytes)`);

    for (const entry of parseM3U(text)) {
      // Skip by channel name prefix (top-level filter)
      if (CHANNEL_PREFIXES_TO_SKIP.some(prefix => entry.name.startsWith(prefix))) continue;
      
      // Skip non-English content (by group title or channel name)
      let isNonEnglish = false;
      for (const pattern of NON_ENGLISH_PATTERNS) {
        if (pattern.test(entry.group) || pattern.test(entry.name)) {
          isNonEnglish = true;
          break;
        }
      }
      if (isNonEnglish) continue;
      
      // Skip non-TV content (movies, series, radio, music, etc.)
      let isNonTV = false;
      for (const pattern of CONTENT_TO_EXCLUDE) {
        if (pattern.test(entry.group) || pattern.test(entry.name)) {
          isNonTV = true;
          break;
        }
      }
      if (isNonTV) continue;
      
      const sourcePrefix = source === 'primary' ? 'primary' : source;
      const channelName = source === 'backup' ? `${entry.name} [BU]` : entry.name;
      const id = `miptv-${sourcePrefix}-${slugify(entry.name)}`;
      
      if (seen.has(id)) continue;
      seen.add(id);
      
      allChannels.push({
        id,
        name: channelName,
        logo: entry.logo,
        url: entry.url,
        source,
        group: entry.group,
      });
    }
  });

  cache = { allChannels, expiry: now + 60 * 60 * 1000 };
  console.log(`[MIPTV Combined] Cache built: ${allChannels.length} total channels`);
  return cache;
}

const manifest = {
  id: 'org.miptv-combined.iptv',
  version: '1.0.3',
  name: 'MIPTV (All Sources)',
  description: 'MIPTV — Primary and backup stream sources for StremiRow',
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

builder.defineCatalogHandler(async ({ type, id }) => {
  if (type !== 'tv' || id !== 'miptv-combined-channels') return { metas: [] };
  try {
    console.log('[MIPTV Combined] Catalog request started');
    const { allChannels } = await getCache();
    
    console.log(`[MIPTV Combined] Returning ${allChannels.length} channels`);
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
    console.error('[MIPTV Combined] Catalog error:', err.message);
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
      let sourceName = 'Primary';
      if (ch.source === 'backup') sourceName = 'Backup';
      else if (ch.source === 'backup2') sourceName = 'Backup2';
      
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
          { url: ch.url, name: sourceName, title: urlTitle, behaviorHints: { notWebReady: false } },
        ],
      };
    }
    return { streams: [] };
  } catch (err) {
    console.error('[MIPTV Combined] Stream error:', err.message);
    return { streams: [] };
  }
});

module.exports = getRouter(builder.getInterface());
