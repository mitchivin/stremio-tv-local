/* exported confirmLogout, syncStremio, installStremio, renderInstallTab, copyInstallUrl, copyMiptv_Url, installMiptv, sidebarDoLogin */
/* global _saveTimer */
'use strict';

// ─── Stremio Auth & Sync

let sidebarAuthStatus = null;

async function initSidebarAuth() {
  sidebarAuthStatus = await fetch(`/api/stremio/status${getUserParam()}`)
    .then((r) => r.json())
    .catch(() => null);
  const headerAccount = document.getElementById('header-account');
  const modalContent = document.getElementById('account-modal-content');

  const tvOption = document.querySelector('.builder-type-btn[data-type="tv"]');
  if (tvOption) {
    if (sidebarAuthStatus && sidebarAuthStatus.loggedIn) {
      tvOption.disabled = false;
      tvOption.title = '';
    } else {
      tvOption.title = 'Sign in to use TV Channels';
    }
  }

  if (headerAccount) {
    if (sidebarAuthStatus && sidebarAuthStatus.loggedIn) {
      headerAccount.innerHTML = `
        <div class="account-badge" onclick="confirmLogout()" title="Click to logout">
          <span class="account-status-dot"></span>
          <span class="account-email">${esc(sidebarAuthStatus.email || '')}</span>
        </div>
      `;
    } else {
      headerAccount.innerHTML = `
        <div class="account-badge" onclick="openModal('stremio-login-modal')" title="Click to connect">
          <span class="material-icons" style="font-size:18px;color:var(--color-text-tertiary);">lock</span>
          <span style="color:var(--color-text-tertiary);">Not connected</span>
        </div>
      `;
    }
  }

  if (!modalContent) return;
  if (sidebarAuthStatus && sidebarAuthStatus.loggedIn) {
    modalContent.innerHTML = `
      <div class="modal-title">Stremio Account</div>
      <div class="account-card">
        <div class="account-status-badge">
          <span class="account-status-dot"></span>
          Connected
        </div>
        <div class="account-email">${esc(sidebarAuthStatus.email || '')}</div>
        <div class="account-desc">Your IPTV channels are synchronized.</div>
        <div class="modal-footer" style="justify-content: center;">
          <button class="btn btn-ghost" onclick="closeModal('stremio-login-modal')">Close</button>
          <button class="btn btn-danger" onclick="sidebarLogout()">Disconnect</button>
        </div>
      </div>`;
  } else {
    modalContent.innerHTML = `
      <div class="modal-title">Connect Stremio Account</div>
      <div style="font-size:11px;color:var(--color-text-tertiary);margin-bottom:14px">Required to use StremiRow. Your session is saved so you only need to do this once.</div>
      <div class="form-group"><label class="form-label">Email</label><input class="form-input" id="sl-email" type="email" placeholder="your@email.com" /></div>
      <div class="form-group"><label class="form-label">Password</label><input class="form-input" id="sl-pass" type="password" placeholder="••••••••" onkeydown="if(event.key==='Enter')sidebarDoLogin()" /></div>
      <div class="err-text" id="sl-err"></div>
      <div class="modal-footer" style="justify-content: center;">
        <button class="btn btn-primary" id="sl-btn" onclick="sidebarDoLogin()">Connect</button>
      </div>`;
    openModal('stremio-login-modal');
  }
}

