/**
 * index.js – Stremio Row Factory
 *
 * Startup sequence:
 *  1. Load env vars (local: from env.env via dotenv | Vercel: from dashboard)
 *  2. Load & validate config from GitHub Gist (or local fallback)
 *  3. Build the Stremio manifest (one catalog per row)
 *  4. Register catalog handlers
 *  5. Mount Express routes + admin panel
 */

'use strict';

// Load .env locally (no-op on Vercel where env vars are set in the dashboard)
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const express = require('express');
const { addonBuilder } = require('stremio-addon-sdk');
const getRouter = require('stremio-addon-sdk/src/getRouter');
const { loadConfig } = require('./src/loader');
const { buildManifest } = require('./src/manifest');
const { registerHandlers } = require('./src/handlers');
const { mountAdmin } = require('./src/admin');
const a1xRouter = require('./src/a1x');
const { fetchResilient } = require('./src/fetch-utils');

// ── 1. App State & Manifest ────────────────────────────────────────────────
let currentConfig;
let activeSdkRouter = null;

async function startup() {
  try {
    currentConfig = await loadConfig();
    rebuildSdkRouter();
    console.log(`✅  Startup complete: ${currentConfig.rows.length} rows loaded.`);
  } catch (err) {
    console.error('\n❌  Startup error:\n');
    console.error('   ' + err.message);
    // Don't exit if in serverless environment
    if (require.main === module) process.exit(1);
  }
}

function rebuildSdkRouter() {
  const manifest = buildManifest(currentConfig.addonMeta, currentConfig.rows);
  const builder = new addonBuilder(manifest);
  registerHandlers(builder, () => currentConfig);
  const addonInterface = builder.getInterface();
  activeSdkRouter = getRouter(addonInterface);
}

// ── 2. Build Express app ───────────────────────────────────────────────────
const app = express();
const PORT = parseInt(process.env.PORT || '7001', 10);

app.use(express.json({ limit: '5mb' }));
app.use((req, res, next) => {
  console.log(`[REQ] ${new Date().toLocaleTimeString()} ${req.method} ${req.url}`);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  next();
});

// Raw HLS Helper — MOVE TO TOP TO PREVENT INTERCEPTION
app.get('/hls-helper', async (req, res) => {
  const urlStr = req.query.url;
  if (!urlStr) return res.status(400).send('url required');

  try {
    let targetUrl = urlStr;

    // ── EXTRACTION: cdn-live.tv player pages ──
    if (urlStr.includes('cdn-live.tv/api/v1/channels/player/')) {
      console.log(`[proxy] 🔍 Detected player page, extracting stream: ${urlStr}`);
      try {
        const pRes = await fetchResilient(urlStr, {
          timeout: 5000,
          maxRetries: 2,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
          }
        });
        if (pRes.ok) {
          const html = await pRes.text();
          // Look for any .m3u8 pattern in the HTML (usually in a script tag)
          const m3u8Match = html.match(/https?:\/\/[^"'\s]+\.m3u8[^"'\s]*/);
          if (m3u8Match) {
            targetUrl = m3u8Match[0];
            console.log(`[proxy] ✨ Extracted stream URL: ${targetUrl}`);
          } else {
            console.warn(`[proxy] ⚠️ No M3U8 found in player page, falling back to original URL.`);
          }
        }
      } catch (extractErr) {
        console.warn(`[proxy] ⚠️ M3U8 extraction failed: ${extractErr.message}. Using original URL.`);
      }
    }

    const url = new URL(targetUrl);
    const headers = {
      'User-Agent':
        req.headers['user-agent'] ||
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      Referer: 'https://streamversea.site/',
      Origin: 'https://streamversea.site/',
      Accept: '*/*',
      'Accept-Language': 'en-GB,en-US;q=0.9,en;q=0.8',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'cross-site',
    };

    console.log(`[proxy] 🌐 Fetching: ${targetUrl}`);
    const response = await fetchResilient(targetUrl, {
      timeout: 10000,
      maxRetries: 2,
      retryDelay: 1000,
      headers,
      redirect: 'follow'
    });

    if (!response.ok) {
      console.error(`[proxy] ❌ FAILED ${targetUrl} - Status: ${response.status}`);
      return res.status(response.status).send(`Proxy failed: ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type') || '';
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

    // If it's a manifest, rewrite relative and absolute URLs
    if (
      targetUrl.includes('.m3u8') ||
      contentType.includes('mpegurl') ||
      contentType.includes('apple')
    ) {
      const text = await response.text();
      
      // CRITICAL Check: Are we getting a security challenge (JS/HTML)?
      if (!text.trim().startsWith('#EXTM3U')) {
        console.warn(`[proxy] ⚠️  Not an M3U8! Saving challenge to debug_challenge.html`);
        const fs = require('fs');
        fs.writeFileSync('debug_challenge.html', text);
        res.setHeader('Content-Type', contentType || 'text/html');
        return res.send(text);
      }

      console.log(`[proxy] 🛠️  Rewriting M3U8 (${text.length} bytes)`);
      const baseUrl = targetUrl.split('?')[0].substring(0, targetUrl.split('?')[0].lastIndexOf('/') + 1);
      const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
      const host = req.headers['x-forwarded-host'] || req.headers.host || `localhost:7001`;

      const rewritten = text
        .split('\n')
        .map((line) => {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) return line;

          try {
            let absoluteUrl = trimmed.startsWith('http') ? trimmed : new URL(trimmed, baseUrl).href;
            return `${proto}://${host}/hls-helper?url=${encodeURIComponent(absoluteUrl)}`;
          } catch (e) {
            return line;
          }
        })
        .join('\n');

      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      return res.send(rewritten);
    }

    // Binary / TS segments
    if (contentType) res.setHeader('Content-Type', contentType);
    const { Readable } = require('stream');
    Readable.fromWeb(response.body).pipe(res);
  } catch (err) {
    console.error(`[proxy] 💥 GLOBAL ERROR:`, err.message);
    if (!res.headersSent) res.status(500).send(err.message);
  }
});

