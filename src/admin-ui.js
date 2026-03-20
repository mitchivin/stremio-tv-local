'use strict';

const CINEMETA = 'https://v3-cinemeta.strem.io';

// ─── State
let config = { addon: { id: 'com.stremirow.custom', version: '1.0.0', name: 'StremiRow', description: 'Personal curated rows...' }, rows: [] };
let editingRowIdx = -1, tempRowItems = [];
let dirty = false;
let movieType = 'movie', movieResults = [], movieTimer = null;
let tvAddons = [], tvChannels = [];
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

function startEditingRowTitle() {
  const titleEl = document.getElementById('builder-modal-title');
  const editBtn = document.getElementById('builder-title-edit-btn');
  const confirmBtn = document.getElementById('builder-title-confirm-btn');
  const input = document.getElementById('builder-title-input');
  input.value = titleEl.textContent;
  titleEl.style.display = 'none';
  editBtn.style.display = 'none';
  input.style.display = '';
  confirmBtn.style.display = '';
  input.focus(); input.select();
}
function commitRowTitle() {
  const input = document.getElementById('builder-title-input');
  const titleEl = document.getElementById('builder-modal-title');
  const editBtn = document.getElementById('builder-title-edit-btn');
  const confirmBtn = document.getElementById('builder-title-confirm-btn');
  const newName = input.value.trim();
  if (newName) titleEl.textContent = newName;
  input.style.display = 'none';
  confirmBtn.style.display = 'none';
  titleEl.style.display = '';
  editBtn.style.display = '';
}
function cancelEditRowTitle() {
  const input = document.getElementById('builder-title-input');
  const titleEl = document.getElementById('builder-modal-title');
  const editBtn = document.getElementById('builder-title-edit-btn');
  const confirmBtn = document.getElementById('builder-title-confirm-btn');
  input.style.display = 'none';
  confirmBtn.style.display = 'none';
  titleEl.style.display = '';
  editBtn.style.display = '';
}

function openBuilderModal(idx = -1) {
  editingRowIdx = idx;
  const isNew = idx < 0;
  const row = isNew ? { id: '', name: '', items: [], contentType: 'movie' } : config.rows[idx];
  let rowType = row.contentType || 'movie';

  if (rowType === 'tv' && (!sidebarAuthStatus || !sidebarAuthStatus.loggedIn)) {
    toast('Sign in to view TV channels', 'error');
  }

  const typeSelect = document.getElementById('row-type');
  const typeBadge = document.getElementById('row-type-badge');
  const TYPE_LABELS = { movie: 'Movie', series: 'Series', tv: 'TV Channels' };

  if (isNew) {
    typeSelect.style.display = '';
    typeBadge.style.display = 'none';
  } else {
    typeSelect.style.display = 'none';
    typeBadge.textContent = TYPE_LABELS[rowType] || rowType;
    typeBadge.style.display = '';
  }

  document.getElementById('builder-modal-title').textContent = row.name || 'New Row';
  document.getElementById('builder-modal-title').style.display = '';
  document.getElementById('builder-title-edit-btn').style.display = '';
  document.getElementById('builder-title-input').style.display = 'none';
  document.getElementById('builder-title-confirm-btn').style.display = 'none';
  typeSelect.value = rowType;
  tempRowItems = [...(row.items || [])];
  renderRowItems();
  onBuilderTypeChange();
  openModal('builder-modal');
}

function closeBuilderModal() {
  closeModal('builder-modal');
}

function onBuilderTypeChange() {
  const typeEl = document.getElementById('row-type');
  const type = typeEl.value;

  if (tempRowItems.length > 0) {
    const row = editingRowIdx >= 0 ? config.rows[editingRowIdx] : null;
    const oldType = row ? (row.contentType || 'movie') : 'movie';
    if (type !== oldType) {
      if (!confirm(`Changing the row type to "${type}" will clear all existing items in this row. Are you sure?`)) {
        typeEl.value = oldType;
        return;
      }
      tempRowItems = [];
      renderRowItems();
      toast('Row items cleared for new type', 'success');
    }
  }

  const dMovies = document.getElementById('discovery-movies');
  const dTv = document.getElementById('discovery-tv');
  const movieTitle = document.getElementById('movie-pane-title');
  const movieSearch = document.getElementById('movie-search');

  if (type === 'movie' || type === 'series') {
    dMovies.style.display = 'flex';
    dTv.style.display = 'none';
    if (movieTitle && movieSearch) {
      movieTitle.textContent = type === 'movie' ? 'Movies' : 'Series';
      movieSearch.placeholder = type === 'movie' ? 'Search movies...' : 'Search series...';
    }
    setMovieType(type);
  } else {
    dTv.style.display = 'flex';
    dMovies.style.display = 'none';
    updateTVPanel();
  }
}

