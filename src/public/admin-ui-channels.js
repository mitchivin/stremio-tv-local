/* exported getAllCustomChannels, renderCustomChannelsPanel, confirmDeleteChannel, deleteAllCustomChannels, newCustomChannel, closeCCModal, ccStartEditTitle, ccConfirmEditTitle, ccCancelEditTitle, saveCustomChannel, openLogoPicker, closeLogoPicker, lpApplyLogo, lpFilterLogos, lpSetMode, lpSelectLogo, openScanModal, closeScanModal, toggleScanSelectAll, addSelectedScanChannels, filterScanGrid */
// ─── Custom Channels Panel
function getAllCustomChannels() {
  const channels = [];
  const seen = new Set();

  // Only look in the dedicated custom-channels row
  const ccRow = config.rows.find((r) => r.id === 'custom-channels');
  if (ccRow) {
    for (const item of ccRow.items || []) {
      if (item.id && item.id.startsWith('stremirow-') && !seen.has(item.id)) {
        seen.add(item.id);
        channels.push(item);
      }
    }
  }

  // Include orphan custom channels (not yet added to any row)
  if (window._orphanCustomChannels) {
    for (const item of window._orphanCustomChannels) {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        channels.push(item);
      }
    }
  }

  return channels;
}

function renderCustomChannelsPanel() {
  const el = document.getElementById('channels-container');
  if (!el) return;
  const channels = getAllCustomChannels();
  if (!channels.length) {
    el.innerHTML =
      '<div class="empty-state"><div class="empty-icon"><span class="material-icons">live_tv</span></div><div class="empty-title">No multi-source channels yet</div><div class="empty-text">Create TV channels with automatic source fallback</div></div>';
    return;
  }
  el.innerHTML = `<div class="channels-grid">${channels
    .map((ch) => {
      const safeId = ch.id.replace(/[^a-z0-9-]/gi, '-');
      const srcCount = (ch.sources || []).length;
      const mode = ch._logoMode || 'fit';
      return `
      <div class="channel-card" id="cc-card-${safeId}" data-id="${esc(ch.id)}">
        <div class="channel-logo-container" id="cc-logo-wrap-${safeId}">
          ${ch.thumbnail ? `<img class="channel-logo" src="${esc(ch.thumbnail)}" style="object-fit:${mode === 'fill' ? 'cover' : 'contain'};" />` : '<span><span class="material-icons" style="font-size:48px;color:var(--color-text-disabled);">live_tv</span></span>'}
        </div>
        <div class="channel-info">
          <div class="channel-name">${esc(ch.title)}</div>
        </div>
        <div class="channel-hover-buttons">
          <button class="channel-hover-btn" onclick="event.stopPropagation(); openCustomChannelModalById('${esc(ch.id)}')">Edit (${srcCount})</button>
          <button class="channel-hover-btn delete" onclick="event.stopPropagation(); confirmDeleteChannel(this, '${esc(ch.id)}')">Delete</button>
        </div>
      </div>`;
    })
    .join('')}</div>`;
}

function deleteCustomChannel(id) {
  for (const row of config.rows) {
    row.items = (row.items || []).filter((i) => i.id !== id);
  }

  if (window._orphanCustomChannels) {
    window._orphanCustomChannels = window._orphanCustomChannels.filter((i) => i.id !== id);
  }

  markDirty();
  renderCustomChannelsPanel();
  if (document.getElementById('tv-grid')) applyTVFilter();
  toast('Channel deleted', 'success');
}

function confirmDeleteChannel(btn, id) {
  if (btn.classList.contains('confirm')) {
    deleteCustomChannel(id);
  } else {
    btn.classList.add('confirm');
    btn.textContent = 'Sure?';
    setTimeout(() => {
      btn.classList.remove('confirm');
      btn.textContent = 'Delete';
    }, 3000);
  }
}

function deleteAllCustomChannels() {
  const count = getAllCustomChannels().length;
  if (!count) {
    toast('No multi-source channels to delete', 'success');
    return;
  }
  if (
    !confirm(
      `Delete all ${count} multi-source channel${count !== 1 ? 's' : ''}? This cannot be undone.`
    )
  )
    return;

  for (const row of config.rows) {
    row.items = (row.items || []).filter((i) => !i.id?.startsWith('stremirow-'));
  }

  window._orphanCustomChannels = [];

  markDirty();
  renderRows();
  renderCustomChannelsPanel();
  if (document.getElementById('tv-grid')) applyTVFilter();
  toast('All multi-source channels deleted', 'success');
}

