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
    const CSS_FILE = path.join(__dirname, 'admin.css');
    const JS_FILE = path.join(__dirname, 'admin-ui.js');

    app.get('/admin', (_req, res) => res.sendFile(HTML_FILE));
    app.get('/admin.css', (_req, res) => res.sendFile(CSS_FILE));
    app.get('/admin-ui.js', (_req, res) => res.sendFile(JS_FILE));

    app.get('/api/config', async (_req, res) => {
        try {
            const config = await storage.loadConfig();
            res.json(storage.normalizeConfig(config));
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.put('/api/config', async (req, res) => {
        try {
            const cfg = req.body;
            if (!cfg || !cfg.addon || !Array.isArray(cfg.rows))
                return res.status(400).json({ error: 'Invalid config shape' });
            await storage.saveConfig(cfg);
            if (onReload) await onReload();
            res.json({ ok: true, rows: cfg.rows.length });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.get('/api/stremio/status', async (_req, res) => {
        const auth = await AUTH.loadAuth();
        res.json({ loggedIn: !!auth, email: auth?.email || null });
    });

    app.post('/api/stremio/login', async (req, res) => {
        const { email, password } = req.body || {};
        if (!email || !password)
            return res.status(400).json({ error: 'email and password required' });
        try {
            const result = await stremioPost('/api/login', { type: 'Auth', email, password });
            if (!result.result?.authKey)
                return res.status(401).json({ error: result.error?.message || 'Stremio login failed' });
            try {
                await AUTH.saveAuth({ authKey: result.result.authKey, email });
            } catch (gistErr) {
                return res.status(500).json({ error: `Cloud Save Failed: ${gistErr.message}` });
            }
            res.json({ ok: true, email });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.post('/api/stremio/logout', async (_req, res) => {
        await AUTH.clearAuth();
        res.json({ ok: true });
    });

    app.get('/api/stremio/addons', async (_req, res) => {
        const auth = await AUTH.loadAuth();
        if (!auth) return res.status(401).json({ error: 'Not logged in' });
        try {
            console.log(`🔄  Refreshing Stremio Addon Collection for ${auth.email}...`);
            const result = await stremioPost('/api/addonCollectionGet', { authKey: auth.authKey });
            if (result.error) {                const msg = result.error.message || '';
                if (/unauthorized|invalid|expired|auth/i.test(msg)) {
                    await AUTH.clearAuth();
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

    app.post('/api/stremio/sync', async (_req, res) => {
        const auth = await AUTH.loadAuth();
        if (!auth) return res.status(401).json({ error: 'Not logged in' });
        try {
            const getResult = await stremioPost('/api/addonCollectionGet', {
                type: 'AddonCollectionGet',
                authKey: auth.authKey,
                update: true,
            });
            if (getResult.error) return res.status(400).json({ error: getResult.error.message });

            const addons = getResult.result?.addons || [];

            const setResult = await stremioPost('/api/addonCollectionSet', {
                type: 'AddonCollectionSet',
                authKey: auth.authKey,
                addons,
            });
            if (setResult.error) return res.status(400).json({ error: setResult.error.message });
            if (!setResult.result?.success) return res.status(400).json({ error: 'Sync failed' });

            res.json({ ok: true });
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