function renderRowItems() {
  const el = document.getElementById('row-items-list');
  if (!tempRowItems.length) { el.innerHTML = '<div style="font-size:11px;color:var(--muted);padding:8px;text-align:center">No items yet. Add from Movies or TV Channels.</div>'; return; }
  el.innerHTML = tempRowItems.map((s, i) => `
  <div class="rei" draggable="true" ondragstart="onDragStartRowItem(event, ${i})" ondragover="onDragOverRowItem(event)" ondrop="onDropRowItem(event, ${i})">
    <div class="rei-thumb">${s.thumbnail ? `<img src="${esc(s.thumbnail)}" onerror="this.style.display='none'">` : '📺'}</div>
    <div class="rei-info"><div class="rei-title">${esc(s.title)}</div></div>
    <div class="drag-handle" style="cursor:grab; padding:0 6px; color:var(--muted); font-size:14px">☰</div>
    <div class="rei-actions">
      <button class="btn btn-danger btn-icon" onclick="removeItem(${i})">×</button>
    </div>
  </div>`).join('');
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
  e.target.closest('.rei').style.opacity = '1';
  if (dragRowItemIdx === null || dragRowItemIdx === targetIdx) return;
  const item = tempRowItems.splice(dragRowItemIdx, 1)[0];
  tempRowItems.splice(targetIdx, 0, item);
  dragRowItemIdx = null;
  renderRowItems();
}

function toggleActiveRowItem(item) {
  if (editingRowIdx < -1) return;
  const type = document.getElementById('row-type').value;
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
  const type = document.getElementById('row-type').value;
  if (type === 'movie' || type === 'series') renderMovieGrid();
  else filterTVChannels();
}

function saveActiveRow() {
  commitRowTitle();
  const name = document.getElementById('builder-modal-title').textContent.trim();
  if (!name || name === 'New Row') { toast('Please set a row name first (click ✏ to edit)', 'error'); startEditingRowTitle(); return; }
  const contentType = document.getElementById('row-type').value;
  const rowId = editingRowIdx >= 0 ? config.rows[editingRowIdx].id : (slugify(name) || 'row-' + Date.now());
  const row = { id: rowId, name, contentType, items: tempRowItems };
  if (editingRowIdx >= 0) config.rows[editingRowIdx] = row; else config.rows.push(row);
  closeBuilderModal(); markDirty(); renderRows();
}
function deleteRow(i) {
  if (!confirm(`Delete row "${config.rows[i].name}"?`)) return;
  config.rows.splice(i, 1); markDirty(); renderRows();
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
      ${inActiveRow ? '<div class="pmeta green">✓ Added</div>' : ''}
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
  body.innerHTML = `<div class="empty" style="margin: auto; width: 100%; height: 100%; display: flex; flex-direction: column; justify-content: center; align-items: center;">
    <div class="empty-icon">⏳</div>
    <div class="empty-text" style="font-size: 16px;">Loading IPTV Channels...</div>
  </div>`;
  const auth = await fetch('/api/stremio/status').then(r => r.json()).catch(() => null);
  if (!auth || !auth.loggedIn) {
    body.innerHTML = `<div class="empty" style="margin: auto; width: 100%; height: 100%; display: flex; flex-direction: column; justify-content: center; align-items: center;">
      <div class="empty-icon">🔒</div>
      <div class="empty-text" style="font-size: 16px; margin-bottom: 12px;">Sign in to browse TV Channels</div>
      <button class="btn btn-primary" onclick="openModal('stremio-login-modal')">Connect Stremio Account</button>
    </div>`;
    return;
  }
  await loadTVAddons(auth, body);
}