function newCustomChannel() {
  const id = 'stremirow-new-' + Date.now();
  const item = {
    id,
    type: 'tv',
    title: 'New Channel',
    thumbnail: '',
    description: '',
    sources: [],
  };

  // Find or create the "Custom Channels" row
  let ccRow = config.rows.find((r) => r.id === 'custom-channels');
  if (!ccRow) {
    ccRow = { id: 'custom-channels', name: 'Custom Channels', contentType: 'tv', items: [] };
    config.rows.push(ccRow);
  }
  ccRow.items.push(item);

  renderCustomChannelsPanel();
  renderRows();
  ccIsNew = true;
  openCustomChannelModalById(id);
}

async function openCustomChannelModalById(id) {
  let item = config.rows.flatMap((r) => r.items || []).find((i) => i.id === id);

  if (!item && window._orphanCustomChannels) {
    item = window._orphanCustomChannels.find((i) => i.id === id);
  }

  if (!item) {
    console.error('Custom channel not found:', id);
    toast('Channel not found. Try refreshing the page.', 'error');
    return;
  }

  await openCustomChannelModal(item);
}

function closeCCModal() {
  if (ccIsNew && ccEditingId) {
    for (const row of config.rows) {
      row.items = (row.items || []).filter((i) => i.id !== ccEditingId);
    }

    if (window._orphanCustomChannels) {
      window._orphanCustomChannels = window._orphanCustomChannels.filter(
        (i) => i.id !== ccEditingId
      );
    }

    renderCustomChannelsPanel();
    renderRows();
  }
  ccIsNew = false;
  closeModal('custom-channel-modal');
}

async function openCustomChannelModal(existingItem) {
  if (!existingItem) return;
  ccSources = JSON.parse(JSON.stringify(existingItem.sources || []));
  ccEditingId = existingItem.id;
  ccAllChannels = [];

  const titleDisplay = document.getElementById('cc-modal-title-display');
  const titleInput = document.getElementById('cc-modal-title-input');
  if (titleDisplay)
    titleDisplay.innerHTML = `${esc(existingItem.title || 'New Channel')}<span class="material-icons" style="font-size: 20px; opacity: 0.7;">edit</span>`;
  if (titleInput) titleInput.value = existingItem.title || '';

  const confirmBtn = document.getElementById('cc-title-confirm-btn');
  if (titleDisplay) titleDisplay.style.display = '';
  if (titleInput) titleInput.style.display = 'none';
  if (confirmBtn) confirmBtn.style.display = 'none';

  renderCCSources();
  document.getElementById('cc-search').value = '';
  openModal('custom-channel-modal');

  if (!tvAddons.length) {
    setCCStatus('Loading addons…');
    try {
      const d = await fetch(`/api/stremio/addons${getUserParam()}`).then((r) => r.json());
      tvAddons = (d.addons || []).filter(isTvAddon);
    } catch (e) {
      tvAddons = [];
    }
  }

  const sel = document.getElementById('cc-addon-select');
  sel.innerHTML = '<option value="">All Addons</option>';
  tvAddons.forEach((a, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = a.manifest.name;
    sel.appendChild(opt);
  });

  const genreSel = document.getElementById('cc-genre-select');
  if (genreSel) {
    genreSel.innerHTML = '<option value="">All Genres</option>';
    genreSel.disabled = true;
  }

  await loadAllCCChannels();
}

function ccStartEditTitle() {
  const display = document.getElementById('cc-modal-title-display');
  const input = document.getElementById('cc-modal-title-input');
  const confirmBtn = document.getElementById('cc-title-confirm-btn');

  if (display && input && confirmBtn) {
    display.style.display = 'none';
    input.style.display = '';
    confirmBtn.style.display = '';
    input.focus();
    input.select();
  }
}

function ccConfirmEditTitle() {
  const display = document.getElementById('cc-modal-title-display');
  const input = document.getElementById('cc-modal-title-input');
  const confirmBtn = document.getElementById('cc-title-confirm-btn');

  if (display && input && confirmBtn) {
    const newTitle = input.value.trim();
    if (newTitle) {
      input.value = newTitle;
      display.innerHTML = `${esc(newTitle)}<span class="material-icons" style="font-size: 20px; opacity: 0.7;">edit</span>`;
    }
    display.style.display = '';
    input.style.display = 'none';
    confirmBtn.style.display = 'none';
  }
}

function ccCancelEditTitle() {
  const display = document.getElementById('cc-modal-title-display');
  const input = document.getElementById('cc-modal-title-input');
  const confirmBtn = document.getElementById('cc-title-confirm-btn');

  if (display && input && confirmBtn) {
    display.style.display = '';
    input.style.display = 'none';
    confirmBtn.style.display = 'none';
  }
}

