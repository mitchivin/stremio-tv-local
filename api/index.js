const { addonBuilder, getRouter } = require('stremio-addon-sdk')
const express = require('express')

const A1X_SOURCES = [
  'https://a1xs.vip/a1xstream',
  'https://raw.githubusercontent.com/a1xmedia/m3u/main/a1x.m3u'
]

const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36',
  'Accept': '*/*'
}

// Map AU IPTV channel IDs -> exact A1X M3U channel name
const AU_ID_TO_A1X_NAME = {
  'au|SP:nz_sports|SKY.Sport.1.nz|tv':       'SKY Sport 1 NZ',
  'au|SP:nz_sports|SKY.Sport.2.nz|tv':       'SKY Sport 2 NZ',
  'au|SP:nz_sports|SKY.Sport.3.nz|tv':       'SKY Sport 3 NZ',
  'au|SP:nz_sports|SKY.Sport.4.nz|tv':       'SKY Sport 4 NZ',
  'au|SP:nz_sports|SKY.Sport.5.nz|tv':       'SKY Sport 5 NZ',
  'au|SP:nz_sports|SKY.Sport.6.nz|tv':       'SKY Sport 6 NZ',
  'au|SP:nz_sports|SKY.Sport.7.nz|tv':       'SKY Sport 7 NZ',
  'au|SP:au_sports|FoxCricket.au|tv':         'Fox Sports 501 FHD',
  'au|SP:au_sports|FoxLeague.au|tv':          'Fox Sports 502 FHD',
  'au|SP:au_sports|FoxSports503.au|tv':       'Fox Sports 503 FHD',
  'au|SP:au_sports|FoxFooty.au|tv':           'Fox Sports 504 FHD',
  'au|SP:au_sports|FoxSports505.au|tv':       'Fox Sports 505 FHD',
  'au|SP:au_sports|FoxSports506.au|tv':       'Fox Sports 506 FHD',
  'au|SP:au_sports|FoxSportsMore.au|tv':      'Fox Sports 507 FHD',
  'au|SP:uk_sports|SkySp.PL.HD.uk|tv':        'Sky Sports Premier League FHD',
  'au|SP:uk_sports|SkySp.News.HD.uk|tv':      'Sky Sports News FHD',
  'au|SP:uk_sports|SkySp.F1.uk|tv':           'Sky Sports F1 FHD',
  'au|SP:uk_sports|SkySp.Fball.HD.uk|tv':     'Sky Sports Football FHD',
  'au|SP:uk_sports|SkySpCricket.HD.uk|tv':    'Sky Sports Cricket FHD',
  'au|SP:uk_sports|SkySp.Golf.HD.uk|tv':      'Sky Sports Golf FHD',
  'au|SP:uk_sports|SkySp.Mix.HD.uk|tv':       'Sky Sports Mix FHD',
  'au|SP:uk_sports|SkySp.Racing.HD.uk|tv':    'Sky Sports Racing FHD',
  'au|SP:uk_sports|SkySp.ActionHD.uk|tv':     'Sky Sports Action FHD',
  'au|SP:uk_sports|SkySp.Tennis.HD.uk|tv':    'Sky Sports Tennis FHD',
  'au|SP:uk_sports|SkySp+HD.uk|tv':           'Sky Sports+ FHD',
  'au|SP:uk_sports|TNT.Sports.1.HD.uk|tv':    'TNT Sports 1 FHD',
  'au|SP:uk_sports|TNT.Sports.2.HD.uk|tv':    'TNT Sports 2 FHD',
  'au|SP:uk_sports|TNT.Sports.3.HD.uk|tv':    'TNT Sports 3 FHD',
  'au|SP:uk_sports|TNT.Sports.4.HD.uk|tv':    'TNT Sports 4 FHD',
  'au|SP:us_sports|ESPN.HD.us2|tv':           'ESPN HD',
  'au|SP:us_sports|ESPN2.HD.us2|tv':          'ESPN2 HD',
  'au|SP:us_sports|ESPNEWS.HD.us2|tv':        'ESPN News HD',
  'au|SP:us_sports|NBA.TV.HD.us2|tv':         'NBA TV',
  'au|SP:us_sports|NFL.Network.HD.us2|tv':    'NFL Network',
}

let cache = null

function parseM3U(text) {
  const entries = {}
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('#EXTINF')) continue
    const name = (lines[i].match(/,\s*(.+)$/) || [])[1]?.trim() || ''
    let url = null
    for (let j = i + 1; j < lines.length && j < i + 4; j++) {
      if (!lines[j].startsWith('#')) { url = lines[j]; break }
    }
    if (name && url) entries[name] = url
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

  cache = { byName: parseM3U(text), expiry: now + 20 * 60 * 1000 }
  return cache
}

const manifest = {
  id: 'org.a1x.iptv',
  version: '1.0.0',
  name: 'A1X IPTV',
  description: 'A1X backup streams for AU IPTV channels',
  resources: [
    {
      name: 'stream',
      types: ['tv'],
      idPrefixes: ['au|']
    },
    {
      name: 'meta',
      types: ['tv'],
      idPrefixes: ['au|']
    }
  ],
  types: ['tv'],
  catalogs: []
}

const builder = new addonBuilder(manifest)

builder.defineMetaHandler(async ({ id }) => {
  const a1xName = AU_ID_TO_A1X_NAME[id]
  if (!a1xName) return { meta: null }
  return {
    meta: {
      id,
      type: 'tv',
      name: a1xName
    }
  }
})

builder.defineStreamHandler(async ({ id }) => {
  const a1xName = AU_ID_TO_A1X_NAME[id]
  if (!a1xName) return { streams: [] }

  try {
    const { byName } = await getCache()
    const url = byName[a1xName]
    if (!url) return { streams: [] }
    return {
      streams: [{
        url,
        name: 'A1X',
        title: a1xName,
        behaviorHints: { notWebReady: false }
      }]
    }
  } catch (err) {
    console.error('Stream error:', err.message)
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
