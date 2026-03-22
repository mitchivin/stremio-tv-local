/**
 * storage.js
 * Handles reading and writing configuration.
 * Supports Local File (development) and GitHub Gist (production/cloud).
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const LOCAL_CONFIG = path.join(ROOT, 'ui-config.json');
const LOCAL_AUTH = path.join(ROOT, 'stremio-auth.json');
const HTML_FILE = path.join(ROOT, 'src', 'public', 'admin.html');

// ENV VARS for Cloud Persistence
const GIST_ID = (process.env.GIST_ID || '').trim();
const GH_TOKEN = (process.env.GH_TOKEN || '').trim();

// In-request Gist cache — avoids multiple fetches within the same serverless invocation
// Also serves as a short-term cache across warm invocations on Vercel
let _gistCache = null;
let _gistCacheTime = 0;
const GIST_CACHE_TTL = 30 * 60 * 1000; // 30 minutes — safe for catalog serving

function _invalidateGistCache() {
  _gistCache = null;
  _gistCacheTime = 0;
}

async function _fetchGistCached() {
  const now = Date.now();
  if (_gistCache && now - _gistCacheTime < GIST_CACHE_TTL) {
    return _gistCache;
  }
  _gistCache = await fetchGist();
  _gistCacheTime = Date.now();
  return _gistCache;
}

/**
 * Common shape for our config
 */
function normalizeConfig(data) {
  if (!data || !data.addon) {
    data = {
      addon: {
        id: 'com.stremirow.custom',
        name: 'StremiRow',
        version: '1.0.0',
        description: 'Personal curated rows...',
      },
      rows: [],
    };
  }
  // Always enforce identity
  data.addon.id = 'com.stremirow.custom';
  data.addon.name = 'StremiRow';
  if (!Array.isArray(data.rows)) data.rows = [];
  return data;
}

/**
 * Common shape for our auth
 */
function normalizeAuth(data) {
  if (!data) return null;
  return data.authKey && data.email ? data : null;
}

/**
 * Generate a unique user ID
 */
function generateUserId() {
  return 'user-' + Date.now() + '-' + Math.random().toString(36).substring(2, 15);
}

// Per-user config cache — prevents Gist hammering on every Stremio catalog request
const _userConfigCache = new Map(); // userId -> { config, time }
const USER_CONFIG_TTL = 30 * 60 * 1000; // 30 minutes

/**
 * Load config from Gist or Local file (per-user)
 */
async function loadConfig(userId = null) {
  const filename = userId ? `${userId}-config.json` : 'ui-config.json';

  if (GIST_ID && GH_TOKEN) {
    // Check per-user cache first
    const cacheKey = userId || '__default__';
    const cached = _userConfigCache.get(cacheKey);
    if (cached && Date.now() - cached.time < USER_CONFIG_TTL) {
      return cached.config;
    }

    console.log(`☁️  Loading config from Gist: ${filename}`);
    try {
      const gist = await _fetchGistCached();
      if (gist.files && gist.files[filename]) {
        const fileData = gist.files[filename];
        let content = fileData.content;

        // If file is truncated, fetch from raw_url
        if (fileData.truncated && fileData.raw_url) {
          console.log(`📥 Config file is truncated, fetching from raw_url`);
          content = await fetchRawUrl(fileData.raw_url);
        }

        const result = normalizeConfig(JSON.parse(content));
        _userConfigCache.set(cacheKey, { config: result, time: Date.now() });
        return result;
      }
      console.log(`⚠️  ${filename} not found in Gist, returning default.`);
    } catch (e) {
      console.error(`❌ Gist load error: ${e.message}`);
      // Return cached version if available, even if stale
      if (cached) {
        console.log(`⚠️  Using stale cache for ${filename}`);
        return cached.config;
      }
    }
    const defaultConfig = normalizeConfig({});
    _userConfigCache.set(cacheKey, { config: defaultConfig, time: Date.now() });
    return defaultConfig;
  }

  // Fallback to local
  const localPath = userId ? path.join(ROOT, `${userId}-config.json`) : LOCAL_CONFIG;
  if (!fs.existsSync(localPath)) {
    return normalizeConfig({});
  }
  return normalizeConfig(JSON.parse(fs.readFileSync(localPath, 'utf8')));
}

