// ─── Rows
function renderRows() {
  const el = document.getElementById('rows-container');
  if (!el) return;
  if (!config.rows.length) {
    el.innerHTML = '<div class="empty-state"><div class="empty-icon"><span class="material-icons">view_list</span></div><div class="empty-title">No rows yet</div><div class="empty-text">Add one to get started</div></div>';
    return;
  }
  
  const TYPE_ICONS = { movie: 'movie', series: 'tv', tv: 'live_tv' };
  
  el.innerHTML = `<div class="channels-grid">${config.rows.map((row, i) => {
    const count = (row.items || []).length;
    const ct = row.contentType || 'movie';
    const icon = TYPE_ICONS[ct] || 'movie';
    const items = row.items || [];
    
    let thumbnailHtml = '';
    if (items.length === 0) {
      thumbnailHtml = `<span><span class="material-icons" style="font-size:48px;color:var(--color-text-disabled);">${icon}</span></span>`;
    } else if (items.length === 1) {
      thumbnailHtml = items[0].thumbnail 
        ? `<img class="channel-logo" src="${esc(items[0].thumbnail)}" style="object-fit:contain;" />`
        : `<span><span class="material-icons" style="font-size:48px;color:var(--color-text-disabled);">${icon}</span></span>`;
    } else {
      const gridItems = items.slice(0, 4);
      thumbnailHtml = `<div class="row-thumbnail-grid">${gridItems.map(item => 
        item.thumbnail 
          ? `<img src="${esc(item.thumbnail)}" />`
          : `<div class="row-thumbnail-placeholder"><span class="material-icons">${icon}</span></div>`
      ).join('')}</div>`;
    }
    
    return `
      <div class="channel-card" id="rc-${i}" draggable="true"
        ondragstart="dragStart(${i})" ondragover="dragOver(event,${i})"
        ondrop="drop(event,${i})" ondragleave="dragLeave(event)">
        <div class="channel-logo-container">
          ${thumbnailHtml}
        </div>
        <div class="channel-info">
          <div class="channel-name">${esc(row.name)}</div>
          <div class="channel-actions">
            <span class="channel-source-count">${count}</span>
            <button class="btn btn-ghost btn-sm channel-edit-btn" onclick="openBuilderModal(${i})">Edit</button>
          </div>
        </div>
      </div>`;
  }).join('')}</div>`;
}

function renderRowPreview(row) {
  const items = row.items || [];
  if (!items.length) return '<div class="empty-text" style="padding: var(--space-4);">No items added yet</div>';
  const isTv = row.contentType === 'tv';
  return items.map(m => `
    <div class="preview-item">
      <div class="preview-thumb">
        ${m.thumbnail ? `<img src="${esc(m.thumbnail)}" alt="${esc(m.title)}">` : '<span class="material-icons" style="font-size:32px;color:var(--color-text-disabled);">' + (isTv ? 'live_tv' : 'movie') + '</span>'}
      </div>
      <div class="preview-title">${esc(m.title)}</div>
    </div>
  `).join('');
}

let dragIdx = -1;
function dragStart(i) { dragIdx = i; document.getElementById('rc-' + i).classList.add('dragging'); }
function dragOver(e, i) { e.preventDefault(); if (i !== dragIdx) document.getElementById('rc-' + i).classList.add('drag-over'); }
function dragLeave(e) { e.currentTarget.classList.remove('drag-over'); }
function drop(e, i) {
  e.preventDefault();
  document.querySelectorAll('.home-row').forEach(el => el.classList.remove('drag-over', 'dragging'));
  if (i === dragIdx) return;
  const m = config.rows.splice(dragIdx, 1)[0]; config.rows.splice(i, 0, m);
  markDirty(); renderRows();
}

function deleteRow(i) {
  if (!confirm(`Delete row "${config.rows[i].name}"?`)) return;
  config.rows.splice(i, 1); markDirty(); renderRows();
}

function clearAllRows() {
  if (!confirm('Delete all rows? This cannot be undone.')) return;
  config.rows = [];
  markDirty();
  renderRows();
  toast('All rows cleared', 'success');
}

// ─── Builder Modal
function setBuilderTitle(name, type) {
  const TYPE_LABELS = { movie: 'Movies', series: 'Series', tv: 'TV Channels' };
  const titleEl = document.getElementById('builder-modal-title');
  if (!titleEl) return;
  const label = TYPE_LABELS[type] || type;
  titleEl.innerHTML = `<span class="builder-type-tag">${esc(label)}</span> <span class="builder-title-name" onclick="startInlineRename()" title="Click to rename" data-title="${esc(name)}">${esc(name)}<span class="material-icons" style="font-size: 20px; opacity: 0.7;">edit</span></span>`;
  const input = document.getElementById('builder-title-input');
  const confirmBtn = document.getElementById('builder-rename-confirm');
  if (input) {
    input.value = name;
    input.style.display = 'none';
  }
  if (confirmBtn) confirmBtn.style.display = 'none';
}

