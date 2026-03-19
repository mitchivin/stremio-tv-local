const { addonBuilder, getRouter } = require('stremio-addon-sdk')
const express = require('express')

const A1X_SOURCES = [
  'https://bit.ly/a1xstream',
  'https://a1xs.vip/a1xstream',
  'https://raw.githubusercontent.com/a1xmedia/m3u/main/a1x.m3u'
]

const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36',
  'Accept': '*/*'
}

const A1X_GROUPS = [
  'Live Event | PPV',
  'UHD | 4K',
  'EPL',
  'UK Sports',
  'UK Channels',
  'US Sports',
  'US Channels',
  'CA Sports',
  'CA Channels',
  'AU Sports',
  'NZ Sports',
  'EU Sports',
  'World Sports'
]

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
      entries.push({
        id: `a1x-${slugify(group)}-${slugify(name)}`,
        name, group, logo: tvgLogo, url
      })
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

  const entries = parseM3U(text)
  const byGroup = {}
  for (const g of A1X_GROUPS) byGroup[g] = []
  for (const e of entries) {
    if (byGroup[e.group] !== undefined) byGroup[e.group].push(e)
  }

  cache = { entries, byGroup, expiry: now + 20 * 60 * 1000 }
  return cache
}

const manifest = {
  id: 'org.a1x.iptv',
  version: '1.0.0',
  name: 'A1X IPTV',
  description: 'Live sports and TV channels via A1X',
  resources: ['catalog', 'meta', 'stream'],
  types: ['tv'],
  catalogs: [{
    type: 'tv',
    id: 'a1x-catalog',
    name: 'A1X IPTV',
    extra: [{ name: 'genre', options: A1X_GROUPS, isRequired: false }]
  }],
  idPrefixes: ['a1x-']
}

const builder = new addonBuilder(manifest)

builder.defineCatalogHandler(async ({ type, id, extra }) => {
  if (type !== 'tv' || id !== 'a1x-catalog') return { metas: [] }
  const group = extra?.genre || 'NZ Sports'
  try {
    const { byGroup } = await getCache()
    const channels = byGroup[group] || []
    return {
      metas: channels.map(ch => ({
        id: ch.id,
        type: 'tv',
        name: ch.name,
        logo: ch.logo || undefined,
        poster: ch.logo || undefined,
        genres: [ch.group]
      }))
    }
  } catch (err) {
    console.error('Catalog error:', err.message)
    return { metas: [] }
  }
})

builder.defineMetaHandler(async ({ id }) => {
  try {
    const { entries } = await getCache()
    const ch = entries.find(e => e.id === id)
    if (!ch) return { meta: null }
    return { meta: { id, type: 'tv', name: ch.name, genres: [ch.group] } }
  } catch (err) {
    return { meta: null }
  }
})

builder.defineStreamHandler(async ({ id }) => {
  try {
    const { entries } = await getCache()
    const ch = entries.find(e => e.id === id)
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
app.use(getRouter(builder.getInterface()))

module.exports = app

if (require.main === module) {
  app.listen(7000, () => console.log('Running on http://localhost:7000/manifest.json'))
}
