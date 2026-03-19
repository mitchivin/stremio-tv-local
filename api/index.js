const { addonBuilder, getRouter } = require('stremio-addon-sdk')
const express = require('express')
const path = require('path')

const BASE_URL = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : 'http://localhost:7000'

const A1X_SOURCES = [
  'https://bit.ly/a1xstream',
  'https://a1xs.vip/a1xstream',
  'https://raw.githubusercontent.com/a1xmedia/m3u/main/a1x.m3u'
]

const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36',
  'Accept': '*/*'
}

// Channels to pull into News (matched by exact name)
const NEWS_CHANNELS = new Set([
  'BBC News FHD', 'CNN UK FHD', 'GB News FHD', 'Sky News FHD',
  'ABC News Live', 'CBS Sports HQ FHD', 'NBC News NOW', 'NewsMax',
  'CNBC', 'CP24', 'CTV News', 'CBC News Network', 'Global News', 'MS NOW'
])

// Channels to exclude entirely (non-English or unwanted)
const EXCLUDED_CHANNELS = new Set([
  // Non-English EU Sports
  'IRE: Premier Sports 1 FHD', 'IRE: Premier Sports 2 FHD',
  'DE: Sportdigital Fussball FHD', 'DE: Sky Sport Bundesliga FHD',
  'DE: Sky Sport Top Event FHD', 'DE: Sky Sport Premier League FHD',
  'AL: Super Sport 1 FHD', 'AL: Super Sport 2 FHD', 'AL: Super Sport 3 FHD',
  'NL: Ziggo Sport FHD', 'NL: Ziggo Sport 2 FHD', 'NL: Ziggo Sport 3 FHD',
  'NL: Ziggo Sport 4 FHD',
  // Non-English World Sports
  'Star Sports Select 1 FHD', 'Star Sports Select 2 FHD',
  // Non-English EPL
  'Now Sports PL 1 FHD', 'Now Sports PL 2 FHD',
  'Astro Premier League', 'Astro Premier League 2', 'Astro Grandstand',
  'Hub Premier 1 FHD', 'Hub Premier 2 FHD', 'Hub Premier 3 FHD', 'Hub Premier 4 FHD',
  // Non-English UHD
  'MY: Astro Sports UHD', 'HK: Now Sports 1 4k', 'SG: Hub Premier 2 UHD',
  'SE: V Sport Ultra HD', 'IRIB UHD',
  // Non-English misc
  'Fashion TV UHD', 'MyZen 4K (Multi Audio)', 'HOME 4K', 'MUSEUM TV 4K',
  'Loupe 4K', 'Travelxp 4K', 'Love Nature 4K'
])

// Map A1X channel names to local logo IDs
const CHANNEL_LOGO_MAP = {
  'SKY Sport 1 NZ': '403251',
  'SKY Sport 2 NZ': '403256',
  'SKY Sport 3 NZ': '403252',
  'SKY Sport 4 NZ': '403248',
  'SKY Sport 5 NZ': '403249',
  'SKY Sport 6 NZ': '403250',
  'Sky Sports+ FHD': '412959',
  'Sky Sports Premier League FHD': '6958',
  'Sky Sports News FHD': '6626',
  'TNT Sports 1 FHD': '400477',
  'TNT Sports 2 FHD': '400480',
  'TNT Sports 3 FHD': '400479',
  'TNT Sports 4 FHD': '400478',
  'BBC News FHD': '12162',
  'GB News FHD': '12133',
  'Sky News FHD': '12069',
  'BBC One FHD': '486880',
  'BBC Two FHD': '486673',
  'BBC Three / CBBC FHD': '486878',
  'ESPN HD': '465198',
  'ESPN News HD': '417108',
  'ESPN2 HD': '465373',
  'ESPNU HD': '417125',
  'NBA TV': '406263',
  'NFL Network': '454083',
  'Animal Planet FHD': '465310',
  'Cartoon Network FHD': '464853',
  'Comedy Central FHD': '464922',
  'Discovery Channel FHD': '465364',
  'HBO Comedy FHD': '464953',
  'Nickelodeon FHD': '465251',
  'truTV FHD': '464987',
  'TNT FHD': '465114',
  'CNBC': '464791',
  'NewsMax': '464863'
}

function getLogoUrl(channelName, fallbackLogo) {
  const id = CHANNEL_LOGO_MAP[channelName]
  if (id) return `${BASE_URL}/logos/${id}.png`
  return fallbackLogo || undefined
}
const GROUP_TO_CATEGORY = {
  'NZ Sports': 'Sports',
  'AU Sports': 'Sports',
  'UK Sports': 'Sports',
  'US Sports': 'Sports',
  'CA Sports': 'Sports',
  'EPL': 'Sports',
  'UHD | 4K': 'Sports',
  'Live Event | PPV': 'Sports',
  'UK Channels': 'Entertainment',
  'US Channels': 'Entertainment',
  'CA Channels': 'Entertainment',
  'EU Sports': 'Sports',
  'World Sports': 'Sports'
}

