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
 * Load config from Gist or Local file
 */
async function loadConfig() {
    if (GIST_ID && GH_TOKEN) {
        console.log(`☁️  Loading config from Gist ID: ${GIST_ID.substring(0, 4)}...`);
        try {
            const gist = await fetchGist();
            if (gist.files && gist.files['ui-config.json']) {
                return normalizeConfig(JSON.parse(gist.files['ui-config.json'].content));
            }
            console.log('⚠️  ui-config.json not found in Gist, returning default.');
        } catch (e) {
            console.error(`❌ Gist load error: ${e.message}`);
        }
        return normalizeConfig({});
    }

    // Fallback to local
    if (!fs.existsSync(LOCAL_CONFIG)) {
        return normalizeConfig({});
    }
    return normalizeConfig(JSON.parse(fs.readFileSync(LOCAL_CONFIG, 'utf8')));
}

/**
 * Save config to Gist or Local file
 */
async function saveConfig(config) {
    const data = normalizeConfig(config);
    const json = JSON.stringify(data, null, 2);

    if (GIST_ID && GH_TOKEN) {
        console.log(`☁️  Saving config to Gist ID: ${GIST_ID.substring(0, 4)}...`);
        return updateGist({ 'ui-config.json': { content: json } });
    }

    // Fallback to local
    fs.writeFileSync(LOCAL_CONFIG, json, 'utf8');
    return { ok: true };
}

/**
 * Load auth from Gist or Local file
 */
async function loadAuth() {
    if (GIST_ID && GH_TOKEN) {
        try {
            const gist = await fetchGist();
            if (gist.files && gist.files['stremio-auth.json']) {
                return normalizeAuth(JSON.parse(gist.files['stremio-auth.json'].content));
            }
        } catch (e) {
            console.error(`❌ Gist auth load error: ${e.message}`);
        }
        return null;
    }

    try { return normalizeAuth(JSON.parse(fs.readFileSync(LOCAL_AUTH, 'utf8'))); }
    catch (_) { return null; }
}

/**
 * Save auth to Gist or Local file
 */
async function saveAuth(data) {
    const json = JSON.stringify(data, null, 2);

    if (GIST_ID && GH_TOKEN) {
        console.log(`☁️  Saving auth to Gist ID: ${GIST_ID.substring(0, 4)}...`);
        return updateGist({ 'stremio-auth.json': { content: json } });
    }

    fs.writeFileSync(LOCAL_AUTH, json, 'utf8');
}

/**
 * Clear auth from Gist or Local file
 */
async function clearAuth() {
    if (GIST_ID && GH_TOKEN) {
        console.log(`☁️  Clearing auth from Gist ID: ${GIST_ID.substring(0, 4)}...`);
        return updateGist({ 'stremio-auth.json': null });
    }

    if (fs.existsSync(LOCAL_AUTH)) fs.unlinkSync(LOCAL_AUTH);
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

module.exports = { loadConfig, saveConfig, loadAuth, saveAuth, clearAuth, normalizeConfig, HTML_FILE };