/**
 * Strip base64 data URLs from config before saving to Gist.
 * Replaces any data: thumbnail with empty string to prevent Gist bloat.
 */
function sanitizeConfigForStorage(data) {
  if (!data || !Array.isArray(data.rows)) return data;
  for (const row of data.rows) {
    for (const item of row.items || []) {
      if (item.thumbnail && item.thumbnail.startsWith('data:')) item.thumbnail = '';
      delete item._rawLogo;
    }
  }
  return data;
}

/**
 * Save config to Gist or Local file (per-user)
 */
async function saveConfig(config, userId = null) {
  const normalized = normalizeConfig(config);
  // Bump version on every save so Stremio busts its catalog cache on sync
  normalized.addon.version = `1.0.${Date.now()}`;
  const data = sanitizeConfigForStorage(normalized);
  const json = JSON.stringify(data, null, 2);
  const filename = userId ? `${userId}-config.json` : 'ui-config.json';

  if (GIST_ID && GH_TOKEN) {
    console.log(`☁️  Saving config to Gist: ${filename}`);
    try {
      const result = await updateGist({ [filename]: { content: json } });
      _invalidateGistCache();
      _userConfigCache.delete(userId || '__default__');
      console.log(`✅  Config saved to Gist: ${filename}`);
      return result;
    } catch (e) {
      console.error(`❌  Failed to save config to Gist: ${e.message}`);
      throw e;
    }
  }

  // Fallback to local
  const localPath = userId ? path.join(ROOT, `${userId}-config.json`) : LOCAL_CONFIG;
  fs.writeFileSync(localPath, json, 'utf8');
  console.log(`✅  Config saved locally: ${localPath}`);
  return { ok: true };
}

/**
 * Load auth from Gist or Local file (per-user)
 */
async function loadAuth(userId = null) {
  const filename = userId ? `${userId}-auth.json` : 'stremio-auth.json';

  if (GIST_ID && GH_TOKEN) {
    try {
      const gist = await _fetchGistCached();
      if (gist.files && gist.files[filename]) {
        const fileData = gist.files[filename];
        let content = fileData.content;

        // If file is truncated, fetch from raw_url
        if (fileData.truncated && fileData.raw_url) {
          console.log(`📥 File is truncated, fetching from raw_url: ${filename}`);
          content = await fetchRawUrl(fileData.raw_url);
        }

        // Handle empty or whitespace-only content
        if (!content || !content.trim()) {
          console.log(`⚠️  ${filename} is empty in Gist, deleting it`);
          try {
            await updateGist({ [filename]: null });
            console.log(`🧹 Deleted empty auth file: ${filename}`);
          } catch (deleteErr) {
            console.error(`Failed to delete empty auth: ${deleteErr.message}`);
          }
          return null;
        }

        try {
          return normalizeAuth(JSON.parse(content));
        } catch (parseErr) {
          console.error(`❌ Failed to parse ${filename}: ${parseErr.message}`);
          console.log(`🧹 Clearing corrupted auth file: ${filename}`);
          await updateGist({ [filename]: null }).catch((e) =>
            console.error('Failed to clear corrupted auth:', e.message)
          );
          return null;
        }
      }
    } catch (e) {
      console.error(`❌ Gist auth load error: ${e.message}`);
    }
    return null;
  }

  const localPath = userId ? path.join(ROOT, `${userId}-auth.json`) : LOCAL_AUTH;
  try {
    const content = fs.readFileSync(localPath, 'utf8');
    if (!content || !content.trim()) return null;
    return normalizeAuth(JSON.parse(content));
  } catch (_) {
    return null;
  }
}

/**
 * Save auth to Gist or Local file (per-user)
 */