function startInlineRename() {
  const titleEl = document.getElementById('builder-modal-title');
  const input = document.getElementById('builder-title-input');
  const confirmBtn = document.getElementById('builder-rename-confirm');
  if (!input) return;
  const nameEl = titleEl.querySelector('.builder-title-name');
  input.value = nameEl ? (nameEl.getAttribute('data-title') || '') : '';
  if (nameEl) nameEl.style.display = 'none';
  input.style.display = 'inline-block';
  if (confirmBtn) confirmBtn.style.display = 'inline-block';
  input.focus();
  input.select();
}

function commitInlineRename() {
  const titleEl = document.getElementById('builder-modal-title');
  const input = document.getElementById('builder-title-input');
  const confirmBtn = document.getElementById('builder-rename-confirm');
  if (!input || input.style.display === 'none') return;
  const name = input.value.trim();
  if (name) {
    setBuilderTitle(name, _builderType);
  } else {
    input.style.display = 'none';
    if (confirmBtn) confirmBtn.style.display = 'none';
    const nameEl = titleEl.querySelector('.builder-title-name');
    if (nameEl) nameEl.style.display = '';
  }
}

function cancelInlineRename() {
  const titleEl = document.getElementById('builder-modal-title');
  const input = document.getElementById('builder-title-input');
  const confirmBtn = document.getElementById('builder-rename-confirm');
  if (!input) return;
  input.style.display = 'none';
  if (confirmBtn) confirmBtn.style.display = 'none';
  const nameEl = titleEl.querySelector('.builder-title-name');
  if (nameEl) nameEl.style.display = '';
}

function openBuilderModal(idx = -1) {
  editingRowIdx = idx;
  const isNew = idx < 0;
  const row = isNew ? { id: '', name: '', items: [], contentType: 'movie' } : config.rows[idx];
  let rowType = row.contentType || 'movie';

  const setup = document.getElementById('builder-setup');
  const editor = document.getElementById('builder-editor');
  const saveBtn = document.getElementById('builder-save-btn');
  const deleteBtn = document.getElementById('builder-delete-btn');
  const titleEl = document.getElementById('builder-modal-title');

  if (isNew) {
    setup.style.display = '';
    editor.style.display = 'none';
    saveBtn.style.display = 'none';
    if (deleteBtn) deleteBtn.style.display = 'none';
    titleEl.textContent = 'New Row';
    document.getElementById('builder-setup-name').value = '';
    selectBuilderType('movie');
    openModal('builder-modal');
    setTimeout(() => document.getElementById('builder-setup-name').focus(), 100);
  } else {
    setup.style.display = 'none';
    editor.style.display = '';
    saveBtn.style.display = '';
    if (deleteBtn) deleteBtn.style.display = '';
    _builderType = rowType;
    setBuilderTitle(row.name || 'Edit Row', rowType);
    tempRowItems = [...(row.items || [])];
    renderRowItems();
    onBuilderTypeChange();
    openModal('builder-modal');
  }
}

function deleteActiveRow() {
  if (editingRowIdx < 0) return;
  if (!confirm(`Delete row "${config.rows[editingRowIdx].name}"?`)) return;
  config.rows.splice(editingRowIdx, 1);
  closeBuilderModal();
  markDirty();
  renderRows();
  toast('Row deleted', 'success');
}

let _builderType = 'movie';

function selectBuilderType(type) {
  _builderType = type;
  document.querySelectorAll('.builder-type-card').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.type === type);
  });
}

function commitBuilderSetup() {
  const name = document.getElementById('builder-setup-name').value.trim();
  if (!name) { document.getElementById('builder-setup-name').focus(); return; }

  const TYPE_LABELS = { movie: 'Movies', series: 'Series', tv: 'TV Channels' };
  setBuilderTitle(name, _builderType);
  document.getElementById('builder-save-btn').style.display = '';

  document.getElementById('builder-setup').style.display = 'none';
  document.getElementById('builder-editor').style.display = '';

  tempRowItems = [];
  renderRowItems();
  onBuilderTypeChange();
}

function closeBuilderModal() {
  closeModal('builder-modal');
}

function onBuilderTypeChange() {
  const type = _builderType;

  const dMovies = document.getElementById('discovery-movies');
  const dTv = document.getElementById('discovery-tv');
  const movieToolbar = document.getElementById('builder-toolbar-movie');
  const tvToolbar = document.getElementById('builder-toolbar-tv');
  const movieSearch = document.getElementById('movie-search');

  if (type === 'movie' || type === 'series') {
    dMovies.style.display = '';
    dTv.style.display = 'none';
    if (movieToolbar) movieToolbar.style.display = 'flex';
    if (tvToolbar) tvToolbar.style.display = 'none';
    if (movieSearch) movieSearch.placeholder = type === 'movie' ? 'Search movies…' : 'Search series…';
    setMovieType(type);
  } else {
    dTv.style.display = '';
    dMovies.style.display = 'none';
    if (movieToolbar) movieToolbar.style.display = 'none';
    if (tvToolbar) tvToolbar.style.display = 'flex';
    updateTVPanel();
  }
}

