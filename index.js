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
let startupPromise = null;

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

// A1X IPTV addon — mounted at /a1x/
app.use('/logos', express.static(path.join(__dirname, 'logos')));
app.use('/a1x', a1xRouter);

// Dynamic SDK Router middleware — only handles catalog/stream/meta routes, NOT manifest
app.use(async (req, res, next) => {
    // Skip SDK router for admin, API, and manifest routes
    if (req.path.startsWith('/api/') || req.path.startsWith('/admin') || req.path === '/manifest.json') return next();
    // On Vercel, always ensure config is loaded before serving catalog requests
    if (!activeSdkRouter) {
        if (startupPromise) await startupPromise;
        if (!activeSdkRouter) return next();
    }
    // Always reload config before serving catalogs so we never serve stale data
    try {
        const fresh = await loadConfig();
        if (JSON.stringify(fresh.rows) !== JSON.stringify(currentConfig?.rows)) {
            currentConfig = fresh;
            rebuildSdkRouter();
        }
    } catch (_) {}
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

// ── 3. Initialize & Export ──────────────────────────────────────────────────
startupPromise = startup();

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`\n🚀  Stremio Custom Row Factory is running!`);
        console.log(`   ➜  http://127.0.0.1:${PORT}/admin`);
        console.log(`   ➜  http://127.0.0.1:${PORT}/manifest.json\n`);
    });
}

module.exports = app;


