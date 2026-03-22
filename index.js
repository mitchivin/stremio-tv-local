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
const path = require('path');
const { addonBuilder } = require('stremio-addon-sdk');
const getRouter = require('stremio-addon-sdk/src/getRouter');
const { loadConfig } = require('./src/loader');
const { buildManifest } = require('./src/manifest');
const { registerHandlers } = require('./src/handlers');
const { mountAdmin } = require('./src/admin');
const a1xRouter = require('./src/a1x');

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
const PORT = parseInt(process.env.PORT || '7000', 10);

app.use(express.json({ limit: '5mb' }));
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  next();
});

// User ID generation endpoint
app.post('/api/user/generate', (_req, res) => {
  const { generateUserId } = require('./src/storage');
  const userId = generateUserId();
  res.json({ userId });
});

// Logo list endpoint - returns list of available logos
app.get('/api/logos/list', (_req, res) => {
  const fs = require('fs');
  const logosDir = path.resolve(__dirname, 'logos');
  try {
    const files = fs.readdirSync(logosDir);
    const logos = files
      .filter((f) => /^\d+\.png$/.test(f))
      .sort((a, b) => {
        const numA = parseInt(a.replace('.png', ''));
        const numB = parseInt(b.replace('.png', ''));
        return numA - numB;
      });
    res.json({ logos });
  } catch (e) {
    console.error('Failed to read logos directory:', e);
    res.status(500).json({ error: 'Failed to read logos directory', details: e.message });
  }
});

// A1X IPTV addon — mounted at /a1x/
app.use('/logos', express.static(path.resolve(__dirname, 'logos')));
app.use('/a1x', a1xRouter);

// Dynamic SDK Router middleware — only handles catalog/stream/meta routes, NOT manifest
app.use(async (req, res, next) => {
  // Skip SDK router for admin, API, and manifest routes
  if (
    req.path.startsWith('/api/') ||
    req.path.startsWith('/admin') ||
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