function saveCustomChannel() {
  if (!ccEditingId) return;
  if (!ccSources.length) {
    toast('Add at least one source', 'error');
    return;
  }

  let item = null;

  for (const row of config.rows) {
    item = (row.items || []).find((i) => i.id === ccEditingId);
    if (item) break;
  }

  if (!item && window._orphanCustomChannels) {
    item = window._orphanCustomChannels.find((i) => i.id === ccEditingId);
  }

  if (!item) {
    toast('Channel not found', 'error');
    return;
  }

  const titleInput = document.getElementById('cc-modal-title-input');
  const newTitle = titleInput ? titleInput.value.trim() : item.title;

  // Use primary source name if title is still "New Channel"
  if (!newTitle || newTitle === 'New Channel') {
    item.title = ccSources[0]?.channelName || 'New Channel';
  } else {
    item.title = newTitle;
  }

  item.sources = JSON.parse(JSON.stringify(ccSources));

  // Use first source logo as thumbnail if none set
  if (!item.thumbnail && ccSources[0]?.channelLogo) {
    item.thumbnail = ccSources[0].channelLogo;
  }

  markDirty();
  renderRows();
  renderCustomChannelsPanel();

  if (document.getElementById('builder-modal').classList.contains('open')) {
    const allItems = [
      ...config.rows.flatMap((r) => r.items || []),
      ...(window._orphanCustomChannels || []),
    ];
    const savedItem = allItems.find((i) => i.id === ccEditingId);
    if (savedItem) {
      const idx = tempRowItems.findIndex((i) => i.id === ccEditingId);
      if (idx >= 0) tempRowItems[idx] = savedItem;
      else tempRowItems.push(savedItem);
      renderRowItems();
      applyTVFilter();
    }
  }

  ccIsNew = false;
  closeModal('custom-channel-modal');
  toast('Sources saved', 'success');
}

// ─── Logo Picker (tv-logo GitHub repo)
const LP_RAW_BASE = 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/';
const LP_TREE_URL = 'https://api.github.com/repos/tv-logo/tv-logos/git/trees/main?recursive=1';
let _lpTreeCache = null;
let _lpLoadingTree = false;
let _lpMode = 'fit';
let _lpSelectedUrl = null;

window.logoPickerTargetId = null;

async function _lpLoadTree() {
  if (_lpTreeCache) return _lpTreeCache;
  if (_lpLoadingTree) return null;
  _lpLoadingTree = true;
  try {
    const res = await fetch(LP_TREE_URL);
    const data = await res.json();
    _lpTreeCache = (data.tree || [])
      .filter((f) => f.type === 'blob' && f.path.endsWith('.png'))
      .map((f) => ({ path: f.path, url: LP_RAW_BASE + f.path }));
  } catch (e) {
    console.warn('Failed to load tv-logos tree:', e);
    _lpTreeCache = [];
  }
  _lpLoadingTree = false;
  return _lpTreeCache;
}

function _lpRenderGrid(logos) {
  const grid = document.getElementById('logo-picker-grid');
  if (!grid) return;
  if (!logos || !logos.length) {
    grid.innerHTML =
      '<div style="grid-column:1/-1;text-align:center;padding:var(--space-6);color:var(--color-text-secondary);">No logos found. Try a different search.</div>';
    return;
  }
  grid.innerHTML = logos
    .slice(0, 120)
    .map(
      (logo) =>
        `<div class="logo-picker-item${_lpSelectedUrl === logo.url ? ' selected' : ''}" title="${esc(logo.path)}" onclick="lpSelectLogo('${esc(logo.url)}', this)">
      <img src="${esc(logo.url)}" alt="${esc(logo.path)}" loading="lazy" style="object-fit:${_lpMode === 'fill' ? 'cover' : 'contain'}" onerror="this.parentElement.style.display='none'" />
    </div>`
    )
    .join('');
}

function lpFilterLogos() {
  if (!_lpTreeCache) return;
  const q = (document.getElementById('lp-search')?.value || '').toLowerCase().replace(/\s+/g, '-');
  const filtered = q
    ? _lpTreeCache.filter((l) => l.path.toLowerCase().includes(q))
    : _lpTreeCache.slice(0, 120);
  _lpRenderGrid(filtered);
}

function lpSetMode(mode) {
  _lpMode = mode;
  document.getElementById('lp-mode-fit')?.classList.toggle('active', mode === 'fit');
  document.getElementById('lp-mode-fill')?.classList.toggle('active', mode === 'fill');
  // Apply object-fit to all grid images in real-time so the user sees the effect
  document
    .querySelectorAll('#logo-picker-grid .logo-picker-item img')
    .forEach((img) => (img.style.objectFit = mode === 'fill' ? 'cover' : 'contain'));
}

