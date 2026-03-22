/* exported getAllCustomChannels, renderCustomChannelsPanel, confirmDeleteChannel, deleteAllCustomChannels, newCustomChannel, closeCCModal, ccStartEditTitle, ccConfirmEditTitle, ccCancelEditTitle, ccSetLogoMode, saveCustomChannel, openLogoPicker, closeLogoPicker, selectLogo */
// ─── Custom Channels Panel
function getAllCustomChannels() {
  const channels = [];
  const seen = new Set();

  // Get custom channels from all rows
  for (const row of config.rows) {
    for (const item of row.items || []) {
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
      '<div class="empty-state"><div class="empty-icon"><span class="material-icons">live_tv</span></div><div class="empty-title">No custom channels yet</div><div class="empty-text">Create multi-source TV channels with automatic fallback</div></div>';
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
          <button class="channel-hover-btn" onclick="event.stopPropagation(); openLogoPicker('${esc(ch.id)}', event)">Choose Logo</button>
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
    toast('No custom channels to delete', 'success');
    return;
  }
  if (
    !confirm(`Delete all ${count} custom channel${count !== 1 ? 's' : ''}? This cannot be undone.`)
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
  toast('All custom channels deleted', 'success');
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
  if (!ccIsNew) ccIsNew = false;
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

  const logoValue = document.getElementById('cc-modal-logo-value');
  const rawLogoValue = document.getElementById('cc-modal-raw-logo');
  const modeValue = document.getElementById('cc-modal-mode-value');
  const logoPreview = document.getElementById('cc-modal-logo-preview');
  const logoPlaceholder = document.getElementById('cc-modal-logo-placeholder');

  const currentMode = existingItem._logoMode || 'fit';
  if (modeValue) modeValue.value = currentMode;

  const modeButtons = document.querySelectorAll('.mode-btn');
  modeButtons.forEach((btn) => {
    btn.classList.toggle('active', btn.classList.contains(currentMode));
  });

  if (existingItem.thumbnail) {
    if (logoValue) logoValue.value = existingItem.thumbnail;
    if (logoPreview) {
      logoPreview.src = existingItem.thumbnail;
      logoPreview.style.display = '';
    }
    if (logoPlaceholder) logoPlaceholder.style.display = 'none';
    // Enable mode buttons — user has a chosen logo
    document.querySelectorAll('.mode-btn').forEach((b) => b.classList.remove('mode-disabled'));
  } else {
    if (logoValue) logoValue.value = '';
    // Show source logo as preview if available, but mark mode buttons as disabled
    const sourceLogo = existingItem.sources?.[0]?.channelLogo || '';
    if (sourceLogo && logoPreview) {
      logoPreview.src = sourceLogo;
      logoPreview.style.display = '';
      if (logoPlaceholder) logoPlaceholder.style.display = 'none';
    } else {
      if (logoPreview) logoPreview.style.display = 'none';
      if (logoPlaceholder) logoPlaceholder.style.display = '';
    }
    document.querySelectorAll('.mode-btn').forEach((b) => b.classList.add('mode-disabled'));
  }
  if (rawLogoValue) rawLogoValue.value = existingItem._rawLogo || '';

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

function ccSetLogoMode(mode) {
  const modeInput = document.getElementById('cc-modal-mode-value');
  if (modeInput) modeInput.value = mode;
  const modeButtons = document.querySelectorAll('.mode-btn');
  modeButtons.forEach((btn) => {
    btn.classList.toggle('active', btn.classList.contains(mode));
  });

  const rawInput = document.getElementById('cc-modal-raw-logo');
  const raw = rawInput ? rawInput.value : '';
  if (raw) ccApplyLogoMode(raw, mode);
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

function ccApplyLogoMode(rawDataUrl, mode) {
  const img = new Image();
  img.onload = function () {
    const dataUrl = processLogoWithMode(img, mode);
    const logoInput = document.getElementById('cc-modal-logo-value');
    if (logoInput) logoInput.value = dataUrl;
    const preview = document.getElementById('cc-modal-logo-preview');
    if (preview) {
      preview.src = dataUrl;
      preview.style.display = '';
    }
    const placeholder = document.getElementById('cc-modal-logo-placeholder');
    if (placeholder) placeholder.style.display = 'none';
    document.querySelectorAll('.mode-btn').forEach((b) => b.classList.remove('mode-disabled'));
  };
  img.src = rawDataUrl;
}

function saveCustomChannel() {
  if (!ccEditingId) return;
  if (!ccSources.length) {
    toast('Add at least one source', 'error');
    return;
  }

  let item = null;
  let found = false;

  for (const row of config.rows) {
    item = (row.items || []).find((i) => i.id === ccEditingId);
    if (item) {
      found = true;
      break;
    }
  }

  if (!found && window._orphanCustomChannels) {
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

  const logoInput = document.getElementById('cc-modal-logo-value');
  const modeInput = document.getElementById('cc-modal-mode-value');
  const rawLogoInput = document.getElementById('cc-modal-raw-logo');

  if (logoInput && logoInput.value) {
    item.thumbnail = logoInput.value;
  } else if (!item.thumbnail && ccSources[0]?.channelLogo) {
    item.thumbnail = ccSources[0].channelLogo;
  }

  if (modeInput) {
    item._logoMode = modeInput.value;
  }

  if (rawLogoInput && rawLogoInput.value) {
    item._rawLogo = rawLogoInput.value;
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
let logoPickerTargetId = null;

/**
 * Load available logos from /logos/ directory
 * @returns {Promise<Array<string>>} Array of logo filenames
 */
async function loadLogoPickerCache() {
  if (logoPickerCache !== null) return logoPickerCache;

  try {
    const response = await fetch('/api/logos/list');
    const data = await response.json();
    logoPickerCache = data.logos || [];
    console.log(`📦 Loaded ${logoPickerCache.length} logos for picker`);
  } catch (e) {
    console.warn('Failed to load logo picker cache:', e);
    logoPickerCache = [];
    toast('Failed to load logos', 'error');
  }

  return logoPickerCache;
}

/**
 * Open logo picker modal for a specific channel
 * @param {string} channelId - The channel ID to apply logo to
 * @param {Event} event - Click event
 */
async function openLogoPicker(channelId, event) {
  event.stopPropagation();
  logoPickerTargetId = channelId;

  await loadLogoPickerCache();

  const modal = document.getElementById('logo-picker-modal');
  const grid = document.getElementById('logo-picker-grid');

  if (!logoPickerCache.length) {
    grid.innerHTML =
      '<div style="grid-column: 1/-1; text-align: center; padding: var(--space-6); color: var(--color-text-secondary);">No logos found in /logos/ folder</div>';
  } else {
    grid.innerHTML = logoPickerCache
      .map((filename) => {
        return `<div class="logo-picker-item" onclick="selectLogo('${esc(filename)}')">
        <img src="/logos/${esc(filename)}" alt="${esc(filename)}" />
      </div>`;
      })
      .join('');
  }

  modal.classList.add('open');
}

/**
 * Close logo picker modal
 */
function closeLogoPicker() {
  const modal = document.getElementById('logo-picker-modal');
  modal.classList.remove('open');
  logoPickerTargetId = null;
}

/**
 * Select a logo from the picker and apply it to the target channel
 * @param {string} filename - The logo filename to apply
 */
async function selectLogo(filename) {
  if (!logoPickerTargetId) return;

  // Find the channel — check tempRowItems first if builder modal is open
  let channel = null;
  const builderOpen = document.getElementById('builder-modal')?.classList.contains('open');

  if (builderOpen && typeof tempRowItems !== 'undefined') {
    channel = tempRowItems.find((i) => i.id === logoPickerTargetId);
  }

  if (!channel) {
    for (const row of config.rows) {
      channel = (row.items || []).find((i) => i.id === logoPickerTargetId);
      if (channel) break;
    }
  }

  if (!channel && window._orphanCustomChannels) {
    channel = window._orphanCustomChannels.find((i) => i.id === logoPickerTargetId);
  }

  if (channel) {
    // For local logos, skip canvas processing — just store the URL directly
    channel._rawLogo = `/logos/${filename}`;
    channel._logoMode = 'fit';
    channel.thumbnail = `/logos/${filename}`;

    markDirty();
    if (builderOpen) {
      renderRowItems();
    } else {
      const logoInput = document.getElementById('cc-modal-logo-value');
      if (logoInput) logoInput.value = channel.thumbnail;
      const rawLogoInput = document.getElementById('cc-modal-raw-logo');
      if (rawLogoInput) rawLogoInput.value = channel._rawLogo;
      renderCustomChannelsPanel();
      document.querySelectorAll('.mode-btn').forEach((b) => b.classList.remove('mode-disabled'));
    }
    toast('Logo updated', 'success');
  }

  closeLogoPicker();
}