// ── NEW: RU CDN HTML Proxy ──
app.get('/cdn-proxy', async (req, res) => {
  const urlStr = req.query.url;
  if (!urlStr) return res.status(400).send('url required');

  try {
    console.log(`[cdn-proxy] 🧼 Cleaning player: ${urlStr}`);
    const response = await fetchResilient(urlStr, {
      timeout: 8000,
      maxRetries: 2,
      retryDelay: 500,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Referer': 'https://cdn-live.tv/'
      }
    });

    if (!response.ok) return res.status(response.status).send('Proxy failed');

    let html = await response.text();

    // 1. Strip Ad Scripts & Popups
    html = html.replace(/<script[^>]+acscdn\.com[^>]+><\/script>/gi, '<!-- aclib removed -->');
    html = html.replace(/<script[^>]+al5sm\.com[^>]+><\/script>/gi, '<!-- al5sm removed -->');
    html = html.replace(/<script[^>]+nap5k\.com[^>]+><\/script>/gi, '<!-- nap5k removed -->');
    html = html.replace(/<script[^>]+monetag[^>]+><\/script>/gi, '<!-- monetag removed -->');
    html = html.replace(/<meta[^>]+monetag[^>]+>/gi, '<!-- monetag meta removed -->');
    
    // 2. Strip Anti-Devtool (This fixes the "Embedding Not Allowed" error)
    html = html.replace(/<script[^>]+disable-devtool[^>]+><\/script>/gi, '<!-- disable-devtool removed -->');
    
    // 3. Strip Histats & Hit trackers
    html = html.replace(/<!-- Histats\.com[\s\S]+?Histats\.com[\s\S]+?-->/gi, '<!-- histats removed -->');
    html = html.replace(/<noscript>[\s\S]+?histats\.com[\s\S]+?<\/noscript>/gi, '');

    // 4. Strip Any Inline Ad Scripts (aclib.runPop etc)
    html = html.replace(/aclib\.runPop\(\{[\s\S]+?\}\);/gi, '/* runPop removed */');

    // 5. Fix Relative Links (ensure assets still load from cdn-live.tv)
    const base = 'https://cdn-live.tv';
    html = html.replace(/(src|href)="\/([^/][^"]*)"/gi, `$1=\"${base}/$2\"`);

    // 6. Inject CSS to hide potential ad containers
    const cleanStyles = `
      <style>
        #aclib-popup-container, .monetag-ad, div[id*="zone-"], iframe[src*="monetag"] { display: none !important; }
        body { background: #000 !important; }
      </style>
    `;
    html = html.replace('</head>', `${cleanStyles}</head>`);

    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(html);
  } catch (err) {
    console.error(`[cdn-proxy] 💥 Error:`, err.message);
    res.status(500).send(err.message);
  }
});

// User ID generation endpoint
app.post('/api/user/generate', (_req, res) => {
  const { generateUserId } = require('./src/storage');
  const userId = generateUserId();
  res.json({ userId });
});

// A1X IPTV addon — mounted at /a1x/
app.use('/a1x', a1xRouter);

