/* exported esc, safeJson, slugify, openModal, closeModal, toast, markDirty, saveAll, init, renderLoggedOutState, onLogoClick, getUserParam, ensureUserId */
'use strict';

const CINEMETA = 'https://v3-cinemeta.strem.io';

// ─── State
let config = {
  addon: {
    id: 'com.stremirow.custom',
    version: '1.0.0',
    name: 'StremiRow',
    description: 'Personal curated rows...',
  },
  rows: [],
};
let editingRowIdx = -1,
  tempRowItems = [];
let movieType = 'movie',
  movieResults = [],
  movieTimer = null;
let tvAddons = [];
const EXCLUDED_ADDON_IDS = new Set(['com.stremirow.custom']);
function isTvAddon(a) {
  if (EXCLUDED_ADDON_IDS.has(a.manifest.id)) return false;
  const t = a.manifest.types || [];
  return t.includes('tv') || t.includes('channel');
}

// ─── User ID Management
let userId = localStorage.getItem('stremirow-user-id');
async function ensureUserId() {
  if (!userId) {
    const res = await fetch('/api/user/generate', { method: 'POST' });
    const data = await res.json();
    userId = data.userId;
    localStorage.setItem('stremirow-user-id', userId);
  }
  return userId;
}

function getUserParam() {
  return userId ? `?userId=${userId}` : '';
}

