'use strict';

const path = require('path');
const https = require('https');
const storage = require('./storage');
const AUTH = storage;

function stremioPost(apiPath, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = https.request(
      {
        hostname: 'api.strem.io',
        path: apiPath,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          'User-Agent': 'stremio-row-factory/1.0',
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (_e) {
            reject(new Error('Invalid JSON from Stremio API'));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function mountAdmin(app, onReload) {
  const PUBLIC_DIR = path.resolve(__dirname, 'public');

  // Serve each frontend asset explicitly
  const staticFiles = [
    'admin.html',
    'admin-base.css',
    'admin-forms.css',
    'admin-cards.css',
    'admin-modals.css',
    'admin-builder.css',
    'admin-channels.css',
    'admin-ui-core.js',
    'admin-ui-rows.js',
    'admin-ui-movies.js',
    'admin-ui-tv.js',
    'admin-ui-channels.js',
    'admin-ui-auth.js',
    'test-player.html',
    'cdn-player.html',
  ];
  for (const file of staticFiles) {
    app.get(`/${file}`, (_req, res) => res.sendFile(path.join(PUBLIC_DIR, file)));
  }
  app.get('/admin', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin.html')));
  app.get('/favicon.ico', (_req, res) => res.status(204).end());

  app.get('/api/config', async (req, res) => {
    try {
      const userId = req.query.userId || null;
      const config = await storage.loadConfig(userId);
      res.json(storage.normalizeConfig(config));
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.put('/api/config', async (req, res) => {
    try {
      const cfg = req.body;
      const userId = req.query.userId || null;
      if (!cfg || !cfg.addon || !Array.isArray(cfg.rows))
        return res.status(400).json({ error: 'Invalid config shape' });
      console.log('💾 Saving config for user:', userId, 'with', cfg.rows.length, 'rows');
      await storage.saveConfig(cfg, userId);
      // onReload rebuilds in-memory state — skip on serverless where state doesn't persist
      if (onReload && !process.env.VERCEL) await onReload();
      res.json({ ok: true, rows: cfg.rows.length });
    } catch (e) {
      console.error('❌ Config save error:', e.message, e.stack);
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/stremio/status', async (req, res) => {
    const userId = req.query.userId || null;
    const auth = await AUTH.loadAuth(userId);
    res.json({ loggedIn: !!auth, email: auth?.email || null });
  });

  app.post('/api/stremio/login', async (req, res) => {
    const { email, password } = req.body || {};
    const userId = req.query.userId || null;
    if (!email || !password) return res.status(400).json({ error: 'email and password required' });
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
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
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
      if (result.error) {
        const msg = result.error.message || '';
        if (/unauthorized|invalid|expired|auth/i.test(msg)) {
          await AUTH.clearAuth(userId);
          return res.status(401).json({ error: 'Session expired, please log in again' });
        }
        return res.status(400).json({ error: msg });
      }
      const addons = (result.result?.addons || []).map((a) => ({
        transportUrl: a.transportUrl,
        manifest: a.manifest,
      }));
      res.json({ addons });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/stremio/sync', async (req, res) => {
    const userId = req.query.userId || null;
    const auth = await AUTH.loadAuth(userId);
    if (!auth) return res.status(401).json({ error: 'Not logged in' });
    try {
      const getResult = await stremioPost('/api/addonCollectionGet', {
        type: 'AddonCollectionGet',
        authKey: auth.authKey,
        update: true,
      });
      if (getResult.error) return res.status(400).json({ error: getResult.error.message });

      let addons = getResult.result?.addons || [];
      const ourAddonIndex = addons.findIndex((a) => a.manifest?.id === 'com.stremirow.custom');

      if (ourAddonIndex < 0) {
        return res.json({ ok: true, refreshed: false, message: 'Addon not installed' });
      }

      // Build the fresh manifest directly from the saved config — no HTTP round-trip
      // This avoids race conditions where a manifest fetch hits a cold/stale server
      const { buildManifest } = require('./manifest');
      const freshConfig = await storage.loadConfig(userId);
      const freshManifest = buildManifest(freshConfig.addon, freshConfig.rows);

      // Bump version to force Stremio to treat this as a new manifest.
      // Do NOT mutate catalog IDs — that causes rows to vanish when Stremio
      // re-fetches /manifest.json and gets the original (un-suffixed) IDs.
      freshManifest.version = `1.0.${Date.now()}`;

      const ourAddon = addons[ourAddonIndex];
      addons[ourAddonIndex] = {
        transportUrl: ourAddon.transportUrl,
        transportName: ourAddon.transportName || '',
        manifest: freshManifest,
        flags: ourAddon.flags || {},
      };

      const setResult = await stremioPost('/api/addonCollectionSet', {
        type: 'AddonCollectionSet',
        authKey: auth.authKey,
        addons,
      });

      if (setResult.error) return res.status(400).json({ error: setResult.error.message });
      if (!setResult.result?.success) return res.status(400).json({ error: 'Sync failed' });

      res.json({ ok: true, refreshed: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // EMERGENCY: Force remove broken addon
  app.post('/api/stremio/emergency-remove', async (req, res) => {
    const userId = req.query.userId || null;
    const auth = await AUTH.loadAuth(userId);
    if (!auth) return res.status(401).json({ error: 'Not logged in' });
    try {
      console.log('🚨 EMERGENCY: Removing broken addon...');

      // Get current addon collection
      const getResult = await stremioPost('/api/addonCollectionGet', {
        type: 'AddonCollectionGet',
        authKey: auth.authKey,
        update: true,
      });

      if (getResult.error) {
        console.error('Failed to get addons:', getResult.error);
        return res.status(400).json({ error: getResult.error.message });
      }

      let addons = getResult.result?.addons || [];
      console.log('📦 Current addons count:', addons.length);

      // Log all addons to see which ones are broken
      addons.forEach((addon, idx) => {
        const manifestId = addon.manifest?.id || 'NULL';
        const manifestName = addon.manifest?.name || 'NULL';
        console.log(
          `  [${idx}] ${manifestId} - ${manifestName} - manifest: ${addon.manifest ? 'OK' : 'NULL'}`
        );
      });

      // Remove ALL addons with null/invalid manifests
      const validAddons = addons.filter((addon, idx) => {
        if (!addon.manifest || addon.manifest === null) {
          console.log(`❌ Removing addon at position ${idx} - NULL manifest`);
          return false;
        }
        return true;
      });

      // Also remove our addon if requested
      const filtered = validAddons.filter((a) => a.manifest?.id !== 'com.stremirow.custom');

      console.log('📦 After cleanup:', filtered.length, 'addons remaining');

      // Set collection without broken addons
      const setResult = await stremioPost('/api/addonCollectionSet', {
        type: 'AddonCollectionSet',
        authKey: auth.authKey,
        addons: filtered,
      });

      if (setResult.error) {
        console.error('Failed to set addons:', setResult.error);
        return res.status(400).json({ error: setResult.error.message });
      }

      const removedCount = addons.length - filtered.length;
      console.log('✅ Removed', removedCount, 'broken/stremirow addons');
      res.json({ ok: true, removed: removedCount, total: filtered.length });
    } catch (e) {
      console.error('Emergency remove error:', e);
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/stremio/proxy-catalog', async (req, res) => {
    const urlStr = req.query.url;
    if (!urlStr) return res.status(400).json({ error: 'url parameter required' });
    try {
      const response = await fetch(urlStr, {
        headers: { 'User-Agent': 'stremio-row-factory/1.0' },
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
