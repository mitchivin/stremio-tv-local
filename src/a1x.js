/**
 * a1x.js
 * A1X IPTV addon — Sports, Entertainment, News
 * Mounted at /a1x/ by the main Express app.
 */

'use strict';

const { addonBuilder, getRouter } = require('stremio-addon-sdk');

const A1X_SOURCES = [
  'https://a1xs.vip/a1xstream',
  'https://raw.githubusercontent.com/a1xmedia/m3u/main/a1x.m3u'
];

const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36',
  'Accept': '*/*'
};

const NEWS_CHANNELS = new Set([
  'BBC News FHD', 'CNN UK FHD', 'GB News FHD', 'Sky News FHD',
  'ABC News Live', 'CBS Sports HQ FHD', 'NBC News NOW', 'NewsMax',
  'CNBC', 'CP24', 'CTV News', 'CBC News Network', 'Global News', 'MS NOW'
]);

const EXCLUDED_CHANNELS = new Set([
  'IRE: Premier Sports 1 FHD', 'IRE: Premier Sports 2 FHD',
  'DE: Sportdigital Fussball FHD', 'DE: Sky Sport Bundesliga FHD',
  'DE: Sky Sport Top Event FHD', 'DE: Sky Sport Premier League FHD',
  'AL: Super Sport 1 FHD', 'AL: Super Sport 2 FHD', 'AL: Super Sport 3 FHD',
  'NL: Ziggo Sport FHD', 'NL: Ziggo Sport 2 FHD', 'NL: Ziggo Sport 3 FHD',
  'NL: Ziggo Sport 4 FHD',
  'Star Sports Select 1 FHD', 'Star Sports Select 2 FHD',
  'Now Sports PL 1 FHD', 'Now Sports PL 2 FHD',
  'Astro Premier League', 'Astro Premier League 2', 'Astro Grandstand',
  'Hub Premier 1 FHD', 'Hub Premier 2 FHD', 'Hub Premier 3 FHD', 'Hub Premier 4 FHD',
  'MY: Astro Sports UHD', 'HK: Now Sports 1 4k', 'SG: Hub Premier 2 UHD',
  'SE: V Sport Ultra HD', 'IRIB UHD',
  'Fashion TV UHD', 'MyZen 4K (Multi Audio)', 'HOME 4K', 'MUSEUM TV 4K',
  'Loupe 4K', 'Travelxp 4K', 'Love Nature 4K'
]);

const GROUP_TO_CATEGORY = {
  'NZ Sports': 'Sports', 'AU Sports': 'Sports', 'UK Sports': 'Sports',
  'US Sports': 'Sports', 'CA Sports': 'Sports', 'EPL': 'Sports',
  'UHD | 4K': 'Sports', 'Live Event | PPV': 'Sports',
  'EU Sports': 'Sports', 'World Sports': 'Sports',
  'UK Channels': 'Entertainment', 'US Channels': 'Entertainment', 'CA Channels': 'Entertainment'
};

