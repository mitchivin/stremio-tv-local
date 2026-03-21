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
const HTML_FILE = path.join(ROOT, 'src', 'admin.html');

// ENV VARS for Cloud Persistence
const GIST_ID = (process.env.GIST_ID || '').trim();
const GH_TOKEN = (process.env.GH_TOKEN || '').trim(); // Personal Access Token (classic) with 'gist' scope

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
                description: 'Personal curated rows...'
            },
            rows: []
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
    return (data.authKey && data.email) ? data : null;
}

/**
 * Generate a unique user ID
 */
function generateUserId() {
    return 'user-' + Date.now() + '-' + Math.random().toString(36).substring(2, 15);
}

/**
 * Load config from Gist or Local file (per-user)
 */
async function loadConfig(userId = null) {
    const filename = userId ? `${userId}-config.json` : 'ui-config.json';
    
    if (GIST_ID && GH_TOKEN) {
        console.log(`☁️  Loading config from Gist: ${filename}`);
        try {
            const gist = await fetchGist();
            if (gist.files && gist.files[filename]) {
                return normalizeConfig(JSON.parse(gist.files[filename].content));
            }
            console.log(`⚠️  ${filename} not found in Gist, returning default.`);
        } catch (e) {
            console.error(`❌ Gist load error: ${e.message}`);
        }
        return normalizeConfig({});
    }

    // Fallback to local
    const localPath = userId ? path.join(ROOT, `${userId}-config.json`) : LOCAL_CONFIG;
    if (!fs.existsSync(localPath)) {
        return normalizeConfig({});
    }
    return normalizeConfig(JSON.parse(fs.readFileSync(localPath, 'utf8')));
}

/**
 * Save config to Gist or Local file (per-user)
 */
async function saveConfig(config, userId = null) {
    const data = normalizeConfig(config);
    const json = JSON.stringify(data, null, 2);
    const filename = userId ? `${userId}-config.json` : 'ui-config.json';

    if (GIST_ID && GH_TOKEN) {
        console.log(`☁️  Saving config to Gist: ${filename}`);
        try {
            const result = await updateGist({ [filename]: { content: json } });
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
            const gist = await fetchGist();
            if (gist.files && gist.files[filename]) {
                return normalizeAuth(JSON.parse(gist.files[filename].content));
            }
        } catch (e) {
            console.error(`❌ Gist auth load error: ${e.message}`);
        }
        return null;
    }

    const localPath = userId ? path.join(ROOT, `${userId}-auth.json`) : LOCAL_AUTH;
    try { return normalizeAuth(JSON.parse(fs.readFileSync(localPath, 'utf8'))); }
    catch (_) { return null; }
}

/**
 * Save auth to Gist or Local file (per-user)
 */
async function saveAuth(data, userId = null) {
    const json = JSON.stringify(data, null, 2);
    const filename = userId ? `${userId}-auth.json` : 'stremio-auth.json';

    if (GIST_ID && GH_TOKEN) {
        console.log(`☁️  Saving auth to Gist: ${filename}`);
        return updateGist({ [filename]: { content: json } });
    }

    const localPath = userId ? path.join(ROOT, `${userId}-auth.json`) : LOCAL_AUTH;
    fs.writeFileSync(localPath, json, 'utf8');
}

/**
 * Clear auth from Gist or Local file (per-user)
 */
async function clearAuth(userId = null) {
    const filename = userId ? `${userId}-auth.json` : 'stremio-auth.json';
    
    if (GIST_ID && GH_TOKEN) {
        console.log(`☁️  Clearing auth from Gist: ${filename}`);
        return updateGist({ [filename]: null });
    }

    const localPath = userId ? path.join(ROOT, `${userId}-auth.json`) : LOCAL_AUTH;
    if (fs.existsSync(localPath)) fs.unlinkSync(localPath);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fetchGist() {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'api.github.com',
            path: `/gists/${GIST_ID}`,
            method: 'GET',
            headers: {
                'User-Agent': 'stremio-row-factory',
                'Authorization': `Bearer ${GH_TOKEN}`
            }
        };
        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', d => body += d);
            res.on('end', () => {
                const status = res.statusCode;
                if (status >= 400) {
                    console.error(`GitHub API Error (${status}):`, body);
                    if (status === 401) return reject(new Error(`Unauthorized: Check if your GH_TOKEN is valid and has 'gist' scope.`));
                    if (status === 404) return reject(new Error(`Gist Not Found: Check if GIST_ID (${GIST_ID.substring(0, 4)}...) is correct.`));
                    return reject(new Error(`GitHub API Error: ${status}`));
                }

                try { resolve(JSON.parse(body)); }
                catch (e) { reject(new Error(`Failed to parse GitHub response: ${e.message}`)); }
            });
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
                'Authorization': `Bearer ${GH_TOKEN}`,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            }
        };
        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', d => body += d);
            res.on('end', () => {
                const status = res.statusCode;
                if (status === 200) {
                    resolve({ ok: true });
                } else {
                    console.error(`GitHub PATCH Error (${status}):`, body);
                    if (status === 401) reject(new Error(`Unauthorized: Check if your GH_TOKEN is valid and has 'gist' scope.`));
                    else if (status === 404) reject(new Error(`Gist Not Found: Check if GIST_ID (${GIST_ID.substring(0, 4)}...) is correct.`));
                    else reject(new Error(`GitHub PATCH failed: ${status}`));
                }
            });
        });
        req.on('error', reject);
        req.write(payload);
        req.end();
    });
}

module.exports = { loadConfig, saveConfig, loadAuth, saveAuth, clearAuth, normalizeConfig, generateUserId, HTML_FILE };
