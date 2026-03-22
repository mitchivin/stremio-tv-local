/* exported getAllCustomChannels, renderCustomChannelsPanel, confirmDeleteChannel, deleteAllCustomChannels, newCustomChannel, closeCCModal, ccStartEditTitle, ccConfirmEditTitle, ccCancelEditTitle, saveCustomChannel, openLogoPicker, closeLogoPicker, selectLogo, lpSetMode, lpTriggerUpload, lpHandleUpload, lpApplyLogo, lpSelectGridLogo, openScanModal, closeScanModal, toggleScanSelectAll, addSelectedScanChannels, filterScanGrid */
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

/**
 * Process logo image with specified mode (fit/fill) and transparent background
 * @param {Image} img - The image element to process
 * @param {string} mode - Either 'fit' (with padding) or 'fill' (cover)
 * @returns {string} Base64 PNG data URL
 */
function processLogoWithMode(img, mode) {
  const SIZE = 400;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, SIZE, SIZE);

  if (mode === 'fill') {
    const scale = Math.max(SIZE / img.width, SIZE / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    ctx.drawImage(img, (SIZE - w) / 2, (SIZE - h) / 2, w, h);
  } else {
    const PADDING = 40;
    const maxDim = SIZE - PADDING * 2;
    const scale = Math.min(maxDim / img.width, maxDim / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    ctx.drawImage(img, (SIZE - w) / 2, (SIZE - h) / 2, w, h);
  }

  return canvas.toDataURL('image/png');
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

// ─── Logo Picker
let logoPickerCache = null;
window.logoPickerTargetId = null;
let _lpSelectedFilename = null; // currently highlighted logo in picker
let _lpMode = 'fit'; // current mode in picker
let _lpRawDataUrl = null; // raw data url for upload or selected logo

async function loadLogoPickerCache() {
  if (logoPickerCache !== null) return logoPickerCache;
  try {
    const response = await fetch('/api/logos/list');
    const data = await response.json();
    logoPickerCache = data.logos || [];
  } catch (e) {
    console.warn('Failed to load logo picker cache:', e);
    logoPickerCache = [];
    toast('Failed to load logos', 'error');
  }
  return logoPickerCache;
}

function _lpSetPreview(src) {
  const img = document.getElementById('lp-preview-img');
  const ph = document.getElementById('lp-preview-placeholder');
  if (!src) {
    if (img) {
      img.src = '';
      img.style.display = 'none';
    }
    if (ph) ph.style.display = '';
    return;
  }
  if (img) {
    img.src = src;
    img.style.display = '';
  }
  if (ph) ph.style.display = 'none';
}

function _lpSetApplyEnabled(enabled) {
  const btn = document.getElementById('lp-apply-btn');
  if (btn) btn.disabled = !enabled;
}

function lpSetMode(mode) {
  _lpMode = mode;
  document.getElementById('lp-mode-fit')?.classList.toggle('active', mode === 'fit');
  document.getElementById('lp-mode-fill')?.classList.toggle('active', mode === 'fill');
  // Re-process if we have a raw data url
  if (_lpRawDataUrl) {
    const img = new Image();
    img.onload = function () {
      const processed = processLogoWithMode(img, mode);
      _lpSetPreview(processed);
    };
    img.src = _lpRawDataUrl;
  }
}

function lpTriggerUpload() {
  document.getElementById('lp-upload-input')?.click();
}

function lpHandleUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function (e) {
    _lpRawDataUrl = e.target.result;
    _lpSelectedFilename = null;
    // Deselect any grid item
    document.querySelectorAll('.logo-picker-item').forEach((el) => el.classList.remove('selected'));
    const img = new Image();
    img.onload = function () {
      const processed = processLogoWithMode(img, _lpMode);
      _lpSetPreview(processed);
      _lpSetApplyEnabled(true);
    };
    img.src = _lpRawDataUrl;
  };
  reader.readAsDataURL(file);
  // Reset input so same file can be re-selected
  event.target.value = '';
}

async function openLogoPicker(channelId, event) {
  event.stopPropagation();
  window.logoPickerTargetId = channelId;
  _lpSelectedFilename = null;
  _lpRawDataUrl = null;
  _lpMode = 'fit';

  // Reset mode buttons
  document.getElementById('lp-mode-fit')?.classList.add('active');
  document.getElementById('lp-mode-fill')?.classList.remove('active');
  _lpSetApplyEnabled(false);

  // Populate preview with current channel logo
  let currentThumb = null;
  const builderOpen = document.getElementById('builder-modal')?.classList.contains('open');
  if (builderOpen && typeof tempRowItems !== 'undefined') {
    const ch = tempRowItems.find((i) => i.id === channelId);
    if (ch) currentThumb = ch.thumbnail || null;
  }
  if (!currentThumb) {
    for (const row of config.rows) {
      const ch = (row.items || []).find((i) => i.id === channelId);
      if (ch) {
        currentThumb = ch.thumbnail || null;
        break;
      }
    }
  }
  if (!currentThumb && window._orphanCustomChannels) {
    const ch = window._orphanCustomChannels.find((i) => i.id === channelId);
    if (ch) currentThumb = ch.thumbnail || null;
  }
  _lpSetPreview(currentThumb);

  await loadLogoPickerCache();

  const grid = document.getElementById('logo-picker-grid');
  if (!logoPickerCache.length) {
    grid.innerHTML =
      '<div style="grid-column: 1/-1; text-align: center; padding: var(--space-6); color: var(--color-text-secondary);">No logos found in /logos/ folder</div>';
  } else {
    grid.innerHTML = logoPickerCache
      .map(
        (filename) =>
          `<div class="logo-picker-item" onclick="lpSelectGridLogo('${esc(filename)}', this)">
        <img src="/logos/${esc(filename)}" alt="${esc(filename)}" />
      </div>`
      )
      .join('');
  }

  document.getElementById('logo-picker-modal').classList.add('open');
}

function lpSelectGridLogo(filename, el) {
  _lpSelectedFilename = filename;
  _lpRawDataUrl = `/logos/${filename}`;
  // Highlight selected
  document
    .querySelectorAll('.logo-picker-item')
    .forEach((item) => item.classList.remove('selected'));
  el.classList.add('selected');
  // Process through current mode so preview always matches
  const img = new Image();
  img.onload = function () {
    _lpSetPreview(processLogoWithMode(img, _lpMode));
    _lpSetApplyEnabled(true);
  };
  img.src = _lpRawDataUrl;
}

function closeLogoPicker() {
  document.getElementById('logo-picker-modal').classList.remove('open');
  window.logoPickerTargetId = null;
  _lpSelectedFilename = null;
  _lpRawDataUrl = null;
}

async function lpApplyLogo() {
  if (!window.logoPickerTargetId || !_lpRawDataUrl) return;

  // Preview is already processed through processLogoWithMode — grab it directly
  const previewImg = document.getElementById('lp-preview-img');
  const finalUrl = previewImg?.src || _lpRawDataUrl;

  await selectLogo(finalUrl, _lpSelectedFilename);
}

async function selectLogo(finalUrl, filename) {
  if (!window.logoPickerTargetId) return;

  let channel = null;
  const builderOpen = document.getElementById('builder-modal')?.classList.contains('open');

  if (builderOpen && typeof tempRowItems !== 'undefined') {
    channel = tempRowItems.find((i) => i.id === window.logoPickerTargetId);
  }

  if (!channel) {
    for (const row of config.rows) {
      channel = (row.items || []).find((i) => i.id === window.logoPickerTargetId);
      if (channel) break;
    }
  }

  if (!channel && window._orphanCustomChannels) {
    channel = window._orphanCustomChannels.find((i) => i.id === window.logoPickerTargetId);
  }

  if (channel) {
    channel._rawLogo = filename ? `/logos/${filename}` : finalUrl;
    channel._logoMode = _lpMode;
    channel.thumbnail = finalUrl;

    markDirty();
    if (builderOpen) {
      renderRowItems();
    } else {
      renderCustomChannelsPanel();
    }
    toast('Logo updated', 'success');
  }

  closeLogoPicker();
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
