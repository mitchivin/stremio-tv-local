// ─── Custom Channels Panel
function getAllCustomChannels() {
  const channels = [];
  const seen = new Set();
  
  // Get custom channels from all rows
  for (const row of config.rows) {
    for (const item of (row.items || [])) {
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
    el.innerHTML = '<div class="empty-state"><div class="empty-icon"><span class="material-icons">live_tv</span></div><div class="empty-title">No custom channels yet</div><div class="empty-text">Create multi-source TV channels with automatic fallback</div></div>';
    return;
  }
  el.innerHTML = `<div class="channels-grid">${channels.map(ch => {
    const safeId = ch.id.replace(/[^a-z0-9-]/gi, '-');
    const srcCount = (ch.sources||[]).length;
    const mode = ch._logoMode || 'fit';
    return `
      <div class="channel-card" id="cc-card-${safeId}" data-id="${esc(ch.id)}">
        <div class="channel-logo-container" id="cc-logo-wrap-${safeId}">
          ${ch.thumbnail ? `<img class="channel-logo" src="${esc(ch.thumbnail)}" style="object-fit:${mode === 'fill' ? 'cover' : 'contain'};" />` : '<span><span class="material-icons" style="font-size:48px;color:var(--color-text-disabled);">live_tv</span></span>'}
        </div>
        <div class="channel-info">
          <div class="channel-name">${esc(ch.title)}</div>
          <div class="channel-actions">
            <span class="channel-source-count">${srcCount}</span>
            <button class="btn btn-ghost btn-sm channel-edit-btn" onclick="openCustomChannelModalById('${esc(ch.id)}')">Edit</button>
          </div>
        </div>
      </div>`;
  }).join('')}</div>`;
}

function deleteCustomChannel(id) {
  if (!confirm('Delete this custom channel?')) return;
  
  for (const row of config.rows) {
    row.items = (row.items || []).filter(i => i.id !== id);
  }
  
  if (window._orphanCustomChannels) {
    window._orphanCustomChannels = window._orphanCustomChannels.filter(i => i.id !== id);
  }
  
  markDirty();
  renderCustomChannelsPanel();
  if (document.getElementById('tv-grid')) filterTVChannels();
}

function clearAllCustomChannels() {
  const count = getAllCustomChannels().length;
  if (!count) return toast('No custom channels to clear', 'success');
  if (!confirm(`Delete all ${count} custom channel${count !== 1 ? 's' : ''}? This cannot be undone.`)) return;
  
  for (const row of config.rows) {
    row.items = (row.items || []).filter(i => !i.id?.startsWith('stremirow-'));
  }
  
  window._orphanCustomChannels = [];
  
  markDirty();
  renderRows();
  renderCustomChannelsPanel();
  if (document.getElementById('tv-grid')) filterTVChannels();
  toast('All custom channels cleared', 'success');
}

function newCustomChannel() {
  const id = 'stremirow-new-' + Date.now();
  const item = { id, type: 'tv', title: 'New Channel', thumbnail: '', description: '', sources: [] };
  
  if (!window._orphanCustomChannels) window._orphanCustomChannels = [];
  window._orphanCustomChannels.push(item);
  
  renderCustomChannelsPanel();
  ccIsNew = true;
  openCustomChannelModalById(id);
}

async function openCustomChannelModalById(id) {
  let item = config.rows.flatMap(r => r.items || []).find(i => i.id === id);
  
  if (!item && window._orphanCustomChannels) {
    item = window._orphanCustomChannels.find(i => i.id === id);
  }
  
  if (item) await openCustomChannelModal(item);
}

function closeCCModal() {
  if (ccIsNew && ccEditingId) {
    for (const row of config.rows) {
      row.items = (row.items || []).filter(i => i.id !== ccEditingId);
    }
    
    if (window._orphanCustomChannels) {
      window._orphanCustomChannels = window._orphanCustomChannels.filter(i => i.id !== ccEditingId);
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
  
  const deleteBtn = document.getElementById('cc-delete-btn');
  if (deleteBtn) deleteBtn.style.display = ccIsNew ? 'none' : '';
  
  const titleDisplay = document.getElementById('cc-modal-title-display');
  const titleInput = document.getElementById('cc-modal-title-input');
  if (titleDisplay) titleDisplay.innerHTML = `${esc(existingItem.title || 'New Channel')}<span class="material-icons" style="font-size: 20px; opacity: 0.7;">edit</span>`;
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
  modeButtons.forEach(btn => {
    btn.classList.toggle('active', btn.classList.contains(currentMode));
  });
  
  if (existingItem.thumbnail) {
    if (logoValue) logoValue.value = existingItem.thumbnail;
    if (logoPreview) {
      logoPreview.src = existingItem.thumbnail;
      logoPreview.style.display = '';
    }
    if (logoPlaceholder) logoPlaceholder.style.display = 'none';
  } else {
    if (logoValue) logoValue.value = '';
    if (logoPreview) logoPreview.style.display = 'none';
    if (logoPlaceholder) logoPlaceholder.style.display = '';
  }
  if (rawLogoValue) rawLogoValue.value = existingItem._rawLogo || '';
  
  renderCCSources();
  document.getElementById('cc-search').value = '';
  openModal('custom-channel-modal');

  if (!tvAddons.length) {
    setCCStatus('Loading addons…');
    try {
      const d = await fetch(`/api/stremio/addons${getUserParam()}`).then(r => r.json());
      tvAddons = (d.addons || []).filter(isTvAddon);
    } catch (e) { tvAddons = []; }
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

function ccOnLogoFile(e) {
  const file = e.target.files[0];
  if (file) ccProcessLogo(file);
}

function ccOnLogoDrop(e) {
  e.preventDefault();
  document.getElementById('cc-modal-logo-wrap')?.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) ccProcessLogo(file);
}

function ccProcessLogo(file) {
  const modeInput = document.getElementById('cc-modal-mode-value');
  const mode = modeInput ? modeInput.value : 'fit';
  const reader = new FileReader();
  reader.onload = function(e) {
    const raw = e.target.result;
    const rawInput = document.getElementById('cc-modal-raw-logo');
    if (rawInput) rawInput.value = raw;
    ccApplyLogoMode(raw, mode);
  };
  reader.readAsDataURL(file);
}

function ccSetLogoMode(mode) {
  const modeInput = document.getElementById('cc-modal-mode-value');
  if (modeInput) modeInput.value = mode;
  const modeButtons = document.querySelectorAll('.mode-btn');
  modeButtons.forEach(btn => {
    btn.classList.toggle('active', btn.classList.contains(mode));
  });
  
  const rawInput = document.getElementById('cc-modal-raw-logo');
  const raw = rawInput ? rawInput.value : '';
  if (raw) ccApplyLogoMode(raw, mode);
}

function ccApplyLogoMode(rawDataUrl, mode) {
  const img = new Image();
  img.onload = function() {
    const SIZE = 400;
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#141414';
    ctx.fillRect(0, 0, SIZE, SIZE);
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
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    const logoInput = document.getElementById('cc-modal-logo-value');
    if (logoInput) logoInput.value = dataUrl;
    const preview = document.getElementById('cc-modal-logo-preview');
    if (preview) {
      preview.src = dataUrl;
      preview.style.display = '';
    }
    const placeholder = document.getElementById('cc-modal-logo-placeholder');
    if (placeholder) placeholder.style.display = 'none';
  };
  img.src = rawDataUrl;
}

function saveCustomChannel() {
  if (!ccEditingId) return;
  if (!ccSources.length) { toast('Add at least one source', 'error'); return; }

  let item = null;
  let found = false;
  
  for (const row of config.rows) {
    item = (row.items || []).find(i => i.id === ccEditingId);
    if (item) {
      found = true;
      break;
    }
  }
  
  if (!found && window._orphanCustomChannels) {
    item = window._orphanCustomChannels.find(i => i.id === ccEditingId);
  }
  
  if (!item) {
    toast('Channel not found', 'error');
    return;
  }
  
  const titleInput = document.getElementById('cc-modal-title-input');
  const newTitle = titleInput ? titleInput.value.trim() : item.title;
  
  item.title = newTitle || item.title;
  item.sources = ccSources;
  
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
      ...config.rows.flatMap(r => r.items || []),
      ...(window._orphanCustomChannels || [])
    ];
    const savedItem = allItems.find(i => i.id === ccEditingId);
    if (savedItem) {
      const idx = tempRowItems.findIndex(i => i.id === ccEditingId);
      if (idx >= 0) tempRowItems[idx] = savedItem; else tempRowItems.push(savedItem);
      renderRowItems();
      filterTVChannels();
    }
  }

  ccIsNew = false;
  closeModal('custom-channel-modal');
  toast('Sources saved', 'success');
}

function deleteActiveCustomChannel() {
  if (!ccEditingId) return;
  if (!confirm('Delete this custom channel?')) return;
  
  for (const row of config.rows) {
    row.items = (row.items || []).filter(i => i.id !== ccEditingId);
  }
  
  if (window._orphanCustomChannels) {
    window._orphanCustomChannels = window._orphanCustomChannels.filter(i => i.id !== ccEditingId);
  }
  
  closeModal('custom-channel-modal');
  markDirty();
  renderCustomChannelsPanel();
  renderRows();
  if (document.getElementById('tv-grid')) filterTVChannels();
  toast('Channel deleted', 'success');
}