function renderRowItems() {
  const el = document.getElementById('row-items-list');
  if (!tempRowItems.length) {
    el.innerHTML = '<span style="font-size:11px;color:var(--color-text-disabled);padding:4px 2px;">Click items below to add them</span>';
    return;
  }
  const isTv = _builderType === 'tv';
  const ph = isTv ? 'live_tv' : 'movie';
  el.innerHTML = tempRowItems.map((s, i) => {
    const thumb = s.thumbnail
      ? `<img src="${esc(s.thumbnail)}" onerror="this.style.display='none'">`
      : `<div style="display:flex;align-items:center;justify-content:center;height:100%;"><span class="material-icons" style="font-size:24px;color:var(--color-text-disabled);">${ph}</span></div>`;
    return `<div class="builder-item"
      draggable="true"
      ondragstart="onDragStartRowItem(event,${i})"
      ondragover="onDragOverRowItem(event)"
      ondrop="onDropRowItem(event,${i})"
      title="${esc(s.title)}">
      <div class="builder-item-thumb${isTv ? ' tv' : ''}">${thumb}</div>
      <button class="builder-item-remove" onclick="removeItem(${i})" title="Remove">×</button>
    </div>`;
  }).join('');
}
function removeItem(i) { tempRowItems.splice(i, 1); renderRowItems(); refreshDiscoveryGrids(); }

let dragRowItemIdx = null;
function onDragStartRowItem(e, i) {
  dragRowItemIdx = i;
  e.dataTransfer.effectAllowed = 'move';
  e.target.style.opacity = '0.5';
}
function onDragOverRowItem(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }
function onDropRowItem(e, targetIdx) {
  e.preventDefault();
  const chip = e.target.closest('.builder-item');
  if (chip) chip.style.opacity = '1';
  if (dragRowItemIdx === null || dragRowItemIdx === targetIdx) return;
  const item = tempRowItems.splice(dragRowItemIdx, 1)[0];
  tempRowItems.splice(targetIdx, 0, item);
  dragRowItemIdx = null;
  renderRowItems();
}

function toggleActiveRowItem(item) {
  if (editingRowIdx < -1) return;
  const type = _builderType;
  const itemType = item.type === 'movie' || item.type === 'series' ? item.type : 'tv';
  if (type === 'tv' && itemType !== 'tv') return toast('This row only accepts TV Channels', 'error');
  if (type !== 'tv' && itemType === 'tv') return toast('This row only accepts Movies or Series', 'error');
  if (type === 'movie' && item.type === 'series') return toast('This row only accepts Movies', 'error');
  if (type === 'series' && item.type === 'movie') return toast('This row only accepts Series', 'error');

  const idx = tempRowItems.findIndex(x => x.id === item.id);
  if (idx >= 0) {
    tempRowItems.splice(idx, 1);
  } else {
    tempRowItems.push({ id: item.id, type: item.type, title: item.title, thumbnail: item.thumbnail || '', description: item.description || '' });
  }
  renderRowItems();
  refreshDiscoveryGrids();
}

function refreshDiscoveryGrids() {
  const type = _builderType;
  if (type === 'movie' || type === 'series') {
    renderMovieGrid(document.getElementById('load-more-btn') !== null);
  } else {
    filterTVChannels();
  }
}

function saveActiveRow() {
  commitInlineRename();
  const titleEl = document.getElementById('builder-modal-title');
  const input = document.getElementById('builder-title-input');
  const name = input ? input.value.trim() : '';
  if (!name) { toast('Please enter a row name', 'error'); startInlineRename(); return; }
  const contentType = _builderType;
  
  // Generate unique row ID
  let rowId;
  if (editingRowIdx >= 0) {
    rowId = config.rows[editingRowIdx].id;
  } else {
    rowId = slugify(name) || 'row-' + Date.now();
    // Ensure uniqueness
    const existingIds = new Set(config.rows.map(r => r.id));
    if (existingIds.has(rowId)) {
      rowId = rowId + '-' + Date.now();
    }
  }
  
  const row = { id: rowId, name, contentType, items: tempRowItems };
  
  // Move orphan custom channels into this row
  if (window._orphanCustomChannels) {
    const orphanIds = new Set(window._orphanCustomChannels.map(ch => ch.id));
    const addedOrphans = tempRowItems.filter(item => orphanIds.has(item.id));
    if (addedOrphans.length) {
      window._orphanCustomChannels = window._orphanCustomChannels.filter(ch => 
        !addedOrphans.some(item => item.id === ch.id)
      );
    }
  }
  
  if (editingRowIdx >= 0) config.rows[editingRowIdx] = row; else config.rows.push(row);
  closeBuilderModal(); markDirty(); renderRows();
}