async function loadTVAddons(auth, body) {
  try {
    const resp = await fetch('/api/stremio/addons');
    if (resp.status === 401) {
      body.innerHTML = '<div class="empty"><div class="empty-icon">🔒</div><div class="empty-text">Session expired. Please <a href="#" onclick="openModal(\'stremio-login-modal\');initSidebarAuth();return false;">sign in again</a>.</div></div>';
      await initSidebarAuth();
      return;
    }
    const d = await resp.json();
    tvAddons = (d.addons || []).filter(isTvAddon);
    if (!tvAddons.length) { body.innerHTML = '<div class="empty"><div class="empty-icon">📡</div><div class="empty-text">No IPTV or TV addons found in your Stremio account.</div></div>'; return; }

    body.innerHTML = `
    <div class="toolbar">
      <div class="search-wrap"><span class="search-icon">🔍</span><input class="search-input" id="tv-search" type="search" placeholder="Search channels…" oninput="filterTVChannels()"/></div>
      <select class="form-input" id="tv-genre" style="width: auto; padding: 7px 30px 7px 10px; cursor: pointer" onchange="onTvGenreChange()">
        <option value="all">All Channels</option>
      </select>
    </div>
    <div class="poster-grid" id="tv-grid"><div class="empty" style="grid-column:1/-1"><div class="empty-icon">⏳</div><div class="empty-text">Loading channels…</div></div></div>`;

    // Populate genre dropdown from all addons
    const genreSelect = document.getElementById('tv-genre');
    if (genreSelect) {
      const genres = new Set();
      tvAddons.forEach(addon => {
        (addon.manifest.catalogs || []).forEach(cat => {
          if (cat.type === 'tv' || cat.type === 'channel') {
            (cat.extra || []).forEach(e => {
              if (e.name === 'genre' && e.options) {
                e.options.forEach(g => {
                  const gl = g.toLowerCase();
                  const hidden = ['all tv channels', 'all tv', 'all', 'epl', 'other channels', 'regional channels', 'traditional channels', 'ca tv'];
                  const cities = ['sydney', 'melbourne', 'brisbane', 'adelaide', 'perth', 'canberra', 'hobart', 'darwin'];
                  if (!hidden.includes(gl) && !cities.some(c => gl.startsWith(c))) genres.add(g);
                });
              }
            });
          }
        });
      });

      let h = '<option value="all">All Channels</option><option value="__custom__">Custom Channels</option>';
      Array.from(genres).sort((a, b) => {
        const al = a.toLowerCase(), bl = b.toLowerCase();
        const getRank = (s, isEx) => {
          if (isEx) return 5;
          if (s.includes('sport')) return 1;
          if (s.includes('tv')) return 2;
          if (s.includes('radio')) return 3;
          return 4;
        };
        const aRank = getRank(al, al.startsWith('extra'));
        const bRank = getRank(bl, bl.startsWith('extra'));
        if (aRank !== bRank) return aRank - bRank;
        return a.localeCompare(b);
      }).forEach(g => { h += `<option value="${esc(g)}">${esc(g)}</option>`; });
      genreSelect.innerHTML = h;
      genreSelect.value = 'all';
    }

    fetchTvChannels();
  } catch (e) { body.innerHTML = `<div class="empty"><div class="empty-icon">❌</div><div class="empty-text">${esc(e.message)}</div></div>`; }
}

function onTvGenreChange() {
  const genre = document.getElementById('tv-genre')?.value;
  if (genre === '__custom__') {
    tvChannels = getAllCustomChannels();
    renderTVGrid(tvChannels);
  } else {
    fetchTvChannels();
  }
}