// AU IPTV channel IDs -> A1X M3U channel name (backup stream handler)
const AU_ID_TO_A1X_NAME = {
  'au|SP:nz_sports|SKY.Sport.1.nz|tv':    'SKY Sport 1 NZ',
  'au|SP:nz_sports|SKY.Sport.2.nz|tv':    'SKY Sport 2 NZ',
  'au|SP:nz_sports|SKY.Sport.3.nz|tv':    'SKY Sport 3 NZ',
  'au|SP:nz_sports|SKY.Sport.4.nz|tv':    'SKY Sport 4 NZ',
  'au|SP:nz_sports|SKY.Sport.5.nz|tv':    'SKY Sport 5 NZ',
  'au|SP:nz_sports|SKY.Sport.6.nz|tv':    'SKY Sport 6 NZ',
  'au|SP:nz_sports|SKY.Sport.7.nz|tv':    'SKY Sport 7 NZ',
  'au|SP:au_sports|FoxCricket.au|tv':      'Fox Sports 501 FHD',
  'au|SP:au_sports|FoxLeague.au|tv':       'Fox Sports 502 FHD',
  'au|SP:au_sports|FoxSports503.au|tv':    'Fox Sports 503 FHD',
  'au|SP:au_sports|FoxFooty.au|tv':        'Fox Sports 504 FHD',
  'au|SP:au_sports|FoxSports505.au|tv':    'Fox Sports 505 FHD',
  'au|SP:au_sports|FoxSports506.au|tv':    'Fox Sports 506 FHD',
  'au|SP:au_sports|FoxSportsMore.au|tv':   'Fox Sports 507 FHD',
  'au|SP:uk_sports|SkySp.PL.HD.uk|tv':     'Sky Sports Premier League FHD',
  'au|SP:uk_sports|SkySp.News.HD.uk|tv':   'Sky Sports News FHD',
  'au|SP:uk_sports|SkySp.F1.uk|tv':        'Sky Sports F1 FHD',
  'au|SP:uk_sports|SkySp.Fball.HD.uk|tv':  'Sky Sports Football FHD',
  'au|SP:uk_sports|SkySpCricket.HD.uk|tv': 'Sky Sports Cricket FHD',
  'au|SP:uk_sports|SkySp.Golf.HD.uk|tv':   'Sky Sports Golf FHD',
  'au|SP:uk_sports|SkySp.Mix.HD.uk|tv':    'Sky Sports Mix FHD',
  'au|SP:uk_sports|SkySp.Racing.HD.uk|tv': 'Sky Sports Racing FHD',
  'au|SP:uk_sports|SkySp.ActionHD.uk|tv':  'Sky Sports Action FHD',
  'au|SP:uk_sports|SkySp.Tennis.HD.uk|tv': 'Sky Sports Tennis FHD',
  'au|SP:uk_sports|SkySp+HD.uk|tv':        'Sky Sports+ FHD',
  'au|SP:uk_sports|TNT.Sports.1.HD.uk|tv': 'TNT Sports 1 FHD',
  'au|SP:uk_sports|TNT.Sports.2.HD.uk|tv': 'TNT Sports 2 FHD',
  'au|SP:uk_sports|TNT.Sports.3.HD.uk|tv': 'TNT Sports 3 FHD',
  'au|SP:uk_sports|TNT.Sports.4.HD.uk|tv': 'TNT Sports 4 FHD',
  'au|SP:us_sports|ESPN.HD.us2|tv':        'ESPN HD',
  'au|SP:us_sports|ESPN2.HD.us2|tv':       'ESPN2 HD',
  'au|SP:us_sports|ESPNEWS.HD.us2|tv':     'ESPN News HD',
  'au|SP:us_sports|NBA.TV.HD.us2|tv':      'NBA TV',
  'au|SP:us_sports|NFL.Network.HD.us2|tv': 'NFL Network',
};

let cache = null;

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function parseM3U(text) {
  const entries = [];
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('#EXTINF')) continue;
    const logo  = (lines[i].match(/tvg-logo="([^"]+)"/i) || [])[1] || '';
    const group = (lines[i].match(/group-title="([^"]+)"/i) || [])[1] || '';
    const name  = (lines[i].match(/,\s*(.+)$/) || [])[1]?.trim() || '';
    let url = null;
    for (let j = i + 1; j < lines.length && j < i + 4; j++) {
      if (!lines[j].startsWith('#')) { url = lines[j]; break; }
    }
    if (url && group && name) entries.push({ group, name, logo, url });
  }
  return entries;
}

