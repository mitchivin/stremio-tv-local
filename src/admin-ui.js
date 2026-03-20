'use strict';

const CINEMETA = 'https://v3-cinemeta.strem.io';

// ─── State
let config = { addon: { id: 'com.stremirow.custom', version: '1.0.0', name: 'StremiRow', description: 'Personal curated rows...' }, rows: [] };
let editingRowIdx = -1, tempRowItems = [];
let dirty = false;
let movieType = 'movie', movieResults = [], movieTimer = null;
let tvAddons = [];
const EXCLUDED_ADDON_IDS = new Set(['com.stremirow.custom']);
function isTvAddon(a) {
  if (EXCLUDED_ADDON_IDS.has(a.manifest.id)) return false;
  const t = a.manifest.types || [];
  return t.includes('tv') || t.includes('channel');
}

// ─── Util
function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function safeJson(o) { return JSON.stringify(o).replace(/'/g, '&#39;'); }
function slugify(n) { return n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

let _toastTimer;
function toast(msg, type = 'success') {
  const el = document.getElementById('toast');
  el.textContent = (type === 'success' ? '✅ ' : '❌ ') + msg;
  el.className = 'show ' + type;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.className = '', 4000);
}
function markDirty() {
  saveAll();
}

// ─── Logo Easter Egg
let logoClicks = [];
function onLogoClick(event) {
  if (!event.shiftKey) return;
  const now = Date.now();
  logoClicks.push(now);
  logoClicks = logoClicks.filter(t => now - t < 10000);
  if (logoClicks.length >= 7) {
    const a1xSection = document.getElementById('a1x-section');
    if (a1xSection) {
      a1xSection.style.display = 'block';
      toast('A1X IPTV unlocked!', 'success');
    }
    logoClicks = [];
  }
}

// ─── Nav
function switchNav(name) {
  ['rows', 'install', 'custom-channels'].forEach(n => {
    const navEl = document.getElementById('nav-' + n);
    const panelEl = document.getElementById('panel-' + n);
    if (navEl) navEl.classList.toggle('active', n === name);
    if (panelEl) panelEl.classList.toggle('active', n === name);
  });
  if (name === 'install') renderInstallTab();
  if (name === 'custom-channels') renderCustomChannelsPanel();
}

// ─── Rows
function renderRows() {
  const el = document.getElementById('row-list');
  if (!config.rows.length) {
    el.innerHTML = '<div class="empty"><div class="empty-icon">📋</div><div class="empty-text">No rows yet — add one to get started.</div></div>';
    return;
  }
  el.innerHTML = config.rows.map((row, i) => {
    const count = (row.items || []).length;
    const ct = row.contentType || 'movie';
    return `<div class="home-row" id="rc-${i}" draggable="true"
    ondragstart="dragStart(${i})" ondragover="dragOver(event,${i})"
    ondrop="drop(event,${i})" ondragleave="dragLeave(event)">
    <div class="home-row-header">
      <div class="home-row-title-wrap">
        <span class="drag-handle" style="margin-right: 4px;">⋮⋮</span>
        <div class="home-row-title">${esc(row.name)}</div>
        <span class="chip chip-t">${ct}</span>
        <span class="chip chip-c">${count}</span>
      </div>
      <div class="home-row-actions">
        <button class="btn btn-ghost btn-sm" onclick="openBuilderModal(${i})">✏ Edit</button>
        <button class="btn btn-danger btn-sm" onclick="deleteRow(${i})">🗑</button>
      </div>
    </div>
    <div class="home-row-preview">
      ${renderRowPreview(row)}
    </div>
  </div>`;
  }).join('');
}

function renderRowPreview(row) {
  const items = row.items || [];
  if (!items.length) return '<div style="font-size: 11px; color: var(--muted); padding: 10px;">No items added yet. Click Edit to add some!</div>';
  const isTv = row.contentType === 'tv';
  return items.map(m => `
    <div class="preview-card" style="width: ${isTv ? '100px' : '80px'}">
      <div class="pc-thumb" style="aspect-ratio: ${isTv ? '1/1' : '2/3'}">
        ${m.thumbnail ? `<img src="${esc(m.thumbnail)}" onerror="this.style.display='none'">` : `<div class="pc-thumb-ph">${isTv ? '📺' : '🎬'}</div>`}
      </div>
      <div class="pc-title">${esc(m.title)}</div>
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

function setBuilderTitle(name, type) {
  const TYPE_LABELS = { movie: 'Movies', series: 'Series', tv: 'TV Channels' };
  const titleEl = document.getElementById('builder-modal-title');
  if (!titleEl) return;
  const label = TYPE_LABELS[type] || type;
  titleEl.innerHTML = `<span class="builder-type-tag">${esc(label)}</span> <span class="builder-title-name" onclick="startInlineRename()" title="Click to rename">${esc(name)}</span>`;
  // Hide input/confirm (they are siblings, not children — safe from innerHTML wipe)
  const input = document.getElementById('builder-title-input');
  const confirmBtn = document.getElementById('builder-rename-confirm');
  if (input) input.style.display = 'none';
  if (confirmBtn) confirmBtn.style.display = 'none';
}

function startInlineRename() {
  const titleEl = document.getElementById('builder-modal-title');
  const input = document.getElementById('builder-title-input');
  const confirmBtn = document.getElementById('builder-rename-confirm');
  if (!input) return;
  const nameEl = titleEl.querySelector('.builder-title-name');
  input.value = nameEl ? nameEl.textContent : '';
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

  const TYPE_LABELS = { movie: 'Movies', series: 'Series', tv: 'TV Channels' };
  const setup = document.getElementById('builder-setup');
  const editor = document.getElementById('builder-editor');
  const saveBtn = document.getElementById('builder-save-btn');
  const titleEl = document.getElementById('builder-modal-title');

  if (isNew) {
    setup.style.display = '';
    editor.style.display = 'none';
    saveBtn.style.display = 'none';
    titleEl.textContent = 'New Row';
    document.getElementById('builder-setup-name').value = '';
    selectBuilderType('movie');
    openModal('builder-modal');
    setTimeout(() => document.getElementById('builder-setup-name').focus(), 100);
  } else {
    setup.style.display = 'none';
    editor.style.display = '';
    saveBtn.style.display = '';
    _builderType = rowType;
    setBuilderTitle(row.name || 'Edit Row', rowType);
    tempRowItems = [...(row.items || [])];
    renderRowItems();
    onBuilderTypeChange();
    openModal('builder-modal');
  }
}

let _builderType = 'movie';

function selectBuilderType(type) {
  _builderType = type;
  document.querySelectorAll('.builder-type-btn').forEach(btn => {
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
    el.innerHTML = '<span style="font-size:11px;color:var(--muted);padding:4px 2px;">Click items below to add them</span>';
    return;
  }
  const isTv = _builderType === 'tv';
  const ph = isTv ? '📺' : '🎬';
  el.innerHTML = tempRowItems.map((s, i) => {
    const thumb = s.thumbnail
      ? `<img src="${esc(s.thumbnail)}" onerror="this.style.display='none'">`
      : `<div style="display:flex;align-items:center;justify-content:center;height:100%;font-size:16px;">${ph}</div>`;
    return `<div class="row-item-card"
      draggable="true"
      ondragstart="onDragStartRowItem(event,${i})"
      ondragover="onDragOverRowItem(event)"
      ondrop="onDropRowItem(event,${i})"
      title="${esc(s.title)}">
      <div class="row-item-thumb${isTv ? ' tv' : ''}">${thumb}</div>
      <div class="row-item-title">${esc(s.title)}</div>
      <button class="row-item-remove" onclick="removeItem(${i})" title="Remove">×</button>
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
  const chip = e.target.closest('.cc-source-chip');
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
    // Re-render current results — movieResults already holds the filtered/searched set
    renderMovieGrid(document.getElementById('load-more-btn') !== null);
  } else {
    filterTVChannels();
  }
}

function saveActiveRow() {
  commitInlineRename();
  const titleEl = document.getElementById('builder-modal-title');
  const nameEl = titleEl ? titleEl.querySelector('.builder-title-name') : null;
  const name = nameEl ? nameEl.textContent.trim() : '';
  if (!name) { toast('Please enter a row name', 'error'); startInlineRename(); return; }
  const contentType = _builderType;
  const rowId = editingRowIdx >= 0 ? config.rows[editingRowIdx].id : (slugify(name) || 'row-' + Date.now());
  const row = { id: rowId, name, contentType, items: tempRowItems };
  if (editingRowIdx >= 0) config.rows[editingRowIdx] = row; else config.rows.push(row);
  closeBuilderModal(); markDirty(); renderRows();
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

// ─── Movies & Series (CineMeta)
const CINEMETA_CATALOGS = {
  movie: [
    { id: 'top', name: 'Popular', genres: ['Action', 'Adventure', 'Animation', 'Biography', 'Comedy', 'Crime', 'Documentary', 'Drama', 'Family', 'Fantasy', 'History', 'Horror', 'Mystery', 'Romance', 'Sci-Fi', 'Sport', 'Thriller', 'War', 'Western'] },
    { id: 'year', name: 'New', genres: Array.from({ length: 107 }, (_, i) => `${2026 - i}`) },
    { id: 'imdbRating', name: 'Featured', genres: ['Action', 'Adventure', 'Animation', 'Biography', 'Comedy', 'Crime', 'Documentary', 'Drama', 'Family', 'Fantasy', 'History', 'Horror', 'Mystery', 'Romance', 'Sci-Fi', 'Sport', 'Thriller', 'War', 'Western'] }
  ],
  series: [
    { id: 'top', name: 'Popular', genres: ['Action', 'Adventure', 'Animation', 'Biography', 'Comedy', 'Crime', 'Documentary', 'Drama', 'Family', 'Fantasy', 'History', 'Horror', 'Mystery', 'Romance', 'Sci-Fi', 'Sport', 'Thriller', 'War', 'Western', 'Reality-TV', 'Talk-Show', 'Game-Show'] },
    { id: 'year', name: 'New', genres: Array.from({ length: 107 }, (_, i) => `${2026 - i}`) },
    { id: 'imdbRating', name: 'Featured', genres: ['Action', 'Adventure', 'Animation', 'Biography', 'Comedy', 'Crime', 'Documentary', 'Drama', 'Family', 'Fantasy', 'History', 'Horror', 'Mystery', 'Romance', 'Sci-Fi', 'Sport', 'Thriller', 'War', 'Western', 'Reality-TV', 'Talk-Show', 'Game-Show'] }
  ]
};

function updateCineMetaDropdowns() {
  const catalogs = CINEMETA_CATALOGS[movieType] || [];
  const catSelect = document.getElementById('movie-catalog');
  const prevCat = catSelect.value;
  catSelect.innerHTML = catalogs.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  if (catalogs.some(c => c.id === prevCat)) catSelect.value = prevCat;
  updateCineMetaGenres(document.getElementById('movie-genre').value);
}

function updateCineMetaGenres(preserveGenre) {
  const catalogs = CINEMETA_CATALOGS[movieType] || [];
  const catId = document.getElementById('movie-catalog').value;
  const catalog = catalogs.find(c => c.id === catId);
  const genSelect = document.getElementById('movie-genre');
  if (!catalog || !catalog.genres || catalog.genres.length === 0) {
    genSelect.style.display = 'none';
    genSelect.innerHTML = '';
  } else {
    genSelect.style.display = '';
    let html = catalog.id === 'year' ? `<option value="">All Years</option>` : `<option value="">All Genres</option>`;
    html += catalog.genres.map(g => `<option value="${esc(g)}">${esc(g)}</option>`).join('');
    genSelect.innerHTML = html;
    if (preserveGenre && catalog.genres.includes(preserveGenre)) genSelect.value = preserveGenre;
  }
}

function setMovieType(t) {
  movieType = t;
  updateCineMetaDropdowns();
  const q = document.getElementById('movie-search').value.trim();
  if (q.length >= 2) searchCineMeta(q); else loadCategory();
}
function onMovieSearch() {
  clearTimeout(movieTimer);
  const q = document.getElementById('movie-search').value.trim();
  if (!q) { loadCategory(); return; }
  if (q.length < 2) return;
  movieTimer = setTimeout(() => searchCineMeta(q), 400);
}
function onCatalogChange() {
  document.getElementById('movie-search').value = '';
  updateCineMetaGenres();
  loadCategory();
}
function onGenreChange() {
  document.getElementById('movie-search').value = '';
  loadCategory();
}
function loadCategory(append = false) {
  const cat = document.getElementById('movie-catalog')?.value;
  const gen = document.getElementById('movie-genre')?.value;
  if (!cat) return;
  let url = `${CINEMETA}/catalog/${movieType}/${cat}`;
  let extras = [];
  if (gen) extras.push(`genre=${encodeURIComponent(gen)}`);
  const skipCount = append ? movieResults.length : 0;
  if (skipCount > 0) extras.push(`skip=${skipCount}`);
  if (extras.length > 0) url += `/${extras.join('&')}`;
  url += '.json';
  fetchBrowse(url, append);
}

function searchCineMeta(q, append = false) {
  let url = `${CINEMETA}/catalog/${movieType}/top`;
  let extras = [`search=${encodeURIComponent(q)}`];
  const skipCount = append ? movieResults.length : 0;
  if (skipCount > 0) extras.push(`skip=${skipCount}`);
  if (extras.length > 0) url += `/${extras.join('&')}`;
  url += '.json';
  fetchBrowse(url, append);
}

async function fetchBrowse(url, append) {
  const grid = document.getElementById('movie-grid');
  if (!append) {
    grid.innerHTML = '<div class="empty" style="grid-column:1/-1"><div class="empty-icon">⏳</div><div class="empty-text">Loading…</div></div>';
  } else {
    const btn = document.getElementById('load-more-btn');
    if (btn) btn.textContent = 'Loading...';
  }
  try {
    const d = await fetch(`/api/stremio/proxy-catalog?url=${encodeURIComponent(url)}`).then(r => r.json());
    if (d.error) throw new Error(d.error);
    const newResults = (d.metas || []).map(m => ({ id: m.id, type: movieType, title: m.name, thumbnail: m.poster || '', description: m.description || '', year: m.year || null }));
    if (append) {
      if (newResults.length === 0) { toast('No more results', 'success'); renderMovieGrid(false); return; }
      movieResults.push(...newResults);
    } else {
      movieResults = newResults;
    }
    renderMovieGrid(newResults.length >= 15);
  } catch (e) {
    if (!append) grid.innerHTML = `<div class="empty" style="grid-column:1/-1"><div class="empty-icon">❌</div><div class="empty-text">${esc(e.message)}</div></div>`;
    else toast('Failed to load more: ' + e.message, 'error');
  }
}

function loadMoreMovies() {
  const q = document.getElementById('movie-search').value.trim();
  if (q.length >= 2) searchCineMeta(q, true);
  else loadCategory(true);
}
function renderMovieGrid(hasMore = false) {
  const grid = document.getElementById('movie-grid');
  if (!movieResults.length) { grid.innerHTML = '<div class="empty" style="grid-column:1/-1"><div class="empty-icon">📭</div><div class="empty-text">No results.</div></div>'; return; }
  const placeholder = 'https://images.placeholders.dev/?width=300&height=450&text=No%20Poster&bgColor=%231a1a1a&textColor=%23666';
  let html = movieResults.map(item => {
    const inActiveRow = tempRowItems.some(i => i.id === item.id);
    return `<div class="poster-card${inActiveRow ? ' in-row' : ''}" onclick='toggleActiveRowItem(${safeJson(item)})'>
    ${item.thumbnail ? `<img class="pimg" src="${esc(item.thumbnail)}" loading="lazy" onerror="this.src='${placeholder}'">` : `<img class="pimg" src="${placeholder}">`}
    <div class="pbody">
      <div class="ptitle">${esc(item.title)}</div>
      ${item.year ? `<div class="pmeta">${item.year}</div>` : ''}
    </div>
  </div>`;
  }).join('');
  if (hasMore) {
    html += `<div style="grid-column:1/-1;text-align:center;padding:20px 0;">
      <button class="btn btn-ghost" id="load-more-btn" onclick="loadMoreMovies()">Load More</button>
    </div>`;
  }
  grid.innerHTML = html;
}

// ─── TV Channels
async function updateTVPanel() {
  const body = document.getElementById('tv-body');
  if (!body) return;

  // Render toolbar + grid shell immediately so UI appears right away
  const toolbar = document.getElementById('builder-toolbar-tv');
  if (toolbar) {
    toolbar.style.display = 'flex';
    toolbar.innerHTML = `
      <div class="search-wrap">
        <span class="search-icon" style="font-size:13px;">🔍</span>
        <input class="search-input" id="tv-search" type="search" placeholder="Search channels…" oninput="applyTVFilter()"/>
      </div>
      <select class="form-input cc-select" id="tv-addon-select" onchange="onTVAddonChange()">
        <option value="">All Addons</option>
      </select>
      <select class="form-input cc-select" id="tv-genre-select" onchange="applyTVFilter()" disabled>
        <option value="">All Genres</option>
      </select>`;
  }
  body.innerHTML = '<div class="cc-status" id="tv-load-status"></div><div id="tv-grid"></div>';
  setCCStatus('Checking account…');

  // If channels already cached, populate immediately
  if (ccAllChannels.length && tvAddons.length) {
    populateTVAddonDropdown();
    applyTVFilter();
    setCCStatus(`${ccAllChannels.length} channels from ${tvAddons.length} addon${tvAddons.length !== 1 ? 's' : ''}`);
    return;
  }

  const auth = await fetch('/api/stremio/status').then(r => r.json()).catch(() => null);
  if (!auth || !auth.loggedIn) {
    body.innerHTML = `<div class="empty" style="padding:40px 0;text-align:center;">
      <div class="empty-icon">🔒</div>
      <div class="empty-text" style="margin-bottom:12px;">Sign in to browse TV Channels</div>
      <button class="btn btn-primary" onclick="openModal('stremio-login-modal')">Connect Stremio Account</button>
    </div>`;
    if (toolbar) toolbar.style.display = 'none';
    return;
  }

  if (!tvAddons.length) {
    setCCStatus('Loading addons…');
    try {
      const resp = await fetch('/api/stremio/addons');
      if (resp.status === 401) {
        body.innerHTML = '<div class="empty"><div class="empty-icon">🔒</div><div class="empty-text">Session expired. Please sign in again.</div></div>';
        if (toolbar) toolbar.style.display = 'none';
        return;
      }
      const d = await resp.json();
      tvAddons = (d.addons || []).filter(isTvAddon);
    } catch (e) {
      setCCStatus('');
      body.innerHTML = `<div class="empty"><div class="empty-icon">❌</div><div class="empty-text">${esc(e.message)}</div></div>`;
      return;
    }
  }

  if (!tvAddons.length) {
    body.innerHTML = '<div class="empty"><div class="empty-icon">📡</div><div class="empty-text">No IPTV or TV addons found.</div></div>';
    if (toolbar) toolbar.style.display = 'none';
    return;
  }

  populateTVAddonDropdown();

  if (!ccAllChannels.length) {
    await loadAllCCChannels();
  }
  applyTVFilter();
}

function populateTVAddonDropdown() {
  const addonSel = document.getElementById('tv-addon-select');
  if (!addonSel) return;
  addonSel.innerHTML = '<option value="">All Addons</option>';
  tvAddons.forEach((a, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = a.manifest.name;
    addonSel.appendChild(opt);
  });
  if (getAllCustomChannels().length) {
    const opt = document.createElement('option');
    opt.value = '__custom__';
    opt.textContent = 'Custom Channels';
    addonSel.appendChild(opt);
  }
}

function onTVAddonChange() {
  const sel = document.getElementById('tv-addon-select');
  const val = sel ? sel.value : '';
  const genreSel = document.getElementById('tv-genre-select');

  if (val === '__custom__') {
    if (genreSel) { genreSel.innerHTML = '<option value="">All Genres</option>'; genreSel.disabled = true; }
    applyTVFilter();
    return;
  }

  const addonIdx = parseInt(val);
  if (!isNaN(addonIdx) && tvAddons[addonIdx]) {
    const addon = tvAddons[addonIdx];
    const genres = new Set();
    (addon.manifest.catalogs || [])
      .filter(c => c.type === 'tv' || c.type === 'channel')
      .forEach(cat => {
        const genreExtra = (cat.extra || []).find(e => e.name === 'genre');
        if (genreExtra && genreExtra.options) {
          genreExtra.options.filter(g => !isCCFilteredGenre(g)).forEach(g => genres.add(g));
        }
      });
    if (genreSel) {
      genreSel.innerHTML = '<option value="">All Genres</option>' +
        Array.from(genres).sort().map(g => `<option value="${esc(g)}">${esc(g)}</option>`).join('');
      genreSel.disabled = false;
    }
  } else if (genreSel) {
    genreSel.innerHTML = '<option value="">All Genres</option>';
    genreSel.disabled = true;
  }
  applyTVFilter();
}

function applyTVFilter() {
  const sel = document.getElementById('tv-addon-select');
  const val = sel ? sel.value : '';
  const genre = document.getElementById('tv-genre-select')?.value || '';
  const q = (document.getElementById('tv-search')?.value || '').toLowerCase();

  // Custom channels mode
  if (val === '__custom__') {
    let channels = getAllCustomChannels().map(ch => ({
      id: ch.id, name: ch.title, logo: ch.thumbnail || '', addonName: 'Custom', addonIdx: -1, genres: []
    }));
    if (q) channels = channels.filter(c => c.name.toLowerCase().includes(q));
    channels.sort((a, b) => a.name.localeCompare(b.name));
    renderTVGrid(channels);
    return;
  }

  const addonIdx = parseInt(val);
  let filtered = ccAllChannels;
  if (!isNaN(addonIdx)) filtered = filtered.filter(c => c.addonIdx === addonIdx);
  if (genre) {
    filtered = filtered.filter(c => c.genres.includes(genre));
  } else {
    filtered = filtered.filter(c => c.genres.some(g => !isCCFilteredGenre(g)));
  }
  if (q) filtered = filtered.filter(c => c.name.toLowerCase().includes(q));
  filtered = [...filtered].sort((a, b) => a.name.localeCompare(b.name));
  renderTVGrid(filtered);
}

function renderTVGrid(channels) {
  const grid = document.getElementById('tv-grid');
  if (!grid) return;
  if (!channels.length) {
    grid.innerHTML = '<div class="empty"><div class="empty-icon">📭</div><div class="empty-text">No channels found.</div></div>';
    return;
  }
  grid.innerHTML = `<div class="poster-grid">${channels.map((ch, i) => {
    const inRow = tempRowItems.some(x => x.id === ch.id);
    return `<div class="poster-card tv${inRow ? ' in-row' : ''}" data-tv-idx="${i}">
      ${ch.logo ? `<img class="pimg" src="${esc(ch.logo)}" loading="lazy" onerror="this.className='pimg-ph';this.textContent='📺'">` : '<div class="pimg-ph">📺</div>'}
      <div class="pbody">
        <div class="ptitle">${esc(ch.name)}</div>
        <div class="pmeta">${esc(ch.addonName)}</div>
      </div>
    </div>`;
  }).join('')}</div>`;

  grid.querySelectorAll('.poster-card').forEach(el => {
    el.addEventListener('click', () => {
      const ch = channels[parseInt(el.dataset.tvIdx)];
      toggleActiveRowItem({ id: ch.id, type: 'tv', title: ch.name, thumbnail: ch.logo || '', description: '' });
    });
  });
}

function filterTVChannels() { applyTVFilter(); }

// ─── Sidebar Auth
let sidebarAuthStatus = null;
async function initSidebarAuth() {
  sidebarAuthStatus = await fetch('/api/stremio/status').then(r => r.json()).catch(() => null);
  const navBtn = document.getElementById('nav-account');
  const modalContent = document.getElementById('account-modal-content');

  const tvOption = document.querySelector('.builder-type-btn[data-type="tv"]');
  if (tvOption) {
    if (sidebarAuthStatus && sidebarAuthStatus.loggedIn) {
      tvOption.disabled = false;
      tvOption.title = '';
      if (navBtn) navBtn.innerHTML = '<span class="nav-icon">👤</span> Account <span style="margin-left:auto; width:6px; height:6px; background:var(--accent); border-radius:50%; box-shadow:0 0 5px var(--accent)"></span>';
    } else {
      tvOption.title = 'Sign in to use TV Channels';
      if (navBtn) navBtn.innerHTML = '<span class="nav-icon">👤</span> Account';
    }
  }

  if (!modalContent) return;
  if (sidebarAuthStatus && sidebarAuthStatus.loggedIn) {
    if (navBtn) navBtn.innerHTML = '<span class="nav-icon">👤</span> Account Linked <span style="margin-left:auto; width:6px; height:6px; background:var(--accent); border-radius:50%; box-shadow:0 0 5px var(--accent)"></span>';
    modalContent.innerHTML = `
      <div class="modal-title">Stremio Account</div>
      <div class="account-card">
        <div class="account-status-badge">
          <span style="width:7px; height:7px; background:var(--accent); border-radius:50%; box-shadow:0 0 5px var(--accent)"></span>
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
    if (navBtn) navBtn.innerHTML = '<span class="nav-icon">👤</span> Link Account';
    modalContent.innerHTML = `
      <div class="modal-title">Connect Stremio Account</div>
      <div style="font-size:11px;color:var(--muted);margin-bottom:14px">Required for TV Channels. Your session is saved so you only need to do this once.</div>
      <div class="form-group"><label class="form-label">Email</label><input class="form-input" id="sl-email" type="email" placeholder="your@email.com" /></div>
      <div class="form-group"><label class="form-label">Password</label><input class="form-input" id="sl-pass" type="password" placeholder="••••••••" onkeydown="if(event.key==='Enter')sidebarDoLogin()" /></div>
      <div class="err-text" id="sl-err"></div>
      <div class="modal-footer" style="justify-content: center;">
        <button class="btn btn-ghost" onclick="closeModal('stremio-login-modal')">Cancel</button>
        <button class="btn btn-primary" id="sl-btn" onclick="sidebarDoLogin()">Connect</button>
      </div>`;
  }
}

async function sidebarDoLogin() {
  const email = document.getElementById('sl-email').value;
  const password = document.getElementById('sl-pass').value;
  const btn = document.getElementById('sl-btn');
  const err = document.getElementById('sl-err');
  if (!email || !password) { err.textContent = 'Email and password required'; err.style.display = 'block'; return; }
  err.style.display = 'none'; btn.textContent = '⏳ Connecting…'; btn.disabled = true;
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

function installStremio() {
  const manifestUrl = location.origin + '/manifest.json';
  if (location.protocol === 'http:') {
    prompt('Local Addons must be pasted into Stremio manually.\n\nCopy this link and paste it into the Stremio search bar to update your rows:', manifestUrl);
  } else {
    window.location.href = manifestUrl.replace('https:', 'stremio:');
  }
}

// ─── Install Tab
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

function collectSettings() {
  config.addon.name = 'StremiRow';
  config.addon.version = config.addon.version || '1.0.0';
  config.addon.description = 'Personal curated rows...';
  config.addon.id = 'com.stremirow.custom';
}

// ─── Custom Channels Panel
function getAllCustomChannels() {
  const channels = [];
  const seen = new Set();
  for (const row of config.rows) {
    for (const item of (row.items || [])) {
      if (item.id && item.id.startsWith('stremirow-') && !seen.has(item.id)) {
        seen.add(item.id);
        channels.push(item);
      }
    }
  }
  return channels;
}

// ─── Inline channel editing state (keyed by channel id) — kept for logo processing helpers

function inlineUpdateName(id, val) {
  // Update in config immediately so save picks it up
  for (const row of config.rows) {
    const item = (row.items || []).find(i => i.id === id);
    if (item) { item.title = val; break; }
  }
}

function startInlineName(id) {
  const safeId = id.replace(/[^a-z0-9-]/gi, '-');
  document.getElementById(`cc-title-${safeId}`).style.display = 'none';
  document.getElementById(`cc-rename-btn-${safeId}`).style.display = 'none';
  const input = document.getElementById(`cc-input-${safeId}`);
  input.style.display = '';
  input.focus(); input.select();
}

function commitInlineName(id) {
  const safeId = id.replace(/[^a-z0-9-]/gi, '-');
  const input = document.getElementById(`cc-input-${safeId}`);
  if (!input || input.style.display === 'none') return;
  const val = input.value.trim() || 'Custom Channel';
  inlineUpdateName(id, val);
  document.getElementById(`cc-title-${safeId}`).textContent = val;
  document.getElementById(`cc-title-${safeId}`).style.display = '';
  document.getElementById(`cc-rename-btn-${safeId}`).style.display = '';
  input.style.display = 'none';
  inlineSaveChannel(id);
}

function cancelInlineName(id) {
  const safeId = id.replace(/[^a-z0-9-]/gi, '-');
  const input = document.getElementById(`cc-input-${safeId}`);
  if (!input) return;
  document.getElementById(`cc-title-${safeId}`).style.display = '';
  document.getElementById(`cc-rename-btn-${safeId}`).style.display = '';
  input.style.display = 'none';
}

function cycleLogoMode(id) {
  const safeId = id.replace(/[^a-z0-9-]/gi, '-');
  const modeInput = document.getElementById(`cc-inline-mode-${safeId}`);
  const current = modeInput ? modeInput.value : 'fit';
  inlineSetLogoMode(id, current === 'fit' ? 'fill' : 'fit');
  const fileInput = document.getElementById(`cc-inline-file-${safeId}`);
  if (fileInput && fileInput.files[0]) inlineProcessLogo(fileInput.files[0], id);
}

function inlineSaveChannel(id) {
  const safeId = id.replace(/[^a-z0-9-]/gi, '-');
  const logoInput = document.getElementById(`cc-inline-logo-${safeId}`);
  const modeInput = document.getElementById(`cc-inline-mode-${safeId}`);
  for (const row of config.rows) {
    const item = (row.items || []).find(i => i.id === id);
    if (item) {
      if (logoInput) item.thumbnail = logoInput.value;
      if (modeInput) item._logoMode = modeInput.value;
      break;
    }
  }
  markDirty();
  renderRows();
}

function inlineOnLogoDrop(e, id) {
  e.preventDefault();
  const safeId = id.replace(/[^a-z0-9-]/gi, '-');
  document.getElementById(`cc-logo-wrap-${safeId}`)?.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) inlineProcessLogo(file, id);
}

function inlineOnLogoFile(e, id) {
  const file = e.target.files[0];
  if (file) inlineProcessLogo(file, id);
}

function inlineSetLogoMode(id, mode) {
  const safeId = id.replace(/[^a-z0-9-]/gi, '-');
  const modeInput = document.getElementById(`cc-inline-mode-${safeId}`);
  if (modeInput) modeInput.value = mode;
  const bar = document.getElementById(`cc-mode-badge-${safeId}`);
  if (bar) bar.querySelectorAll('span').forEach(s => s.className = s.textContent.toLowerCase() === mode ? 'cc-mode-active' : '');
  // Store mode on item
  for (const row of config.rows) {
    const item = (row.items || []).find(i => i.id === id);
    if (item) { item._logoMode = mode; break; }
  }
  // Re-bake from raw source if available
  const rawInput = document.getElementById(`cc-inline-raw-${safeId}`);
  const raw = rawInput ? rawInput.value : null;
  if (raw) {
    applyLogoMode(raw, mode, id);
  }
}

function applyLogoMode(rawDataUrl, mode, id) {
  const safeId = id.replace(/[^a-z0-9-]/gi, '-');
  const img = new Image();
  img.onload = function() {
    const SIZE = 400;
    const canvas = document.createElement('canvas');
    canvas.width = SIZE; canvas.height = SIZE;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#141414';
    ctx.fillRect(0, 0, SIZE, SIZE);
    if (mode === 'fill') {
      const scale = Math.max(SIZE / img.width, SIZE / img.height);
      const w = img.width * scale, h = img.height * scale;
      ctx.drawImage(img, (SIZE - w) / 2, (SIZE - h) / 2, w, h);
    } else {
      const PADDING = 40, maxDim = SIZE - PADDING * 2;
      const scale = Math.min(maxDim / img.width, maxDim / img.height);
      const w = img.width * scale, h = img.height * scale;
      ctx.drawImage(img, (SIZE - w) / 2, (SIZE - h) / 2, w, h);
    }
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    const logoInput = document.getElementById(`cc-inline-logo-${safeId}`);
    if (logoInput) logoInput.value = dataUrl;
    const preview = document.getElementById(`cc-inline-preview-${safeId}`);
    if (preview) { preview.src = dataUrl; preview.style.display = ''; }
    const ph = document.getElementById(`cc-inline-ph-${safeId}`);
    if (ph) ph.style.display = 'none';
    inlineSaveChannel(id);
  };
  img.src = rawDataUrl;
}

function inlineProcessLogo(file, id) {
  const safeId = id.replace(/[^a-z0-9-]/gi, '-');
  const modeInput = document.getElementById(`cc-inline-mode-${safeId}`);
  const mode = modeInput ? modeInput.value : 'fit';
  const reader = new FileReader();
  reader.onload = function(e) {
    const raw = e.target.result;
    // Store raw on item for re-processing after mode toggle or page reload
    for (const row of config.rows) {
      const item = (row.items || []).find(i => i.id === id);
      if (item) { item._rawLogo = raw; break; }
    }
    const rawInput = document.getElementById(`cc-inline-raw-${safeId}`);
    if (rawInput) rawInput.value = raw;
    applyLogoMode(raw, mode, id);
  };
  reader.readAsDataURL(file);
}

function renderCustomChannelsPanel() {
  const el = document.getElementById('custom-channels-list');
  const label = document.getElementById('saved-channels-label');
  if (!el) return;
  const channels = getAllCustomChannels();
  if (label) label.style.display = channels.length ? '' : 'none';
  if (!channels.length) {
    el.innerHTML = '<div class="empty"><div class="empty-icon">📺</div><div class="empty-text">No custom channels yet. Click Auto-Detect or + New Channel.</div></div>';
    return;
  }
  el.innerHTML = `<div class="cc-saved-grid">${channels.map(ch => {
    const safeId = ch.id.replace(/[^a-z0-9-]/gi, '-');
    const srcNames = (ch.sources||[]).map(s=>esc(s.addonName)).join(', ');
    const mode = ch._logoMode || 'fit';
    return `
      <div class="cc-saved-card" id="cc-card-${safeId}" data-id="${esc(ch.id)}" onclick="toggleCCCardSelect(event,'${esc(ch.id)}')">

        <!-- Logo -->
        <div class="cc-saved-logo" id="cc-logo-wrap-${safeId}"
          ondragover="event.preventDefault();this.classList.add('drag-over')"
          ondragleave="this.classList.remove('drag-over')"
          ondrop="event.stopPropagation();inlineOnLogoDrop(event,'${esc(ch.id)}')">
          <img id="cc-inline-preview-${safeId}" src="${esc(ch.thumbnail || '')}" style="width:100%;height:100%;object-fit:${mode === 'fill' ? 'cover' : 'contain'};position:absolute;inset:0;${ch.thumbnail ? '' : 'display:none;'}" />
          <span id="cc-inline-ph-${safeId}" style="font-size:32px;${ch.thumbnail ? 'display:none;' : ''}">📺</span>
          <button class="cc-upload-btn" onclick="event.stopPropagation();document.getElementById('cc-inline-file-${safeId}').click()" title="Upload logo"><span class="material-icons">upload</span></button>
          <div class="cc-logo-mode-bar" id="cc-mode-badge-${safeId}">
            <span class="${mode === 'fit' ? 'cc-mode-active' : ''}" onclick="event.stopPropagation();inlineSetLogoMode('${esc(ch.id)}','fit')">Fit</span>
            <span class="${mode === 'fill' ? 'cc-mode-active' : ''}" onclick="event.stopPropagation();inlineSetLogoMode('${esc(ch.id)}','fill')">Fill</span>
          </div>
        </div>
        <input type="file" id="cc-inline-file-${safeId}" accept="image/*" style="display:none;" onchange="inlineOnLogoFile(event,'${esc(ch.id)}')" />
        <input type="hidden" id="cc-inline-logo-${safeId}" value="${esc(ch.thumbnail || '')}" />
        <input type="hidden" id="cc-inline-mode-${safeId}" value="${mode}" />
        <input type="hidden" id="cc-inline-raw-${safeId}" value="${esc(ch._rawLogo || '')}" />

        <!-- Name row -->
        <div class="cc-saved-name-row" onclick="event.stopPropagation()">
          <span class="cc-saved-title" id="cc-title-${safeId}">${esc(ch.title)}</span>
          <input class="form-input cc-saved-input" id="cc-input-${safeId}" value="${esc(ch.title)}" style="display:none;"
            oninput="inlineUpdateName('${esc(ch.id)}',this.value)"
            onkeydown="if(event.key==='Enter')commitInlineName('${esc(ch.id)}');if(event.key==='Escape')cancelInlineName('${esc(ch.id)}')"
            onblur="commitInlineName('${esc(ch.id)}')" />
          <button class="cc-rename-btn" id="cc-rename-btn-${safeId}" onclick="startInlineName('${esc(ch.id)}')">Rename</button>
        </div>

        <!-- Footer: sources + edit -->
        <div class="cc-saved-footer" onclick="event.stopPropagation()">
          <div class="cc-saved-src" title="${srcNames}">${srcNames || 'No sources'}</div>
          <button class="btn btn-ghost btn-sm cc-sources-btn" onclick="openCustomChannelModalById('${esc(ch.id)}')">Edit Sources</button>
        </div>

      </div>`;
  }).join('')}</div>`;
}

// ─── Auto-Detect
function normaliseName(n) {
  return n.toLowerCase()
    .replace(/\b(fhd|uhd|hd|4k|sd)\b/g, '')
    .replace(/\b(nz|au|uk|us|ca|ie|de|nl|al|se|sg|hk|my)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

async function autoDetectChannels() {
  const btn = document.getElementById('btn-auto-detect');
  const section = document.getElementById('auto-detect-section');
  const list = document.getElementById('auto-detect-list');
  const countEl = document.getElementById('auto-detect-count');
  btn.disabled = true; btn.textContent = '⏳ Scanning…';
  list.innerHTML = '<div class="empty"><div class="empty-icon">⏳</div><div class="empty-text">Fetching channels from all addons…</div></div>';
  section.style.display = '';

  try {
    if (!tvAddons.length) {
      const d = await fetch('/api/stremio/addons').then(r => r.json());
      tvAddons = (d.addons || []).filter(isTvAddon);
    }
    if (!tvAddons.length) {
      list.innerHTML = '<div class="empty"><div class="empty-icon">🔒</div><div class="empty-text">Sign in via Link Account to scan your addons.</div></div>';
      return;
    }

    const addonChannels = {};
    await Promise.all(tvAddons.map(async addon => {
      const baseUrl = addon.transportUrl.replace('/manifest.json', '');
      const cats = (addon.manifest.catalogs || []).filter(c => c.type === 'tv' || c.type === 'channel');
      const urls = [];
      cats.forEach(cat => {
        urls.push(`${baseUrl}/catalog/${cat.type}/${cat.id}.json`);
        const genreExtra = (cat.extra || []).find(e => e.name === 'genre');
        if (genreExtra && genreExtra.options) {
          genreExtra.options.forEach(g => urls.push(`${baseUrl}/catalog/${cat.type}/${cat.id}/genre=${encodeURIComponent(g)}.json`));
        }
      });
      const results = await Promise.all(urls.map(u =>
        fetch(`/api/stremio/proxy-catalog?url=${encodeURIComponent(u)}`).then(r => r.json()).catch(() => ({ metas: [] }))
      ));
      const seen = new Set();
      addonChannels[addon.manifest.name] = [];
      results.forEach(d => (d.metas || []).forEach(m => {
        if (m && m.id && !seen.has(m.id)) {
          seen.add(m.id);
          addonChannels[addon.manifest.name].push({ id: m.id, name: m.name, logo: m.poster || m.logo || '', addonUrl: baseUrl, addonName: addon.manifest.name });
        }
      }));
    }));

    const nameMap = {};
    for (const [addonName, channels] of Object.entries(addonChannels)) {
      for (const ch of channels) {
        const key = normaliseName(ch.name);
        if (!key) continue;
        if (!nameMap[key]) nameMap[key] = [];
        nameMap[key].push({ addonName, channel: ch });
      }
    }

    const existingNames = new Set(getAllCustomChannels().map(c => normaliseName(c.title)));
    const matches = Object.entries(nameMap)
      .filter(([key, entries]) => {
        const addons = new Set(entries.map(e => e.addonName));
        return addons.size >= 2 && !existingNames.has(key);
      })
      .map(([, entries]) => {
        const seenAddons = new Set();
        const sources = [];
        for (const e of entries) {
          if (!seenAddons.has(e.addonName)) {
            seenAddons.add(e.addonName);
            sources.push({ addonName: e.addonName, addonUrl: e.channel.addonUrl, channelId: e.channel.id, channelName: e.channel.name });
          }
        }
        const display = entries[0].channel;
        return { name: display.name, logo: display.logo, sources };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    countEl.textContent = `(${matches.length} found)`;

    if (!matches.length) {
      list.innerHTML = '<div class="empty"><div class="empty-icon">✅</div><div class="empty-text">No new matches — all shared channels already created.</div></div>';
      return;
    }

    list.innerHTML = matches.map((m, i) => `
      <div id="ad-row-${i}" style="background:var(--surf2);border:1px solid var(--border2);border-radius:var(--r);padding:10px 14px;margin-bottom:6px;display:flex;align-items:center;gap:12px;">
        <div style="width:40px;height:40px;border-radius:6px;background:var(--surf3);overflow:hidden;flex-shrink:0;display:flex;align-items:center;justify-content:center;">
          ${m.logo ? `<img src="${esc(m.logo)}" style="width:100%;height:100%;object-fit:contain;" onerror="this.style.display='none'">` : '<span style="font-size:18px;">📺</span>'}
        </div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;font-weight:600;color:var(--text);">${esc(m.name)}</div>
          <div style="font-size:11px;color:var(--muted);margin-top:1px;">${m.sources.map(s => esc(s.addonName)).join(' · ')}</div>
        </div>
        <button class="btn btn-primary btn-sm" onclick='createDetectedChannel(${safeJson(m)}, ${i})'>+ Create</button>
      </div>`).join('');
  } catch (e) {
    list.innerHTML = `<div class="empty"><div class="empty-icon">❌</div><div class="empty-text">${esc(e.message)}</div></div>`;
  } finally {
    btn.disabled = false; btn.textContent = '⚡ Auto-Detect';
  }
}

function createDetectedChannel(match, rowIdx) {
  const id = 'stremirow-' + slugify(match.name) + '-' + Date.now();
  const item = { id, type: 'tv', title: match.name, thumbnail: match.logo || '', description: '', sources: match.sources };
  let ccRow = config.rows.find(r => r.id === 'custom-channels');
  if (!ccRow) { ccRow = { id: 'custom-channels', name: 'Custom Channels', contentType: 'tv', items: [] }; config.rows.push(ccRow); }
  ccRow.items.push(item);
  markDirty();
  renderRows();
  renderCustomChannelsPanel();
  const row = document.getElementById('ad-row-' + rowIdx);
  if (row) { row.style.opacity = '0.3'; row.querySelector('button').textContent = '✓ Created'; row.querySelector('button').disabled = true; }
  toast(`Created: ${match.name}`, 'success');
}

function deleteCustomChannel(id) {
  if (!confirm('Delete this custom channel?')) return;
  for (const row of config.rows) {
    row.items = (row.items || []).filter(i => i.id !== id);
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
  config.rows = config.rows.filter(r => r.id !== 'custom-channels' || (r.items || []).length > 0);
  markDirty();
  renderRows();
  renderCustomChannelsPanel();
  if (document.getElementById('tv-grid')) filterTVChannels();
  toast('All custom channels cleared', 'success');
}

function deleteSelectedCustomChannels() {
  const selected = [...document.querySelectorAll('.cc-saved-card.selected')];
  if (!selected.length) return toast('No channels selected', 'error');
  if (!confirm(`Delete ${selected.length} selected channel${selected.length !== 1 ? 's' : ''}?`)) return;
  const ids = new Set(selected.map(card => card.dataset.id));
  for (const row of config.rows) {
    row.items = (row.items || []).filter(i => !ids.has(i.id));
  }
  config.rows = config.rows.filter(r => r.id !== 'custom-channels' || (r.items || []).length > 0);
  markDirty();
  renderRows();
  renderCustomChannelsPanel();
  if (document.getElementById('tv-grid')) filterTVChannels();
  toast(`Deleted ${ids.size} channel${ids.size !== 1 ? 's' : ''}`, 'success');
}

function toggleCCCardSelect(e, id) {
  const safeId = id.replace(/[^a-z0-9-]/gi, '-');
  const card = document.getElementById(`cc-card-${safeId}`);
  if (!card) return;
  card.classList.toggle('selected');
  card.dataset.id = id;
}

// ─── CC channel filter — exclude non-TV content
const CC_FILTER_GENRES = new Set([
  'radio', 'music', 'podcast', 'podcasts', 'audio', 'soundtracks',
  'music channels', 'radio stations', 'music radio',
  'au iptv radio', 'nz radio',
  'extra: ca | dazn',
  'extra: uk | dazn',
  'extra: uk | spfl',
  'extra: uk | tnt sports',
  'extra: uk | sky sports',
  'extra: int | dirtvision',
  'all tv channels', 'all tv', 'all',
  'traditional channels', 'other channels', 'regional channels', 'ca tv',
  'extra: int | f1 tv',
  'extra: nz | sky sport',
  'extra: uk | epl',
  'extra: int | rugby events',
  'extra: ppv | events',
  'world sports',
]);
const CC_FILTER_PATTERNS = [
  /\bradio\b/i,
  /\bfm\b/i,
  /\b\d{2,3}[\.\s]?\d?\s*fm\b/i,
  /\bam\b/i,
  /\bpodcast/i,
  /\baudio\b/i,
  /\bmusic\b/i,
  /\bsoundtrack/i,
  /\bstation\b/i,
  /tvg-name=/i,
  /tvg-id=/i,
  /tvg-logo=/i,
  /group-title=/i,
];
function isCCFilteredGenre(g) {
  const lower = g.toLowerCase().trim();
  if (CC_FILTER_GENRES.has(lower)) return true;
  // Filter "X TV" for Australian cities except Sydney
  if (/^(melbourne|perth|hobart|brisbane|adelaide|darwin|canberra)\s+tv$/i.test(g.trim())) return true;
  return false;
}
function isCCFiltered(name) {
  if (!name) return true;
  return CC_FILTER_PATTERNS.some(p => p.test(name));
}

// ─── Custom Channel Modal
let ccSources = [];
let ccAllChannels = [];
let ccEditingId = null;
let ccIsNew = false;

function newCustomChannel() {
  const id = 'stremirow-new-' + Date.now();
  const item = { id, type: 'tv', title: 'New Channel', thumbnail: '', description: '', sources: [] };
  let ccRow = config.rows.find(r => r.id === 'custom-channels');
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
  const item = config.rows.flatMap(r => r.items || []).find(i => i.id === id);
  if (item) await openCustomChannelModal(item);
}

function closeCCModal() {
  if (ccIsNew && ccEditingId) {
    // No sources added — remove the placeholder channel
    for (const row of config.rows) {
      row.items = (row.items || []).filter(i => i.id !== ccEditingId);
    }
    config.rows = config.rows.filter(r => r.id !== 'custom-channels' || (r.items || []).length > 0);
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
  if (!ccIsNew) ccIsNew = false; // preserve flag set by newCustomChannel
  ccAllChannels = [];
  const titleEl = document.getElementById('cc-modal-title');
  if (titleEl) titleEl.textContent = existingItem.title || 'Edit Sources';
  renderCCSources();
  document.getElementById('cc-search').value = '';
  openModal('custom-channel-modal');

  // Fetch addons if needed
  if (!tvAddons.length) {
    setCCStatus('Loading addons…');
    try {
      const d = await fetch('/api/stremio/addons').then(r => r.json());
      tvAddons = (d.addons || []).filter(isTvAddon);
    } catch (e) { tvAddons = []; }
  }

  // Populate dropdown
  const sel = document.getElementById('cc-addon-select');
  sel.innerHTML = '<option value="">All Addons</option>';
  tvAddons.forEach((a, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = a.manifest.name;
    sel.appendChild(opt);
  });

  // Genre dropdown starts disabled (no addon selected)
  const genreSel = document.getElementById('cc-genre-select');
  if (genreSel) {
    genreSel.innerHTML = '<option value="">All Genres</option>';
    genreSel.disabled = true;
  }

  // Load all addons progressively
  await loadAllCCChannels();
}

function setCCStatus(msg) {
  const el = document.getElementById('cc-load-status');
  if (el) { el.textContent = msg; el.style.display = msg ? '' : 'none'; }
  // Mirror to TV panel status if open
  const tvEl = document.getElementById('tv-load-status');
  if (tvEl) { tvEl.textContent = msg; tvEl.style.display = msg ? '' : 'none'; }
}

async function loadAllCCChannels() {
  if (!tvAddons.length) {
    renderCCGrid([]);
    setCCStatus('');
    return;
  }

  ccAllChannels = [];
  renderCCGrid([]);
  setCCStatus(`Loading 0 / ${tvAddons.length} addons…`);

  let completed = 0;

  await Promise.all(tvAddons.map(async (addon, addonIdx) => {
    const baseUrl = addon.transportUrl.replace('/manifest.json', '');
    const cats = (addon.manifest.catalogs || []).filter(c => c.type === 'tv' || c.type === 'channel');
    // Build {url, genre} pairs so we can tag each channel with its genre
    const urlPairs = [];
    cats.forEach(cat => {
      const genreExtra = (cat.extra || []).find(e => e.name === 'genre');
      if (genreExtra && genreExtra.options && genreExtra.options.length) {
        genreExtra.options
          .filter(g => !isCCFilteredGenre(g))
          .forEach(g => urlPairs.push({
            url: `${baseUrl}/catalog/${cat.type}/${cat.id}/genre=${encodeURIComponent(g)}.json`,
            genre: g
          }));
      } else {
        urlPairs.push({ url: `${baseUrl}/catalog/${cat.type}/${cat.id}.json`, genre: '' });
      }
    });

    const results = await Promise.all(
      urlPairs.map(p => fetch(`/api/stremio/proxy-catalog?url=${encodeURIComponent(p.url)}`).then(r => r.json()).catch(() => ({ metas: [] })))
    );

    const seen = new Set(ccAllChannels.map(c => c.id + '|' + c.addonUrl + '|' + c.genre));
    results.forEach((d, i) => {
      const genre = urlPairs[i].genre;
      (d.metas || []).forEach(m => {
        const key = m.id + '|' + baseUrl + '|' + genre;
        if (m && m.id && !seen.has(key) && !isCCFiltered(m.name)) {
          seen.add(key);
          // Also track all genres this channel appears under (for filtering)
          const existing = ccAllChannels.find(c => c.id === m.id && c.addonUrl === baseUrl);
          if (existing) {
            existing.genres.push(genre);
          } else {
            ccAllChannels.push({ id: m.id, name: m.name, logo: m.poster || m.logo || '', addonName: addon.manifest.name, addonUrl: baseUrl, addonIdx, genre, genres: [genre] });
          }
        }
      });
    });

    completed++;
    setCCStatus(`Loading ${completed} / ${tvAddons.length} addons… (${ccAllChannels.length} channels)`);

    // Re-render progressively, respecting current dropdown + search filter
    applyCCFilter();
    if (document.getElementById('tv-grid')) applyTVFilter();
  }));

  setCCStatus(`${ccAllChannels.length} channels from ${tvAddons.length} addon${tvAddons.length !== 1 ? 's' : ''}`);
}

function applyCCFilter() {
  const sel = document.getElementById('cc-addon-select');
  const addonIdx = sel ? parseInt(sel.value) : NaN;
  const genre = document.getElementById('cc-genre-select')?.value || '';
  const q = (document.getElementById('cc-search')?.value || '').toLowerCase();
  let filtered = ccAllChannels;
  if (!isNaN(addonIdx)) filtered = filtered.filter(c => c.addonIdx === addonIdx);
  if (genre) {
    filtered = filtered.filter(c => c.genres.includes(genre));
  } else {
    filtered = filtered.filter(c => c.genres.some(g => !isCCFilteredGenre(g)));
  }
  if (q) filtered = filtered.filter(c => c.name.toLowerCase().includes(q));
  filtered = [...filtered].sort((a, b) => a.name.localeCompare(b.name));
  renderCCGrid(filtered);
}

// ─── CC drag state
let ccDragSrcIdx = null;   // index being dragged within sources

function renderCCSources() {
  const el = document.getElementById('cc-sources-list');
  const hint = document.getElementById('cc-sources-hint');
  if (!ccSources.length) {
    el.innerHTML = '<span style="font-size:11px;color:var(--muted);padding:4px 2px;">Click channels below to add sources</span>';
    if (hint) hint.style.display = '';
    el.style.borderColor = 'var(--border2)';
    return;
  }
  if (hint) hint.style.display = 'none';
  el.style.borderColor = 'var(--border2)';
  el.innerHTML = ccSources.map((s, i) => {
    const priority = i === 0 ? 'Primary' : `Backup ${i}`;
    const isPrimary = i === 0;
    return `<div class="cc-source-chip"
      draggable="true"
      ondragstart="onCCChipDragStart(event,${i})"
      ondragover="onCCChipDragOver(event,${i})"
      ondrop="onCCChipDrop(event,${i})"
      ondragend="onCCChipDragEnd()"
      title="Drag to reorder">
      <span class="cc-chip-drag">⠿</span>
      <div class="cc-chip-body">
        <span class="cc-chip-priority${isPrimary ? ' primary' : ''}">${priority}</span>
        <span class="cc-chip-name">${esc(s.addonName)}</span>
      </div>
      <button class="cc-chip-remove" onclick="removeCCSource(${i})" title="Remove">×</button>
    </div>`;
  }).join('');
}

// Chip drag — reorder within sources
function onCCChipDragStart(e, i) {
  ccDragSrcIdx = i;
  ccDragChannel = null;
  e.dataTransfer.effectAllowed = 'move';
  e.currentTarget.style.opacity = '0.4';
}
function onCCChipDragOver(e, i) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
}
function onCCChipDrop(e, targetIdx) {
  e.preventDefault(); e.stopPropagation();
  if (ccDragSrcIdx === null || ccDragSrcIdx === targetIdx) { onCCChipDragEnd(); return; }
  const moved = ccSources.splice(ccDragSrcIdx, 1)[0];
  ccSources.splice(targetIdx, 0, moved);
  ccDragSrcIdx = null;
  renderCCSources();
  renderCCGrid(ccAllChannels.length ? ccAllChannels : []);
}
function onCCChipDragEnd() {
  ccDragSrcIdx = null;
  renderCCSources();
}

function removeCCSource(i) { ccSources.splice(i, 1); renderCCSources(); filterCCChannels(); }

function renderCCGrid(channels) {
  const grid = document.getElementById('cc-grid');
  if (!channels.length) {
    grid.innerHTML = '<div class="empty"><div class="empty-icon">📭</div><div class="empty-text">No channels found.</div></div>';
    return;
  }
  grid.innerHTML = `<div class="poster-grid">${channels.map((ch, i) => {
    const isSource = ccSources.some(s => s.channelId === ch.id && s.addonUrl === ch.addonUrl);
    return `<div class="poster-card tv${isSource ? ' in-row' : ''}" data-ch-idx="${i}">
      ${ch.logo ? `<img class="pimg" src="${esc(ch.logo)}" loading="lazy" onerror="this.className='pimg-ph';this.textContent='📺'">` : '<div class="pimg-ph">📺</div>'}
      <div class="pbody">
        <div class="ptitle">${esc(ch.name)}</div>
        <div class="pmeta">${esc(ch.addonName)}</div>
      </div>
    </div>`;
  }).join('')}</div>`;

  grid.querySelectorAll('.poster-card').forEach(el => {
    el.addEventListener('click', () => {
      const idx = parseInt(el.dataset.chIdx);
      toggleCCSource(channels[idx]);
    });
  });
}

function toggleCCSource(ch) {
  const idx = ccSources.findIndex(s => s.channelId === ch.id && s.addonUrl === ch.addonUrl);
  if (idx >= 0) ccSources.splice(idx, 1);
  else ccSources.push({ addonName: ch.addonName, addonUrl: ch.addonUrl, channelId: ch.id, channelName: ch.name, channelLogo: ch.logo || '' });
  renderCCSources();
  filterCCChannels();
}

async function loadCCAddonChannels() {
  // If channels already loaded, just filter — no re-fetch needed
  if (ccAllChannels.length) { applyCCFilter(); return; }
  // Otherwise trigger a full load (e.g. modal reopened after tvAddons cleared)
  await loadAllCCChannels();
}

function onCCAddonChange() {
  const sel = document.getElementById('cc-addon-select');
  const addonIdx = sel ? parseInt(sel.value) : NaN;
  const genreSel = document.getElementById('cc-genre-select');

  if (!isNaN(addonIdx) && tvAddons[addonIdx]) {
    const addon = tvAddons[addonIdx];
    const genres = new Set();
    (addon.manifest.catalogs || [])
      .filter(c => c.type === 'tv' || c.type === 'channel')
      .forEach(cat => {
        const genreExtra = (cat.extra || []).find(e => e.name === 'genre');
        if (genreExtra && genreExtra.options) {
          genreExtra.options.filter(g => !isCCFilteredGenre(g)).forEach(g => genres.add(g));
        }
      });
    if (genreSel) {
      genreSel.innerHTML = '<option value="">All Genres</option>' +
        Array.from(genres).sort().map(g => `<option value="${esc(g)}">${esc(g)}</option>`).join('');
      genreSel.disabled = false;
    }
  } else if (genreSel) {
    genreSel.innerHTML = '<option value="">All Genres</option>';
    genreSel.disabled = true;
  }

  if (!ccAllChannels.length) {
    loadAllCCChannels();
  } else {
    applyCCFilter();
  }
}

function onCCGenreChange() {
  applyCCFilter();
}

function filterCCChannels() {
  applyCCFilter();
}

function saveCustomChannel() {
  if (!ccEditingId) return;
  if (!ccSources.length) { toast('Add at least one source', 'error'); return; }

  // Patch sources onto the existing item in-place
  for (const row of config.rows) {
    const item = (row.items || []).find(i => i.id === ccEditingId);
    if (item) {
      item.sources = ccSources;
      // Auto-name from primary source's channel name if still on placeholder
      if (!item.title || item.title === 'New Channel') {
        item.title = ccSources[0].channelName || 'Custom Channel';
      }
      // Auto-logo from primary source if no custom logo uploaded
      if (!item.thumbnail && ccSources[0].channelLogo) {
        item.thumbnail = ccSources[0].channelLogo;
      }
      break;
    }
  }

  markDirty();
  renderRows();
  renderCustomChannelsPanel();

  if (document.getElementById('builder-modal').classList.contains('open')) {
    const item = config.rows.flatMap(r => r.items || []).find(i => i.id === ccEditingId);
    if (item) {
      const idx = tempRowItems.findIndex(i => i.id === ccEditingId);
      if (idx >= 0) tempRowItems[idx] = item; else tempRowItems.push(item);
      renderRowItems();
      filterTVChannels();
    }
  }

  ccIsNew = false;
  closeModal('custom-channel-modal');
  toast('Sources saved', 'success');
}

// ─── Sync Stremio
async function syncStremio() {
  const btn = document.getElementById('nav-sync');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="nav-icon">⏳</span> Syncing…'; }
  try {
    const r = await fetch('/api/stremio/sync', { method: 'POST' });
    const d = await r.json();
    if (d.error) throw new Error(d.error);
    toast('Synced to Stremio — restart Stremio to see changes', 'success');
  } catch (e) {
    toast('Sync failed: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<span class="nav-icon">🔄</span> Sync Stremio'; }
  }
}

// ─── Save
async function saveAll() {
  collectSettings();
  const parts = (config.addon.version || '1.0.0').split('.').map(Number);
  parts[2] = (parts[2] || 0) + 1;
  config.addon.version = parts.join('.');

  const statusEl = document.getElementById('save-status');
  if (statusEl) { statusEl.textContent = '⏳ Saving…'; statusEl.style.color = 'var(--soft)'; }
  try {
    const r = await fetch('/api/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config) });
    if (!r.ok) throw new Error('Save failed');
    dirty = false;
    if (statusEl) {
      statusEl.textContent = 'Saved ✓';
      statusEl.style.color = 'var(--accent)';
      setTimeout(() => { if (statusEl.textContent === 'Saved ✓') { statusEl.textContent = ''; statusEl.style.color = ''; } }, 3000);
    }
  } catch (e) {
    if (statusEl) { statusEl.textContent = '❌ Save failed'; statusEl.style.color = 'var(--red)'; }
    toast('Save failed: ' + e.message, 'error');
  }
}

// ─── Init
async function init() {
  if (location.port === '5500') { alert('⚠️ Use http://127.0.0.1:7000/admin instead of Live Server.'); return; }
  try {
    const c = await fetch('/api/config').then(r => r.json());
    config = c;
    renderRows();
    renderInstallTab();
    await initSidebarAuth();
  } catch (e) { toast('Failed to load config: ' + e.message, 'error'); }
}

init();