// ─── Util
function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function safeJson(o) {
  return JSON.stringify(o).replace(/'/g, '&#39;');
}
function slugify(n) {
  return n
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
function openModal(id) {
  document.getElementById(id).classList.add('open');
}
function closeModal(id) {
  document.getElementById(id).classList.remove('open');
}

let _toastTimer;
function toast(msg, type = 'success') {
  const el = document.getElementById('toast');
  const icon =
    type === 'success'
      ? '<span class="material-icons">check_circle</span>'
      : '<span class="material-icons">error</span>';
  el.innerHTML = icon + ' ' + msg;
  el.className = 'toast show ' + type;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => (el.className = 'toast'), 4000);
}
let _saveTimer = null;
function markDirty() {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(saveAll, 300);
}

// ─── Logo Easter Egg
let logoClicks = [];
function onLogoClick(event) {
  if (!event.shiftKey) return;
  const now = Date.now();
  logoClicks.push(now);
  logoClicks = logoClicks.filter((t) => now - t < 10000);
  if (logoClicks.length >= 7) {
    const miptv_Section = document.getElementById('miptv-section');
    if (miptv_Section) {
      miptv_Section.style.display = 'block';
      toast('MIPTV unlocked!', 'success');
    }
    logoClicks = [];
  }
}

function collectSettings() {
  config.addon.name = 'StremiRow';
  config.addon.version = config.addon.version || '1.0.0';
  config.addon.description = 'Personal curated rows...';
  config.addon.id = 'com.stremirow.custom';
}

// ─── Save
async function saveAll() {
  await ensureUserId();
  collectSettings();

  // Store orphan custom channels in config
  if (window._orphanCustomChannels && window._orphanCustomChannels.length) {
    config._orphanCustomChannels = window._orphanCustomChannels;
  } else {
    delete config._orphanCustomChannels;
  }

  // Save to browser localStorage with 30-day expiry
  const configData = {
    config: config,
    timestamp: Date.now(),
    expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000, // 30 days
  };
  localStorage.setItem('stremirow-config', JSON.stringify(configData));

  const statusEl = document.getElementById('save-status');
  if (statusEl) {
    statusEl.textContent = '⏳ Saving…';
    statusEl.style.color = 'var(--soft)';
  }
  try {
    const r = await fetch(`/api/config${getUserParam()}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    if (!r.ok) throw new Error('Save failed');
    if (statusEl) {
      statusEl.textContent = 'Saved ✓';
      statusEl.style.color = 'var(--color-accent-primary)';
      setTimeout(() => {
        if (statusEl.textContent === 'Saved ✓') {
          statusEl.textContent = '';
          statusEl.style.color = '';
        }
      }, 3000);
    }
  } catch (e) {
    if (statusEl) {
      statusEl.textContent = '❌ Save failed';
      statusEl.style.color = 'var(--color-error)';
    }
    toast('Save failed: ' + e.message, 'error');
  }
}

// ─── Init
async function init() {
  if (location.port === '5500') {
    alert('⚠️ Use http://127.0.0.1:7000/admin instead of Live Server.');
    return;
  }
  try {
    await ensureUserId();

    // Check auth status first
    await initSidebarAuth();

    // Only load and render content if logged in
    if (sidebarAuthStatus && sidebarAuthStatus.loggedIn) {
      // Try to load from localStorage first for instant render
      const savedData = localStorage.getItem('stremirow-config');
      let hasLocalData = false;

      if (savedData) {
        try {
          const parsed = JSON.parse(savedData);
          if (parsed.expiresAt && Date.now() < parsed.expiresAt) {
            config = parsed.config;
            hasLocalData = true;
            console.log('⚡ Loaded config from browser storage (instant)');

            // Load orphan custom channels from config
            if (config._orphanCustomChannels) {
              window._orphanCustomChannels = config._orphanCustomChannels;
            } else {
              window._orphanCustomChannels = [];
            }

            // Render immediately with cached data
            renderRows();
            renderCustomChannelsPanel();
            renderInstallTab();
          }
        } catch (e) {
          console.error('Failed to parse saved config:', e);
        }
      }

      // Then fetch fresh data in background and update if different
      fetch(`/api/config${getUserParam()}`)
        .then((r) => r.json())
        .then((c) => {
          const freshConfig = JSON.stringify(c);
          const currentConfig = JSON.stringify(config);

          if (freshConfig !== currentConfig) {
            console.log('🔄 Server config differs, updating...');
            config = c;

            // Save to localStorage
            const configData = {
              config: config,
              timestamp: Date.now(),
              expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
            };
            localStorage.setItem('stremirow-config', JSON.stringify(configData));

            // Load orphan custom channels from config
            if (config._orphanCustomChannels) {
              window._orphanCustomChannels = config._orphanCustomChannels;
            } else {
              window._orphanCustomChannels = [];
            }

            // Re-render with fresh data
            renderRows();
            renderCustomChannelsPanel();
            renderInstallTab();
          } else {
            console.log('✅ Config is up to date');
          }
        })
        .catch((e) => {
          if (!hasLocalData) {
            toast('Failed to load config: ' + e.message, 'error');
          }
        });

      // If no local data, show loading state
      if (!hasLocalData) {
        const rowsContainer = document.getElementById('rows-container');
        const channelsContainer = document.getElementById('channels-container');

        if (rowsContainer) {
          rowsContainer.innerHTML =
            '<div class="empty-state"><div class="empty-icon"><span class="material-icons">hourglass_empty</span></div><div class="empty-title">Loading...</div></div>';
        }

        if (channelsContainer) {
          channelsContainer.innerHTML =
            '<div class="empty-state"><div class="empty-icon"><span class="material-icons">hourglass_empty</span></div><div class="empty-title">Loading...</div></div>';
        }

        // Wait for the fetch to complete
        await fetch(`/api/config${getUserParam()}`)
          .then((r) => r.json())
          .then((c) => {
            config = c;

            // Save to localStorage
            const configData = {
              config: config,
              timestamp: Date.now(),
              expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
            };
            localStorage.setItem('stremirow-config', JSON.stringify(configData));

            // Load orphan custom channels from config
            if (config._orphanCustomChannels) {
              window._orphanCustomChannels = config._orphanCustomChannels;
            } else {
              window._orphanCustomChannels = [];
            }

            renderRows();
            renderCustomChannelsPanel();
            renderInstallTab();
          });
      }
    } else {
      // Show empty states when not logged in
      renderLoggedOutState();
    }
  } catch (e) {
    toast('Failed to load config: ' + e.message, 'error');
  }
}

function renderLoggedOutState() {
  const rowsContainer = document.getElementById('rows-container');
  const channelsContainer = document.getElementById('channels-container');

  if (rowsContainer) {
    rowsContainer.innerHTML =
      '<div class="empty-state"><div class="empty-icon"><span class="material-icons">lock</span></div><div class="empty-title">Connect Stremio Account</div><div class="empty-text">Sign in to create and manage custom rows</div></div>';
  }

  if (channelsContainer) {
    channelsContainer.innerHTML =
      '<div class="empty-state"><div class="empty-icon"><span class="material-icons">lock</span></div><div class="empty-title">Connect Stremio Account</div><div class="empty-text">Sign in to create and manage multi-source channels</div></div>';
  }

  renderInstallTab();
}