async function sidebarDoLogin() {
  const email = document.getElementById('sl-email').value;
  const password = document.getElementById('sl-pass').value;
  const btn = document.getElementById('sl-btn');
  const err = document.getElementById('sl-err');
  if (!email || !password) {
    err.textContent = 'Email and password required';
    err.style.display = 'block';
    return;
  }
  err.style.display = 'none';
  btn.innerHTML =
    '<span class="material-icons" style="font-size:14px;margin-right:4px;">hourglass_empty</span>Connecting…';
  btn.disabled = true;
  try {
    const d = await fetch(`/api/stremio/login${getUserParam()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    }).then((r) => r.json());
    if (d.error) throw new Error(d.error);
    closeModal('stremio-login-modal');
    document.getElementById('sl-email').value = '';
    document.getElementById('sl-pass').value = '';
    await initSidebarAuth();

    // Load and render content after successful login
    const savedData = localStorage.getItem('stremirow-config');
    if (savedData) {
      try {
        const parsed = JSON.parse(savedData);
        if (parsed.expiresAt && Date.now() < parsed.expiresAt) {
          config = parsed.config;
          console.log('✅ Loaded config from browser storage');
        } else {
          console.log('⚠️ Browser storage expired, loading from server');
          localStorage.removeItem('stremirow-config');
          const c = await fetch(`/api/config${getUserParam()}`).then((r) => r.json());
          config = c;
        }
      } catch (e) {
        console.error('Failed to parse saved config:', e);
        const c = await fetch(`/api/config${getUserParam()}`).then((r) => r.json());
        config = c;
      }
    } else {
      const c = await fetch(`/api/config${getUserParam()}`).then((r) => r.json());
      config = c;
    }

    if (config._orphanCustomChannels) {
      window._orphanCustomChannels = config._orphanCustomChannels;
    } else {
      window._orphanCustomChannels = [];
    }

    renderRows();
    renderCustomChannelsPanel();
    renderInstallTab();

    toast('Connected to Stremio!', 'success');
  } catch (e) {
    err.textContent = e.message;
    err.style.display = 'block';
    btn.textContent = 'Connect';
    btn.disabled = false;
  }
}

async function sidebarLogout() {
  await fetch(`/api/stremio/logout${getUserParam()}`, { method: 'POST' });
  await initSidebarAuth();
  renderLoggedOutState();
  toast('Disconnected', 'success');
}

function confirmLogout() {
  if (confirm('Are you sure you want to logout?')) {
    sidebarLogout();
  }
}

async function syncStremio() {
  try {
    // Cancel any pending debounced save and flush immediately
    if (typeof _saveTimer !== 'undefined') clearTimeout(_saveTimer);
    await saveAll();
    const r = await fetch(`/api/stremio/sync${getUserParam()}`, { method: 'POST' });
    const d = await r.json();
    if (d.error) throw new Error(d.error);
    toast('Synced to Stremio!', 'success');
  } catch (e) {
    toast('Sync failed: ' + e.message, 'error');
  }
}

function installStremio() {
  const manifestUrl = userId
    ? `${location.origin}/${userId}/manifest.json`
    : `${location.origin}/manifest.json`;
  if (location.protocol === 'http:') {
    prompt(
      'Local Addons must be pasted into Stremio manually.\n\nCopy this link and paste it into the Stremio search bar to update your rows:',
      manifestUrl
    );
  } else {
    window.location.href = manifestUrl.replace('https:', 'stremio:');
  }
}

function renderInstallTab() {
  const manifestUrl = userId
    ? `${location.origin}/${userId}/manifest.json`
    : `${location.origin}/manifest.json`;
  document.getElementById('set-install-url').value = manifestUrl;
  document.getElementById('miptv-install-url').value = location.origin + '/miptv-combined/manifest.json';
}

function copyInstallUrl() {
  const el = document.getElementById('set-install-url');
  el.select();
  document.execCommand('copy');
  toast('URL copied to clipboard!', 'success');
}

function copyMiptv_Url() {
  const el = document.getElementById('miptv-install-url');
  el.select();
  document.execCommand('copy');
  toast('MIPTV URL copied!', 'success');
}

function installMiptv() {
  const manifestUrl = location.origin + '/miptv-combined/manifest.json';
  if (location.protocol === 'http:') {
    prompt(
      'Local Addons must be pasted into Stremio manually.\n\nCopy this link and paste it into the Stremio search bar:',
      manifestUrl
    );
    return;
  }
  window.location.href = manifestUrl.replace('https:', 'stremio:');
}