function lpSelectLogo(url, el) {
  _lpSelectedUrl = url;
  document.querySelectorAll('.logo-picker-item').forEach((i) => i.classList.remove('selected'));
  el.classList.add('selected');
  document.getElementById('lp-apply-btn').disabled = false;
}

async function openLogoPicker(channelId, event) {
  event.stopPropagation();
  window.logoPickerTargetId = channelId;
  _lpSelectedUrl = null;
  _lpMode = 'fit';

  const grid = document.getElementById('logo-picker-grid');
  const searchEl = document.getElementById('lp-search');
  const applyBtn = document.getElementById('lp-apply-btn');
  if (searchEl) searchEl.value = '';
  if (applyBtn) applyBtn.disabled = true;
  document.getElementById('lp-mode-fit')?.classList.add('active');
  document.getElementById('lp-mode-fill')?.classList.remove('active');
  if (grid)
    grid.innerHTML =
      '<div style="grid-column:1/-1;text-align:center;padding:var(--space-6);color:var(--color-text-secondary);">Loading logos…</div>';

  document.getElementById('logo-picker-modal').classList.add('open');

  const tree = await _lpLoadTree();
  if (!tree) return;

  const allItems = [
    ...(typeof tempRowItems !== 'undefined' ? tempRowItems : []),
    ...config.rows.flatMap((r) => r.items || []),
    ...(window._orphanCustomChannels || []),
  ];
  const ch = allItems.find((i) => i.id === channelId);
  let hint = '';
  if (ch && ch.title) {
    hint = ch.title.toLowerCase().replace(/\s+/g, '-');
    if (searchEl) searchEl.value = ch.title;
  }

  const filtered = hint
    ? _lpTreeCache.filter((l) => l.path.toLowerCase().includes(hint))
    : _lpTreeCache.slice(0, 120);
  _lpRenderGrid(filtered);
}

async function lpApplyLogo() {
  if (!window.logoPickerTargetId || !_lpSelectedUrl) return;

  // Proxy URL — server fetches + applies fit/fill, returns a stable hosted PNG
  const proxyUrl = `/api/logos/proxy?mode=${_lpMode}&url=` + encodeURIComponent(_lpSelectedUrl);

  const builderOpen = document.getElementById('builder-modal')?.classList.contains('open');

  // Update tempRowItems if builder is open
  if (builderOpen && typeof tempRowItems !== 'undefined') {
    const item = tempRowItems.find((i) => i.id === window.logoPickerTargetId);
    if (item) {
      item.thumbnail = proxyUrl;
      item._rawLogo = _lpSelectedUrl;
      item._logoMode = _lpMode;
    }
  }

  // Always update config.rows and orphans so main cards stay in sync
  for (const row of config.rows) {
    const item = (row.items || []).find((i) => i.id === window.logoPickerTargetId);
    if (item) {
      item.thumbnail = proxyUrl;
      item._rawLogo = _lpSelectedUrl;
      item._logoMode = _lpMode;
      break;
    }
  }
  if (window._orphanCustomChannels) {
    const item = window._orphanCustomChannels.find((i) => i.id === window.logoPickerTargetId);
    if (item) {
      item.thumbnail = proxyUrl;
      item._rawLogo = _lpSelectedUrl;
      item._logoMode = _lpMode;
    }
  }

  markDirty();
  if (builderOpen) renderRowItems();
  renderRows();
  renderCustomChannelsPanel();
  toast('Logo updated', 'success');

  closeLogoPicker();
}

function closeLogoPicker() {
  document.getElementById('logo-picker-modal').classList.remove('open');
  window.logoPickerTargetId = null;
  _lpSelectedUrl = null;
}

// ─── Scan Modal
/* globals ccDetectedMatches, normaliseName */
let _scanSelected = new Set();

async function openScanModal() {
  _scanSelected = new Set();
  openModal('scan-modal');
  _renderScanGrid();

  // Load addons + channels if not already loaded
  if (!tvAddons.length) {
    document.getElementById('scan-load-status').textContent = 'Loading addons…';
    document.getElementById('scan-load-status').style.display = '';
    try {
      const d = await fetch(`/api/stremio/addons${getUserParam()}`).then((r) => r.json());
      tvAddons = (d.addons || []).filter(isTvAddon);
    } catch (e) {
      tvAddons = [];
    }
  }

  if (!ccAllChannels.length) {
    document.getElementById('scan-load-status').textContent = `Loading channels…`;
    document.getElementById('scan-load-status').style.display = '';
    await loadAllCCChannels();
  }

  document.getElementById('scan-load-status').style.display = 'none';
  _renderScanGrid();
}

