'use strict';

const path = require('path');
const https = require('https');
const storage = require('./storage');
const HTML_FILE = storage.HTML_FILE;
const AUTH = storage;

function stremioPost(apiPath, body) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify(body);
        const req = https.request({
            hostname: 'api.strem.io',
            path: apiPath,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload),
                'User-Agent': 'stremio-row-factory/1.0',
            },
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch (e) { reject(new Error('Invalid JSON from Stremio API')); }
            });
        });
        req.on('error', reject);
        req.write(payload);
        req.end();
    });
}

function mountAdmin(app, onReload) {
    const CSS_BASE = path.join(__dirname, 'admin-base.css');
    const CSS_FORMS = path.join(__dirname, 'admin-forms.css');
    const CSS_CARDS = path.join(__dirname, 'admin-cards.css');
    const CSS_MODALS = path.join(__dirname, 'admin-modals.css');
    const CSS_BUILDER = path.join(__dirname, 'admin-builder.css');
    const CSS_CHANNELS = path.join(__dirname, 'admin-channels.css');
    const JS_CORE = path.join(__dirname, 'admin-ui-core.js');
    const JS_ROWS = path.join(__dirname, 'admin-ui-rows.js');
    const JS_MOVIES = path.join(__dirname, 'admin-ui-movies.js');
    const JS_TV = path.join(__dirname, 'admin-ui-tv.js');
    const JS_CHANNELS = path.join(__dirname, 'admin-ui-channels.js');
    const JS_AUTH = path.join(__dirname, 'admin-ui-auth.js');

    app.get('/admin', (_req, res) => res.sendFile(HTML_FILE));
    app.get('/admin-base.css', (_req, res) => res.sendFile(CSS_BASE));
    app.get('/admin-forms.css', (_req, res) => res.sendFile(CSS_FORMS));
    app.get('/admin-cards.css', (_req, res) => res.sendFile(CSS_CARDS));
    app.get('/admin-modals.css', (_req, res) => res.sendFile(CSS_MODALS));
    app.get('/admin-builder.css', (_req, res) => res.sendFile(CSS_BUILDER));
    app.get('/admin-channels.css', (_req, res) => res.sendFile(CSS_CHANNELS));
    app.get('/admin-ui-core.js', (_req, res) => res.sendFile(JS_CORE));
    app.get('/admin-ui-rows.js', (_req, res) => res.sendFile(JS_ROWS));
    app.get('/admin-ui-movies.js', (_req, res) => res.sendFile(JS_MOVIES));
    app.get('/admin-ui-tv.js', (_req, res) => res.sendFile(JS_TV));
    app.get('/admin-ui-channels.js', (_req, res) => res.sendFile(JS_CHANNELS));
    app.get('/admin-ui-auth.js', (_req, res) => res.sendFile(JS_AUTH));

    app.get('/api/config', async (req, res) => {
        try {
            const userId = req.query.userId || null;
            const config = await storage.loadConfig(userId);
            res.json(storage.normalizeConfig(config));
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.put('/api/config', async (req, res) => {
        try {
            const cfg = req.body;
            const userId = req.query.userId || null;
            if (!cfg || !cfg.addon || !Array.isArray(cfg.rows))
                return res.status(400).json({ error: 'Invalid config shape' });
            await storage.saveConfig(cfg, userId);
            if (onReload) await onReload();
            res.json({ ok: true, rows: cfg.rows.length });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.get('/api/stremio/status', async (req, res) => {
        const userId = req.query.userId || null;
        const auth = await AUTH.loadAuth(userId);
        res.json({ loggedIn: !!auth, email: auth?.email || null });
    });

    app.post('/api/stremio/login', async (req, res) => {
        const { email, password } = req.body || {};
        const userId = req.query.userId || null;
        if (!email || !password)
            return res.status(400).json({ error: 'email and password required' });
        try {
            const result = await stremioPost('/api/login', { type: 'Auth', email, password });
            if (!result.result?.authKey)
                return res.status(401).json({ error: result.error?.message || 'Stremio login failed' });
            try {
                await AUTH.saveAuth({ authKey: result.result.authKey, email }, userId);
            } catch (gistErr) {
                return res.status(500).json({ error: `Cloud Save Failed: ${gistErr.message}` });
            }
            res.json({ ok: true, email });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.post('/api/stremio/logout', async (req, res) => {
        const userId = req.query.userId || null;
        await AUTH.clearAuth(userId);
        res.json({ ok: true });
    });

    app.get('/api/stremio/addons', async (req, res) => {
        const userId = req.query.userId || null;
        const auth = await AUTH.loadAuth(userId);
        if (!auth) return res.status(401).json({ error: 'Not logged in' });
        try {
            console.log(`🔄  Refreshing Stremio Addon Collection for ${auth.email}...`);
            const result = await stremioPost('/api/addonCollectionGet', { authKey: auth.authKey });
            if (result.error) {                const msg = result.error.message || '';
                if (/unauthorized|invalid|expired|auth/i.test(msg)) {
                    await AUTH.clearAuth(userId);
                    return res.status(401).json({ error: 'Session expired, please log in again' });
                }
                return res.status(400).json({ error: msg });
            }
            const addons = (result.result?.addons || []).map(a => ({
                transportUrl: a.transportUrl,
                manifest: a.manifest
            }));
            res.json({ addons });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.post('/api/stremio/sync', async (req, res) => {
        const userId = req.query.userId || null;
        const auth = await AUTH.loadAuth(userId);
        if (!auth) return res.status(401).json({ error: 'Not logged in' });
        try {
            // Get current addon collection
            const getResult = await stremioPost('/api/addonCollectionGet', {
                type: 'AddonCollectionGet',
                authKey: auth.authKey,
                update: true,
            });
            if (getResult.error) return res.status(400).json({ error: getResult.error.message });

            let addons = getResult.result?.addons || [];
            
            // Find our addon by manifest ID
            const ourAddonIndex = addons.findIndex(a => a.manifest?.id === 'com.stremirow.custom');

            if (ourAddonIndex >= 0) {
                // Remove and re-add to force Stremio to refetch the manifest
                const [ourAddon] = addons.splice(ourAddonIndex, 1);
                
                // First sync: remove our addon
                await stremioPost('/api/addonCollectionSet', {
                    type: 'AddonCollectionSet',
                    authKey: auth.authKey,
                    addons,
                });
                
                // Wait a moment
                await new Promise(resolve => setTimeout(resolve, 500));
                
                // Re-add at the same position
                addons.splice(ourAddonIndex, 0, ourAddon);
            }

            // Final sync with addon re-added
            const setResult = await stremioPost('/api/addonCollectionSet', {
                type: 'AddonCollectionSet',
                authKey: auth.authKey,
                addons,
            });
            if (setResult.error) return res.status(400).json({ error: setResult.error.message });
            if (!setResult.result?.success) return res.status(400).json({ error: 'Sync failed' });

            res.json({ ok: true, refreshed: ourAddonIndex >= 0 });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.get('/api/stremio/proxy-catalog', async (req, res) => {
        const urlStr = req.query.url;
        if (!urlStr) return res.status(400).json({ error: 'url parameter required' });
        try {
            const response = await fetch(urlStr, {
                headers: { 'User-Agent': 'stremio-row-factory/1.0' }
            });
            if (response.status === 404) return res.json({ metas: [] });
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const data = await response.json();
            res.json(data);
        } catch (e) {
            console.error('Proxy Error:', e.message);
            res.status(500).json({ error: e.message });
        }
    });

}

module.exports = { mountAdmin };