async function getCache() {
  const now = Date.now();
  if (cache && now < cache.expiry) return cache;

  let text = '';
  for (const source of A1X_SOURCES) {
    try {
      const res = await fetch(source, { redirect: 'follow', headers: FETCH_HEADERS });
      if (res.ok) { text = await res.text(); if (text.length > 100) break; }
    } catch (err) { console.error(`[A1X] Failed ${source}:`, err.message); }
  }
  if (!text) throw new Error('All A1X sources failed');

  const byCategory = { Sports: [], Entertainment: [], News: [] };
  const seen = { Sports: new Set(), Entertainment: new Set(), News: new Set() };

  for (const entry of parseM3U(text)) {
    if (EXCLUDED_CHANNELS.has(entry.name)) continue;
    let category, id;
    if (NEWS_CHANNELS.has(entry.name)) {
      category = 'News';
      id = `a1x-news-${slugify(entry.name)}`;
    } else {
      category = GROUP_TO_CATEGORY[entry.group];
      if (!category) continue;
      id = `a1x-${slugify(category)}-${slugify(entry.name)}`;
    }
    if (seen[category].has(id)) continue;
    seen[category].add(id);
    byCategory[category].push({ id, name: entry.name, logo: entry.logo, url: entry.url, category });
  }

  const allEntries = {};
  const byName = {};
  for (const channels of Object.values(byCategory)) {
    for (const ch of channels) {
      allEntries[ch.id] = ch;
      byName[ch.name] = ch.url;
    }
  }

  cache = { byCategory, allEntries, byName, expiry: now + 20 * 60 * 1000 };
  return cache;
}

const manifest = {
  id: 'org.a1x.iptv',
  version: '1.0.0',
  name: 'A1X IPTV',
  description: 'A1X live TV — Sports, Entertainment and News',
  resources: [
    'catalog',
    'meta',
    { name: 'stream', types: ['tv'], idPrefixes: ['a1x-', 'au|'] },
  ],
  types: ['tv'],
  catalogs: [
    { type: 'tv', id: 'a1x-sports',        name: 'Sports' },
    { type: 'tv', id: 'a1x-entertainment', name: 'Entertainment' },
    { type: 'tv', id: 'a1x-news',          name: 'News' }
  ],
  idPrefixes: ['a1x-', 'au|']
};

const builder = new addonBuilder(manifest);

builder.defineCatalogHandler(async ({ type, id }) => {
  if (type !== 'tv') return { metas: [] };
  const category = id.replace('a1x-', '').replace(/^\w/, c => c.toUpperCase());
  if (!['Sports', 'Entertainment', 'News'].includes(category)) return { metas: [] };
  try {
    const { byCategory } = await getCache();
    return {
      metas: (byCategory[category] || []).map(ch => ({
        id: ch.id, type: 'tv', name: ch.name,
        poster: ch.logo || undefined,
        posterShape: 'square',
        genres: [ch.category]
      }))
    };
  } catch (err) { console.error('[A1X] Catalog error:', err.message); return { metas: [] }; }
});

builder.defineMetaHandler(async ({ id }) => {
  if (id.startsWith('a1x-')) {
    try {
      const { allEntries } = await getCache();
      const ch = allEntries[id];
      if (!ch) return { meta: null };
      return { meta: { id, type: 'tv', name: ch.name, poster: ch.logo || undefined, posterShape: 'square', genres: [ch.category] } };
    } catch { return { meta: null }; }
  }
  const name = AU_ID_TO_A1X_NAME[id];
  if (!name) return { meta: null };
  return { meta: { id, type: 'tv', name } };
});

builder.defineStreamHandler(async ({ id }) => {
  try {
    const { allEntries, byName } = await getCache();
    if (id.startsWith('a1x-')) {
      const ch = allEntries[id];
      if (!ch) return { streams: [] };
      return { streams: [{ url: ch.url, name: 'A1X', title: ch.name, behaviorHints: { notWebReady: false } }] };
    }
    const a1xName = AU_ID_TO_A1X_NAME[id];
    if (!a1xName) return { streams: [] };
    const url = byName[a1xName];
    if (!url) return { streams: [] };
    return { streams: [{ url, name: 'A1X', title: a1xName, behaviorHints: { notWebReady: false } }] };
  } catch (err) {
    console.error('[A1X] Stream error:', err.message);
    return { streams: [] };
  }
});

module.exports = getRouter(builder.getInterface());