const CATEGORIES = ['Sports', 'Entertainment', 'News']

let cache = null

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

function parseM3U(text) {
  const entries = []
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('#EXTINF')) continue
    const inf = lines[i]
    const tvgLogo = (inf.match(/tvg-logo="([^"]+)"/i) || [])[1] || ''
    const group   = (inf.match(/group-title="([^"]+)"/i) || [])[1] || ''
    const name    = (inf.match(/,\s*(.+)$/) || [])[1]?.trim() || ''
    let url = null
    for (let j = i + 1; j < lines.length && j < i + 4; j++) {
      if (!lines[j].startsWith('#')) { url = lines[j]; break }
    }
    if (url && group && name) {
      entries.push({ group, name, logo: tvgLogo, url })
    }
  }
  return entries
}

async function getCache() {
  const now = Date.now()
  if (cache && now < cache.expiry) return cache

  let text = ''
  for (const source of A1X_SOURCES) {
    try {
      const res = await fetch(source, { redirect: 'follow', headers: FETCH_HEADERS })
      if (res.ok) {
        text = await res.text()
        if (text.length > 100) break
      }
    } catch (err) {
      console.error(`Failed ${source}:`, err.message)
    }
  }

  if (!text) throw new Error('All A1X sources failed')

  const raw = parseM3U(text)

  // Build our 3 categories
  const byCategory = { Sports: [], Entertainment: [], News: [] }

  for (const entry of raw) {
    if (EXCLUDED_CHANNELS.has(entry.name)) continue

    // News channels get pulled out regardless of their A1X group
    if (NEWS_CHANNELS.has(entry.name)) {
      const id = `a1x-news-${slugify(entry.name)}`
      byCategory.News.push({ id, name: entry.name, logo: entry.logo, url: entry.url, category: 'News' })
      continue
    }

    const category = GROUP_TO_CATEGORY[entry.group]
    if (!category) continue

    const id = `a1x-${slugify(category)}-${slugify(entry.name)}`
    byCategory[category].push({ id, name: entry.name, logo: entry.logo, url: entry.url, category })
  }

  // Dedupe by id within each category
  for (const cat of CATEGORIES) {
    const seen = new Set()
    byCategory[cat] = byCategory[cat].filter(ch => {
      if (seen.has(ch.id)) return false
      seen.add(ch.id)
      return true
    })
  }

  // Build flat lookup by id
  const allEntries = {}
  for (const cat of CATEGORIES) {
    for (const ch of byCategory[cat]) allEntries[ch.id] = ch
  }

  cache = { byCategory, allEntries, expiry: now + 20 * 60 * 1000 }
  return cache
}

const manifest = {
  id: 'org.a1x.iptv',
  version: '1.0.0',
  name: 'A1X IPTV',
  description: 'Live sports, entertainment and news via A1X',
  resources: ['catalog', 'meta', 'stream'],
  types: ['tv'],
  catalogs: [
    { type: 'tv', id: 'a1x-sports', name: 'Sports' },
    { type: 'tv', id: 'a1x-entertainment', name: 'Entertainment' },
    { type: 'tv', id: 'a1x-news', name: 'News' }
  ],
  idPrefixes: ['a1x-']
}

const builder = new addonBuilder(manifest)

builder.defineCatalogHandler(async ({ type, id, extra }) => {
  if (type !== 'tv') return { metas: [] }
  const categoryMap = {
    'a1x-sports': 'Sports',
    'a1x-entertainment': 'Entertainment',
    'a1x-news': 'News'
  }
  const category = categoryMap[id]
  if (!category) return { metas: [] }
  try {
    const { byCategory } = await getCache()
    const channels = byCategory[category] || []
    return {
      metas: channels.map(ch => ({
        id: ch.id,
        type: 'tv',
        name: ch.name,
        logo: getLogoUrl(ch.name, ch.logo),
        poster: getLogoUrl(ch.name, ch.logo),
        posterShape: 'square',
        genres: [ch.category]
      }))
    }
  } catch (err) {
    console.error('Catalog error:', err.message)
    return { metas: [] }
  }
})

builder.defineMetaHandler(async ({ id }) => {
  try {
    const { allEntries } = await getCache()
    const ch = allEntries[id]
    if (!ch) return { meta: null }
    return { meta: { id, type: 'tv', name: ch.name, genres: [ch.category] } }
  } catch (err) {
    return { meta: null }
  }
})

builder.defineStreamHandler(async ({ id }) => {
  try {
    const { allEntries } = await getCache()
    const ch = allEntries[id]
    if (!ch) return { streams: [] }
    return {
      streams: [{
        url: ch.url,
        name: 'A1X',
        title: ch.name,
        behaviorHints: { notWebReady: false }
      }]
    }
  } catch (err) {
    return { streams: [] }
  }
})

const app = express()
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  next()
})
app.use('/logos', express.static(path.join(__dirname, '..', 'logos')))
app.use(getRouter(builder.getInterface()))

module.exports = app

if (require.main === module) {
  app.listen(7000, () => console.log('Running on http://localhost:7000/manifest.json'))
}