async function fetchTvChannels() {
  const grid = document.getElementById('tv-grid');
  const genre = document.getElementById('tv-genre')?.value || 'all';
  if (!grid) return;
  grid.innerHTML = '<div class="empty" style="grid-column:1/-1"><div class="empty-icon">⏳</div><div class="empty-text">Loading items from all addons…</div></div>';

  try {
    const urlsToFetch = [];
    tvAddons.forEach(addon => {
      const cats = (addon.manifest.catalogs || []).filter(c => c.type === 'tv' || c.type === 'channel');
      const baseUrl = addon.transportUrl.replace('/manifest.json', '');
      if (genre === 'all') {
        cats.forEach(cat => {
          urlsToFetch.push(`${baseUrl}/catalog/${cat.type}/${cat.id}.json`);
          const genreExtra = (cat.extra || []).find(e => e.name === 'genre');
          if (genreExtra && genreExtra.options) {
            genreExtra.options.forEach(g => urlsToFetch.push(`${baseUrl}/catalog/${cat.type}/${cat.id}/genre=${encodeURIComponent(g)}.json`));
          }
        });
      } else {
        cats.forEach(cat => {
          const genreExtra = (cat.extra || []).find(e => e.name === 'genre');
          if (genreExtra && genreExtra.options && genreExtra.options.includes(genre)) {
            urlsToFetch.push(`${baseUrl}/catalog/${cat.type}/${cat.id}/genre=${encodeURIComponent(genre)}.json`);
          }
        });
      }
    });

    if (!urlsToFetch.length && genre !== 'all') {
      tvAddons.forEach(addon => {
        const cats = (addon.manifest.catalogs || []).filter(c => c.type === 'tv' || c.type === 'channel');
        const baseUrl = addon.transportUrl.replace('/manifest.json', '');
        cats.forEach(cat => urlsToFetch.push(`${baseUrl}/catalog/${cat.type}/${cat.id}.json`));
      });
    }

    if (!urlsToFetch.length) { grid.innerHTML = '<div class="empty" style="grid-column:1/-1"><div class="empty-icon">📭</div><div class="empty-text">No channels found.</div></div>'; return; }

    const results = await Promise.all(urlsToFetch.map(url =>
      fetch(`/api/stremio/proxy-catalog?url=${encodeURIComponent(url)}`).then(r => r.json()).catch(() => ({ metas: [] }))
    ));

    const allMetas = [];
    const seen = new Set();
    results.forEach(d => {
      if (d && d.metas) {
        d.metas.forEach(m => {
          if (m && m.id && !seen.has(m.id)) { seen.add(m.id); allMetas.push(m); }
        });
      }
    });

    tvChannels = allMetas.map(m => ({ id: m.id, type: 'tv', title: m.name, thumbnail: m.poster || m.logo || m.background || '', description: m.description || '' }));
    renderTVGrid(tvChannels);
  } catch (e) { if (grid) grid.innerHTML = `<div class="empty" style="grid-column:1/-1"><div class="empty-icon">❌</div><div class="empty-text">${esc(e.message)}</div></div>`; }
}

function filterTVChannels() {
  const q = (document.getElementById('tv-search')?.value || '').toLowerCase();
  renderTVGrid(q ? tvChannels.filter(c => c.title.toLowerCase().includes(q)) : tvChannels);
}

function renderTVGrid(channels) {
  const grid = document.getElementById('tv-grid');
  if (!grid) return;
  if (!channels.length) { grid.innerHTML = '<div class="empty" style="grid-column:1/-1"><div class="empty-icon">📭</div><div class="empty-text">No channels found.</div></div>'; return; }
  grid.innerHTML = channels.map(item => {
    const inActiveRow = tempRowItems.some(i => i.id === item.id);
    return `<div class="poster-card tv${inActiveRow ? ' in-row' : ''}" onclick='toggleActiveRowItem(${safeJson(item)})'>
    ${item.thumbnail ? `<img class="pimg" src="${esc(item.thumbnail)}" loading="lazy" onerror="this.className='pimg-ph';this.textContent='📺'">` : '<div class="pimg-ph">📺</div>'}
    <div class="pbody">
      <div class="ptitle">${esc(item.title)}</div>
      ${inActiveRow ? '<div class="pmeta green">✓ Added</div>' : ''}
    </div>
  </div>`;
  }).join('');
}