async function saveAuth(data, userId = null) {
  const json = JSON.stringify(data, null, 2);
  const filename = userId ? `${userId}-auth.json` : 'stremio-auth.json';

  if (GIST_ID && GH_TOKEN) {
    console.log(`☁️  Saving auth to Gist: ${filename}`);
    const result = await updateGist({ [filename]: { content: json } });
    _invalidateGistCache();
    console.log(`✅ Auth saved successfully to Gist: ${filename}`);
    return result;
  }

  const localPath = userId ? path.join(ROOT, `${userId}-auth.json`) : LOCAL_AUTH;
  fs.writeFileSync(localPath, json, 'utf8');
  console.log(`✅ Auth saved locally: ${localPath}`);
}

/**
 * Clear auth from Gist or Local file (per-user)
 */
async function clearAuth(userId = null) {
  const filename = userId ? `${userId}-auth.json` : 'stremio-auth.json';

  if (GIST_ID && GH_TOKEN) {
    console.log(`☁️  Clearing auth from Gist: ${filename}`);
    const result = await updateGist({ [filename]: null });
    _invalidateGistCache();
    return result;
  }

  const localPath = userId ? path.join(ROOT, `${userId}-auth.json`) : LOCAL_AUTH;
  if (fs.existsSync(localPath)) fs.unlinkSync(localPath);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fetchRawUrl(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent': 'stremio-row-factory',
          Authorization: `Bearer ${GH_TOKEN}`,
        },
        timeout: 10000,
      },
      (res) => {
        let body = '';
        res.on('data', (d) => (body += d));
        res.on('end', () => {
          if (res.statusCode === 200) {
            resolve(body);
          } else {
            reject(new Error(`Failed to fetch raw URL: ${res.statusCode}`));
          }
        });
      }
    );
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('fetchRawUrl timed out after 10s'));
    });
    req.on('error', reject);
  });
}

function fetchGist() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: `/gists/${GIST_ID}`,
      method: 'GET',
      headers: {
        'User-Agent': 'stremio-row-factory',
        Authorization: `Bearer ${GH_TOKEN}`,
      },
      timeout: 10000,
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => {
        const status = res.statusCode;
        if (status >= 400) {
          console.error(`GitHub API Error (${status}):`, body);
          if (status === 401)
            return reject(
              new Error(`Unauthorized: Check if your GH_TOKEN is valid and has 'gist' scope.`)
            );
          if (status === 404)
            return reject(
              new Error(
                `Gist Not Found: Check if GIST_ID (${GIST_ID.substring(0, 4)}...) is correct.`
              )
            );
          return reject(new Error(`GitHub API Error: ${status}`));
        }

        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error(`Failed to parse GitHub response: ${e.message}`));
        }
      });
    });
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('fetchGist timed out after 10s'));
    });
    req.on('error', reject);
    req.end();
  });
}

function updateGist(files) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ files });
    const options = {
      hostname: 'api.github.com',
      path: `/gists/${GIST_ID}`,
      method: 'PATCH',
      headers: {
        'User-Agent': 'stremio-row-factory',
        Authorization: `Bearer ${GH_TOKEN}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout: 10000,
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => {
        const status = res.statusCode;
        if (status === 200) {
          resolve({ ok: true });
        } else {
          console.error(`GitHub PATCH Error (${status}):`, body);
          if (status === 401)
            reject(
              new Error(`Unauthorized: Check if your GH_TOKEN is valid and has 'gist' scope.`)
            );
          else if (status === 404)
            reject(
              new Error(
                `Gist Not Found: Check if GIST_ID (${GIST_ID.substring(0, 4)}...) is correct.`
              )
            );
          else reject(new Error(`GitHub PATCH failed: ${status}`));
        }
      });
    });
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('updateGist timed out after 10s'));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

module.exports = {
  loadConfig,
  saveConfig,
  loadAuth,
  saveAuth,
  clearAuth,
  normalizeConfig,
  generateUserId,
  HTML_FILE,
};
