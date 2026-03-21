'use strict';

// ─── Stremio Auth & Sync

let sidebarAuthStatus = null;

async function initSidebarAuth() {
  sidebarAuthStatus = await fetch('/api/stremio/status').then(r => r.json()).catch(() => null);
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
  if (!email || !password) { err.textContent = 'Email and password required'; err.style.display = 'block'; return; }
  err.style.display = 'none'; btn.innerHTML = '<span class="material-icons" style="font-size:14px;margin-right:4px;">hourglass_empty</span>Connecting…'; btn.disabled = true;
  try {
    const d = await fetch('/api/stremio/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) }).then(r => r.json());
    if (d.error) throw new Error(d.error);
    closeModal('stremio-login-modal');
    document.getElementById('sl-email').value = '';
    document.getElementById('sl-pass').value = '';
    await initSidebarAuth();
    toast('Connected to Stremio!', 'success');
  } catch (e) { err.textContent = e.message; err.style.display = 'block'; btn.textContent = 'Connect'; btn.disabled = false; }
}

async function sidebarLogout() {
  await fetch('/api/stremio/logout', { method: 'POST' });
  await initSidebarAuth();
  toast('Disconnected', 'success');
}

function confirmLogout() {
  if (confirm('Are you sure you want to logout?')) {
    sidebarLogout();
  }
}

async function syncStremio() {
  const btn = document.getElementById('floating-sync-btn');
  const textEl = document.getElementById('sync-btn-text');
  if (btn) { btn.disabled = true; btn.className = 'floating-action-btn btn-primary syncing'; }
  if (textEl) textEl.textContent = 'Syncing…';
  try {
    await saveAll();
    const r = await fetch('/api/stremio/sync', { method: 'POST' });
    const d = await r.json();
    if (d.error) throw new Error(d.error);
    if (btn) btn.className = 'floating-action-btn btn-primary success';
    if (textEl) textEl.textContent = 'Synced!';
    setTimeout(() => {
      if (btn) btn.className = 'floating-action-btn btn-primary';
      if (textEl) textEl.textContent = 'Sync';
    }, 3000);
  } catch (e) {
    if (btn) btn.className = 'floating-action-btn btn-primary error';
    if (textEl) textEl.textContent = 'Failed';
    setTimeout(() => {
      if (btn) btn.className = 'floating-action-btn btn-primary';
      if (textEl) textEl.textContent = 'Sync';
    }, 4000);
  } finally {
    if (btn) btn.disabled = false;
  }
}

function installStremio() {
  const manifestUrl = location.origin + '/manifest.json';
  if (location.protocol === 'http:') {
    prompt('Local Addons must be pasted into Stremio manually.\n\nCopy this link and paste it into the Stremio search bar to update your rows:', manifestUrl);
  } else {
    window.location.href = manifestUrl.replace('https:', 'stremio:');
  }
}

function renderInstallTab() {
  document.getElementById('set-install-url').value = location.origin + '/manifest.json';
  document.getElementById('a1x-install-url').value = location.origin + '/a1x/manifest.json';
}

function copyInstallUrl() {
  const el = document.getElementById('set-install-url');
  el.select();
  document.execCommand('copy');
  toast('URL copied to clipboard!', 'success');
}

function copyA1xUrl() {
  const el = document.getElementById('a1x-install-url');
  el.select();
  document.execCommand('copy');
  toast('A1X URL copied!', 'success');
}

function installA1x() {
  const manifestUrl = location.origin + '/a1x/manifest.json';
  if (location.protocol === 'http:') {
    prompt('Local Addons must be pasted into Stremio manually.\n\nCopy this link and paste it into the Stremio search bar:', manifestUrl);
    return;
  }
  window.location.href = manifestUrl.replace('https:', 'stremio:');
}