// ─── Sidebar Auth
let sidebarAuthStatus = null;
async function initSidebarAuth() {
  sidebarAuthStatus = await fetch('/api/stremio/status').then(r => r.json()).catch(() => null);
  const navBtn = document.getElementById('nav-account');
  const modalContent = document.getElementById('account-modal-content');

  const tvOption = document.querySelector('#row-type option[value="tv"]');
  if (tvOption) {
    if (sidebarAuthStatus && sidebarAuthStatus.loggedIn) {
      tvOption.disabled = false;
      tvOption.textContent = 'TV Channels';
      if (navBtn) navBtn.innerHTML = '<span class="nav-icon">👤</span> Account <span style="margin-left:auto; width:6px; height:6px; background:var(--accent); border-radius:50%; box-shadow:0 0 5px var(--accent)"></span>';
    } else {
      tvOption.disabled = true;
      tvOption.textContent = 'TV Channels (Sign in)';
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
  el.innerHTML = channels.map(ch => `
    <div style="background:var(--surf2);border:1px solid var(--border2);border-radius:var(--r);padding:12px 14px;margin-bottom:8px;display:flex;align-items:center;gap:12px;">
      <div style="width:44px;height:44px;border-radius:6px;background:var(--surf3);overflow:hidden;flex-shrink:0;display:flex;align-items:center;justify-content:center;">
        ${ch.thumbnail ? `<img src="${esc(ch.thumbnail)}" style="width:100%;height:100%;object-fit:contain;" onerror="this.style.display='none'">` : '<span style="font-size:20px;">📺</span>'}
      </div>
      <div style="flex:1;min-width:0;">
        <div style="font-size:13px;font-weight:700;color:var(--text);">${esc(ch.title)}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:2px;">${(ch.sources||[]).length} source${(ch.sources||[]).length !== 1 ? 's' : ''}: ${(ch.sources||[]).map(s=>esc(s.addonName)).join(', ')}</div>
      </div>
      <div style="display:flex;gap:6px;">
        <button class="btn btn-ghost btn-sm" onclick='openCustomChannelModal(${safeJson(ch)})'>✏ Edit</button>
        <button class="btn btn-danger btn-sm" onclick="deleteCustomChannel('${esc(ch.id)}')">🗑</button>
      </div>
    </div>`).join('');
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

// ─── Custom Channel Modal
let ccSources = [];
let ccAllChannels = [];
let ccEditingId = null;
let logoMode = 'fit';

async function openCustomChannelModal(existingItem) {
  ccSources = existingItem ? JSON.parse(JSON.stringify(existingItem.sources || [])) : [];
  ccEditingId = existingItem ? existingItem.id : null;
  document.getElementById('cc-name').value = existingItem ? existingItem.title : '';
  document.getElementById('cc-logo').value = existingItem ? (existingItem.thumbnail || '') : '';
  document.getElementById('cc-logo-file').value = '';
  logoMode = 'fit';
  setLogoMode('fit');
  updateCCPreview();
  renderCCSources();
  document.getElementById('cc-grid').innerHTML = '<div class="empty" style="grid-column:1/-1"><div class="empty-icon">📡</div><div class="empty-text">Select an addon above.</div></div>';
  document.getElementById('cc-search').value = '';
  openModal('custom-channel-modal');

  if (!tvAddons.length) {
    const sel = document.getElementById('cc-addon-select');
    sel.innerHTML = '<option value="">Loading addons…</option>';
    try {
      const d = await fetch('/api/stremio/addons').then(r => r.json());
      tvAddons = (d.addons || []).filter(isTvAddon);
    } catch (e) { tvAddons = []; }
  }

  const sel = document.getElementById('cc-addon-select');
  sel.innerHTML = '<option value="">Select an addon…</option>';
  tvAddons.forEach((a, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = a.manifest.name;
    sel.appendChild(opt);
  });
}

function updateCCPreview() {
  const url = document.getElementById('cc-logo').value.trim();
  const img = document.getElementById('cc-logo-preview');
  const ph = document.getElementById('cc-logo-ph');
  const clearBtn = document.getElementById('cc-logo-clear-btn');
  const dropzone = document.getElementById('cc-logo-dropzone');
  if (url) {
    img.src = url; img.style.display = ''; ph.style.display = 'none';
    if (clearBtn) clearBtn.style.display = '';
    if (dropzone) dropzone.style.borderStyle = 'solid';
  } else {
    img.style.display = 'none'; ph.style.display = '';
    if (clearBtn) clearBtn.style.display = 'none';
    if (dropzone) dropzone.style.borderStyle = 'dashed';
  }
}

function clearLogoPreview() {
  document.getElementById('cc-logo').value = '';
  document.getElementById('cc-logo-file').value = '';
  updateCCPreview();
}

function onLogoDrop(e) {
  e.preventDefault();
  document.getElementById('cc-logo-dropzone').style.borderColor = 'var(--border2)';
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) processLogoFile(file);
}

function onLogoFileChange(e) {
  const file = e.target.files[0];
  if (file) processLogoFile(file);
}

function setLogoMode(mode) {
  logoMode = mode;
  const fitBtn = document.getElementById('logo-mode-fit');
  const fillBtn = document.getElementById('logo-mode-fill');
  if (fitBtn) {
    fitBtn.className = 'btn btn-sm' + (mode === 'fit' ? '' : ' btn-ghost');
    fitBtn.style.cssText = mode === 'fit' ? 'flex:1;background:var(--accent-dim);color:var(--accent);border:1px solid rgba(16,185,129,.3);' : 'flex:1;';
  }
  if (fillBtn) {
    fillBtn.className = 'btn btn-sm' + (mode === 'fill' ? '' : ' btn-ghost');
    fillBtn.style.cssText = mode === 'fill' ? 'flex:1;background:var(--accent-dim);color:var(--accent);border:1px solid rgba(16,185,129,.3);' : 'flex:1;';
  }
  // Re-process if a file is already loaded
  const file = document.getElementById('cc-logo-file').files[0];
  if (file) processLogoFile(file);
}

function processLogoFile(file) {
  const reader = new FileReader();
  reader.onload = function(e) {
    const img = new Image();
    img.onload = function() {
      // Stremio renders poster with object-fit:cover (fills/crops the square)
      // Fit mode: bake padding into image so logo isn't cropped
      // Fill mode: crop/scale image to fill the full square
      const SIZE = 400;
      const canvas = document.createElement('canvas');
      canvas.width = SIZE; canvas.height = SIZE;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#141414';
      ctx.fillRect(0, 0, SIZE, SIZE);
      if (logoMode === 'fill') {
        const scale = Math.max(SIZE / img.width, SIZE / img.height);
        const w = img.width * scale, h = img.height * scale;
        const x = (SIZE - w) / 2, y = (SIZE - h) / 2;
        ctx.drawImage(img, x, y, w, h);
      } else {
        const PADDING = 40;
        const maxDim = SIZE - PADDING * 2;
        const scale = Math.min(maxDim / img.width, maxDim / img.height);
        const w = img.width * scale, h = img.height * scale;
        const x = (SIZE - w) / 2, y = (SIZE - h) / 2;
        ctx.drawImage(img, x, y, w, h);
      }
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      document.getElementById('cc-logo').value = dataUrl;
      updateCCPreview();
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function renderCCSources() {
  const el = document.getElementById('cc-sources-list');
  if (!ccSources.length) { el.innerHTML = '<div style="font-size:11px;color:var(--muted);">No sources yet. Browse addons on the right.</div>'; return; }
  el.innerHTML = ccSources.map((s, i) => `
    <div class="rei" style="flex-direction:column;align-items:stretch;gap:5px;">
      <div style="display:flex;align-items:center;gap:9px;">
        <div class="rei-info">
          <div class="rei-title">${esc(s.channelName)}</div>
          <div style="font-size:10px;color:var(--muted);margin-top:1px;">${esc(s.addonName)}</div>
        </div>
        <div class="rei-actions">
          <button class="btn btn-danger btn-icon" onclick="removeCCSource(${i})">×</button>
        </div>
      </div>
      <div style="display:flex;gap:5px;">
        <input class="form-input" style="font-size:11px;padding:4px 7px;flex:1;" placeholder="Addon label (e.g. A1X)" value="${esc(s.label || '')}" oninput="ccSources[${i}].label=this.value" title="Left column in Stremio streams" />
        <input class="form-input" style="font-size:11px;padding:4px 7px;flex:1;" placeholder="Stream title (e.g. Fox League)" value="${esc(s.streamTitle || '')}" oninput="ccSources[${i}].streamTitle=this.value" title="Right column in Stremio streams" />
      </div>
    </div>`).join('');
}

function removeCCSource(i) { ccSources.splice(i, 1); renderCCSources(); renderCCGrid(ccAllChannels); }

async function loadCCAddonChannels() {
  const sel = document.getElementById('cc-addon-select');
  const idx = parseInt(sel.value);
  const grid = document.getElementById('cc-grid');
  if (isNaN(idx)) { grid.innerHTML = '<div class="empty" style="grid-column:1/-1"><div class="empty-icon">📡</div><div class="empty-text">Select an addon above.</div></div>'; return; }
  const addon = tvAddons[idx];
  grid.innerHTML = '<div class="empty" style="grid-column:1/-1"><div class="empty-icon">⏳</div><div class="empty-text">Loading…</div></div>';
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
  try {
    const results = await Promise.all(urls.map(u => fetch(`/api/stremio/proxy-catalog?url=${encodeURIComponent(u)}`).then(r => r.json()).catch(() => ({ metas: [] }))));
    const seen = new Set();
    ccAllChannels = [];
    results.forEach(d => (d.metas || []).forEach(m => {
      if (m && m.id && !seen.has(m.id)) { seen.add(m.id); ccAllChannels.push({ id: m.id, name: m.name, logo: m.poster || m.logo || '', addonName: addon.manifest.name, addonUrl: baseUrl }); }
    }));
    document.getElementById('cc-search').value = '';
    renderCCGrid(ccAllChannels);
  } catch (e) { grid.innerHTML = `<div class="empty" style="grid-column:1/-1"><div class="empty-icon">❌</div><div class="empty-text">${esc(e.message)}</div></div>`; }
}

function filterCCChannels() {
  const q = document.getElementById('cc-search').value.toLowerCase();
  renderCCGrid(q ? ccAllChannels.filter(c => c.name.toLowerCase().includes(q)) : ccAllChannels);
}

function renderCCGrid(channels) {
  const grid = document.getElementById('cc-grid');
  if (!channels.length) { grid.innerHTML = '<div class="empty" style="grid-column:1/-1"><div class="empty-icon">📭</div><div class="empty-text">No channels found.</div></div>'; return; }
  grid.innerHTML = channels.map(ch => {
    const isSource = ccSources.some(s => s.channelId === ch.id && s.addonUrl === ch.addonUrl);
    return `<div class="poster-card tv${isSource ? ' in-row' : ''}" onclick='toggleCCSource(${safeJson(ch)})'>
      ${ch.logo ? `<img class="pimg" src="${esc(ch.logo)}" loading="lazy" onerror="this.className='pimg-ph';this.textContent='📺'">` : '<div class="pimg-ph">📺</div>'}
      <div class="pbody">
        <div class="ptitle">${esc(ch.name)}</div>
        ${isSource ? '<div class="pmeta green">✓ Source</div>' : ''}
      </div>
    </div>`;
  }).join('');
}

function toggleCCSource(ch) {
  const idx = ccSources.findIndex(s => s.channelId === ch.id && s.addonUrl === ch.addonUrl);
  if (idx >= 0) ccSources.splice(idx, 1);
  else ccSources.push({ addonName: ch.addonName, addonUrl: ch.addonUrl, channelId: ch.id, channelName: ch.name });
  renderCCSources();
  renderCCGrid(ccAllChannels);
}

function saveCustomChannel() {
  const name = document.getElementById('cc-name').value.trim();
  if (!name) { toast('Channel name is required', 'error'); return; }
  if (!ccSources.length) { toast('Add at least one source', 'error'); return; }
  const logo = document.getElementById('cc-logo').value.trim();
  const id = ccEditingId || ('stremirow-' + slugify(name) + '-' + Date.now());
  const item = { id, type: 'tv', title: name, thumbnail: logo, description: '', sources: ccSources };

  let ccRow = config.rows.find(r => r.id === 'custom-channels');
  if (!ccRow) {
    ccRow = { id: 'custom-channels', name: 'Custom Channels', contentType: 'tv', items: [] };
    config.rows.push(ccRow);
  }
  const existingIdx = ccRow.items.findIndex(i => i.id === id);
  if (existingIdx >= 0) ccRow.items[existingIdx] = item; else ccRow.items.push(item);
  markDirty();
  renderRows();
  renderCustomChannelsPanel();

  if (document.getElementById('builder-modal').classList.contains('open')) {
    const existing = tempRowItems.findIndex(i => i.id === id);
    if (existing >= 0) tempRowItems[existing] = item; else tempRowItems.push(item);
    renderRowItems();
    filterTVChannels();
  }

  closeModal('custom-channel-modal');
  toast('Custom channel saved', 'success');
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