// Logo proxy — fetches a remote image, applies fit/fill, returns processed PNG
app.get('/api/logos/proxy', async (req, res) => {
  const { url, mode } = req.query;
  if (!url) return res.status(400).json({ error: 'url required' });

  // Only allow GitHub raw URLs for security
  if (!url.startsWith('https://raw.githubusercontent.com/tv-logo/tv-logos/')) {
    return res.status(403).json({ error: 'URL not allowed' });
  }

  try {
    const { Jimp, JimpMime } = require('jimp');
    const SIZE = 400;
    const PADDING = 40;

    const src = await Jimp.read(url);
    const sw = src.width;
    const sh = src.height;

    let scale;
    if (mode === 'fill') {
      scale = Math.max(SIZE / sw, SIZE / sh);
    } else {
      const maxDim = SIZE - PADDING * 2;
      scale = Math.min(maxDim / sw, maxDim / sh);
    }

    const newW = Math.round(sw * scale);
    const newH = Math.round(sh * scale);
    src.resize({ w: newW, h: newH });

    const out = new Jimp({ width: SIZE, height: SIZE, color: 0x00000000 });
    const x = Math.round((SIZE - newW) / 2);
    const y = Math.round((SIZE - newH) / 2);
    out.composite(src, x, y);

    const outBuffer = await out.getBuffer(JimpMime.png);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(outBuffer);
  } catch (e) {
    console.error('Logo proxy error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Dynamic SDK Router middleware — only handles catalog/stream/meta routes, NOT manifest
app.use(async (req, res, next) => {
  // Skip SDK router for admin, API, and manifest routes
  if (
    req.path.startsWith('/api/') ||
    req.path.startsWith('/admin') ||
    req.path === '/hls-helper' ||
    req.path === '/manifest.json' ||
    req.path.endsWith('/manifest.json')
  )
    return next();

  // Extract userId from path if present: /user-xxx/catalog/...
  const userIdMatch = req.path.match(/^\/(user-[^/]+)\//);
  const userId = userIdMatch ? userIdMatch[1] : null;

  // Derive base URL from the incoming request so logos resolve correctly in Stremio
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host || `localhost:${PORT}`;
  const baseUrl = `${proto}://${host}`;

  // Load user-specific config and rebuild router
  try {
    const fresh = await loadConfig(userId);
    fresh.baseUrl = baseUrl;
    currentConfig = fresh;
    rebuildSdkRouter();
  } catch (e) {
    console.error('Failed to load config:', e.message);
    return res.status(500).json({ error: 'Failed to load configuration' });
  }

  // Strip userId from URL before passing to SDK router
  if (userId) {
    req.url = req.url.replace(`/${userId}`, '');
  }

  if (!activeSdkRouter) {
    return res.status(503).json({ error: 'Addon not initialized' });
  }

  activeSdkRouter(req, res, next);
});

// Redirect root to admin for easier navigation
app.get('/', (_req, res) => {
  res.redirect('/admin');
});



// Serve manifest dynamically — always load fresh config so Vercel cold starts
// don't serve a stale/empty manifest from an old in-memory state
app.get('/manifest.json', async (_req, res) => {
  try {
    const config = await loadConfig();
    // Keep currentConfig in sync
    currentConfig = config;
    if (!activeSdkRouter) rebuildSdkRouter();
    const m = buildManifest(config.addonMeta, config.rows);
    res.setHeader('Cache-Control', 'max-age=0, no-cache, no-store, must-revalidate');
    res.json(m);
  } catch (e) {
    res.status(503).json({ error: e.message });
  }
});

// Admin panel (with reload capability)
mountAdmin(app, async () => {
  console.log('♻️  Reloading configuration...');
  try {
    currentConfig = await loadConfig();
    rebuildSdkRouter(); // Rebuild Stremio SDK router with new rows
    console.log(`✅  Reloaded: ${currentConfig.rows.length} rows and rebuilt SDK Router.`);
  } catch (e) {
    console.error('❌  Reload failed:', e.message);
  }
});

// Per-user manifest endpoint — must come AFTER mountAdmin to avoid swallowing /admin
app.get('/:userId/manifest.json', async (req, res) => {
  try {
    const userId = req.params.userId;
    console.log(`📋 Loading manifest for user: ${userId}`);
    const config = await loadConfig(userId);
    console.log(`✅ User ${userId} has ${config.rows.length} rows`);
    const m = buildManifest(config.addonMeta, config.rows);
    res.setHeader('Cache-Control', 'max-age=0, no-cache, no-store, must-revalidate');
    res.json(m);
  } catch (e) {
    console.error(`❌ Manifest error for user ${req.params.userId}:`, e.message);
    res.status(503).json({ error: e.message });
  }
});

// ── 3. Initialize & Export ──────────────────────────────────────────────────
startup();

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n🚀  Stremio Custom Row Factory is running!`);
    console.log(`   ➜  http://127.0.0.1:${PORT}/admin`);
    console.log(`   ➜  http://127.0.0.1:${PORT}/manifest.json\n`);
  });
}

module.exports = app;