function closeScanModal() {
  closeModal('scan-modal');
  _scanSelected = new Set();
}

function filterScanGrid() {
  _renderScanGrid();
}

function _renderScanGrid() {
  const grid = document.getElementById('scan-grid');
  const countEl = document.getElementById('scan-selected-count');
  const addBtn = document.getElementById('scan-add-btn');
  if (!grid) return;

  const q = (document.getElementById('scan-search')?.value || '').toLowerCase();
  const suggestions = (ccDetectedMatches || []).filter(
    (s) => !q || s.displayName.toLowerCase().includes(q)
  );
  const existingIds = new Set(getAllCustomChannels().map((ch) => normaliseName(ch.title)));

  if (!suggestions.length) {
    grid.innerHTML =
      '<div class="empty"><div class="empty-icon"><span class="material-icons" style="font-size:48px;color:var(--color-text-disabled);">radar</span></div><div class="empty-text">No multi-source channels detected yet. Open a row builder with TV channels first.</div></div>';
    if (countEl) countEl.textContent = '0';
    if (addBtn) addBtn.disabled = true;
    return;
  }

  grid.innerHTML = `<div class="poster-grid">${suggestions
    .map((sug, i) => {
      const alreadyAdded = existingIds.has(sug.normalizedName);
      const selected = _scanSelected.has(i);
      const thumb = sug.logo
        ? `<img class="poster-image" src="${esc(sug.logo)}" loading="lazy" onerror="this.outerHTML='<div class=\\'poster-image\\' style=\\'display:flex;align-items:center;justify-content:center;\\'><span class=\\'material-icons\\' style=\\'font-size:32px;color:var(--color-text-disabled);\\'>live_tv</span></div>'">`
        : '<div class="poster-image" style="display:flex;align-items:center;justify-content:center;"><span class="material-icons" style="font-size:32px;color:var(--color-text-disabled);">live_tv</span></div>';
      return `<div class="poster-card tv suggested${selected ? ' active' : ''}${alreadyAdded ? ' scan-added' : ''}" data-scan-idx="${i}" onclick="toggleScanItem(${i})">
        ${thumb}
        <div class="poster-info">
          <div class="poster-title">${esc(sug.displayName)}</div>
          <div class="poster-meta">${alreadyAdded ? 'Added' : `${sug.sourceCount} sources`}</div>
        </div>
      </div>`;
    })
    .join('')}</div>`;

  if (countEl) countEl.textContent = _scanSelected.size;
  if (addBtn) addBtn.disabled = _scanSelected.size === 0;
}

function toggleScanItem(idx) {
  if (_scanSelected.has(idx)) {
    _scanSelected.delete(idx);
  } else {
    _scanSelected.add(idx);
  }
  _renderScanGrid();
}

function toggleScanSelectAll() {
  const suggestions = ccDetectedMatches || [];
  if (_scanSelected.size === suggestions.length) {
    _scanSelected = new Set();
  } else {
    _scanSelected = new Set(suggestions.map((_, i) => i));
  }
  _renderScanGrid();
  const btn = document.getElementById('scan-select-all-btn');
  if (btn)
    btn.textContent = _scanSelected.size === suggestions.length ? 'Deselect All' : 'Select All';
}

function addSelectedScanChannels() {
  if (!_scanSelected.size) return;
  const suggestions = ccDetectedMatches || [];

  let ccRow = config.rows.find((r) => r.id === 'custom-channels');
  if (!ccRow) {
    ccRow = { id: 'custom-channels', name: 'Custom Channels', contentType: 'tv', items: [] };
    config.rows.push(ccRow);
  }

  let addedCount = 0;
  for (const idx of _scanSelected) {
    const sug = suggestions[idx];
    if (!sug) continue;
    const id =
      'stremirow-' +
      slugify(sug.displayName) +
      '-' +
      Date.now() +
      '-' +
      Math.random().toString(36).substring(2, 11);
    ccRow.items.push({
      id,
      type: 'tv',
      title: sug.displayName,
      thumbnail: sug.logo || '',
      description: '',
      sources: sug.sources.map((src) => ({
        addonName: src.addonName,
        addonUrl: src.addonUrl,
        channelId: src.channelId,
        channelName: src.channelName,
        channelLogo: src.channelLogo,
      })),
    });
    addedCount++;
  }

  markDirty();
  renderCustomChannelsPanel();
  renderRows();
  closeScanModal();
  toast(`Added ${addedCount} channel${addedCount !== 1 ? 's' : ''}`, 'success');
}
