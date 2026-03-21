// ─── TV Channel State
let ccSources = [];
let ccAllChannels = [];
let ccDetectedMatches = [];
let ccEditingId = null;
let ccIsNew = false;

// ─── Auto-Detect
function normaliseName(n) {
  return n.toLowerCase()
    .replace(/\b(fhd|uhd|hd|4k|sd)\b/g, '')
    .replace(/\b(nz|au|uk|us|ca|ie|de|nl|al|se|sg|hk|my)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// ─── CC channel filter
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
  if (/^(melbourne|perth|hobart|brisbane|adelaide|darwin|canberra)\s+tv$/i.test(g.trim())) return true;
  return false;
}
function isCCFiltered(name) {
  if (!name) return true;
  return CC_FILTER_PATTERNS.some(p => p.test(name));
}

async function updateTVPanel() {
  const body = document.getElementById('tv-body');
  if (!body) return;

  const toolbar = document.getElementById('builder-toolbar-tv');
  if (toolbar) {
    toolbar.style.display = 'flex';
    toolbar.innerHTML = `
      <div class="search-wrapper">
        <span class="material-icons search-icon">search</span>
        <input class="search-input" id="tv-search" type="search" placeholder="Search channels…" oninput="applyTVFilter()"/>
      </div>
      <select class="form-select" id="tv-addon-select" onchange="onTVAddonChange()">
        <option value="">All Addons</option>
      </select>
      <select class="form-select" id="tv-genre-select" onchange="applyTVFilter()" disabled>
        <option value="">All Genres</option>
      </select>`;
  }
  body.innerHTML = '<div class="cc-status" id="tv-load-status"></div><div id="tv-grid"></div>';
  setCCStatus('Checking account…');

  if (ccAllChannels.length && tvAddons.length) {
    populateTVAddonDropdown();
    applyTVFilter();
    setCCStatus(`${ccAllChannels.length} channels from ${tvAddons.length} addon${tvAddons.length !== 1 ? 's' : ''}`);
    return;
  }

  const auth = await fetch(`/api/stremio/status${getUserParam()}`).then(r => r.json()).catch(() => null);
  if (!auth || !auth.loggedIn) {
    body.innerHTML = `<div class="empty" style="padding:40px 0;text-align:center;">
      <div class="empty-icon"><span class="material-icons" style="font-size:48px;color:var(--color-text-disabled);">lock</span></div>
      <div class="empty-text" style="margin-bottom:12px;">Sign in to browse TV Channels</div>
      <button class="btn btn-primary" onclick="openModal('stremio-login-modal')">Connect Stremio Account</button>
    </div>`;
    if (toolbar) toolbar.style.display = 'none';
    return;
  }

  if (!tvAddons.length) {
    setCCStatus('Loading addons…');
    try {
      const resp = await fetch(`/api/stremio/addons${getUserParam()}`);
      if (resp.status === 401) {
        body.innerHTML = '<div class="empty"><div class="empty-icon"><span class="material-icons" style="font-size:48px;color:var(--color-text-disabled);">lock</span></div><div class="empty-text">Session expired. Please sign in again.</div></div>';
        if (toolbar) toolbar.style.display = 'none';
        return;
      }
      const d = await resp.json();
      tvAddons = (d.addons || []).filter(isTvAddon);
    } catch (e) {
      setCCStatus('');
      body.innerHTML = `<div class="empty"><div class="empty-icon"><span class="material-icons" style="font-size:48px;color:var(--color-error);">error</span></div><div class="empty-text">${esc(e.message)}</div></div>`;
      return;
    }
  }

  if (!tvAddons.length) {
    body.innerHTML = '<div class="empty"><div class="empty-icon"><span class="material-icons" style="font-size:48px;color:var(--color-text-disabled);">signal_cellular_connected_no_internet_0_bar</span></div><div class="empty-text">No IPTV or TV addons found.</div></div>';
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
  
  // Always show Custom Channels option if any exist (in rows OR orphans)
  const allCustomChannels = [
    ...config.rows.flatMap(r => (r.items || []).filter(i => i.id && i.id.startsWith('stremirow-'))),
    ...(window._orphanCustomChannels || [])
  ];
  const uniqueCustomChannels = [...new Map(allCustomChannels.map(ch => [ch.id, ch])).values()];
  
  if (uniqueCustomChannels.length) {
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
    grid.innerHTML = '<div class="empty"><div class="empty-icon"><span class="material-icons" style="font-size:48px;color:var(--color-text-disabled);">inbox</span></div><div class="empty-text">No channels found.</div></div>';
    return;
  }
  grid.innerHTML = `<div class="poster-grid">${channels.map((ch, i) => {
    const inRow = tempRowItems.some(x => x.id === ch.id);
    return `<div class="poster-card tv${inRow ? ' active' : ''}" data-tv-idx="${i}">
      ${ch.logo ? `<img class="poster-image" src="${esc(ch.logo)}" loading="lazy" onerror="this.outerHTML='<div class=\\'poster-image\\' style=\\'display:flex;align-items:center;justify-content:center;\\'><span class=\\'material-icons\\' style=\\'font-size:32px;color:var(--color-text-disabled);\\'>live_tv</span></div>'">` : '<div class="poster-image" style="display:flex;align-items:center;justify-content:center;"><span class="material-icons" style="font-size:32px;color:var(--color-text-disabled);">live_tv</span></div>'}
      <div class="poster-info">
        <div class="poster-title">${esc(ch.name)}</div>
        <div class="poster-meta">${esc(ch.addonName)}</div>
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

function setCCStatus(msg) {
  const el = document.getElementById('cc-load-status');
  if (el) { el.textContent = msg; el.style.display = msg ? '' : 'none'; }
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
  ccDetectedMatches = [];
  renderCCGrid([]);
  setCCStatus(`Loading 0 / ${tvAddons.length} addons…`);

  let completed = 0;

  await Promise.all(tvAddons.map(async (addon, addonIdx) => {
    const baseUrl = addon.transportUrl.replace('/manifest.json', '');
    const cats = (addon.manifest.catalogs || []).filter(c => c.type === 'tv' || c.type === 'channel');
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

    applyCCFilter();
    if (document.getElementById('tv-grid')) applyTVFilter();
  }));

  buildDetectedMatches();

  setCCStatus(`${ccAllChannels.length} channels from ${tvAddons.length} addon${tvAddons.length !== 1 ? 's' : ''}`);
  applyCCFilter();
}

function buildDetectedMatches() {
  const nameMap = {};
  
  for (const ch of ccAllChannels) {
    const key = normaliseName(ch.name);
    if (!key) continue;
    if (!nameMap[key]) nameMap[key] = [];
    nameMap[key].push(ch);
  }

  const existingNames = new Set(getAllCustomChannels().map(c => normaliseName(c.title)));
  
  ccDetectedMatches = Object.entries(nameMap)
    .filter(([key, channels]) => {
      const addons = new Set(channels.map(c => c.addonName));
      return addons.size >= 2 && !existingNames.has(key);
    })
    .map(([key, channels]) => {
      const seenAddons = new Set();
      const sources = [];
      for (const ch of channels) {
        if (!seenAddons.has(ch.addonName)) {
          seenAddons.add(ch.addonName);
          sources.push({
            addonName: ch.addonName,
            addonUrl: ch.addonUrl,
            channelId: ch.id,
            channelName: ch.name,
            channelLogo: ch.logo || ''
          });
        }
      }
      const display = channels[0];
      return {
        normalizedName: key,
        displayName: display.name,
        logo: display.logo,
        sourceCount: sources.length,
        sources
      };
    })
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
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
  
  let suggestions = ccDetectedMatches;
  if (q) suggestions = suggestions.filter(s => s.displayName.toLowerCase().includes(q));
  
  renderCCGrid(filtered, suggestions);
}

let ccDragSrcIdx = null;

function renderCCSources() {
  const el = document.getElementById('cc-sources-list');
  const hint = document.getElementById('cc-sources-hint');
  if (!ccSources.length) {
    el.innerHTML = '<span style="font-size:11px;color:var(--color-text-disabled);padding:4px 2px;">Click channels below to add sources</span>';
    if (hint) hint.style.display = '';
    return;
  }
  if (hint) hint.style.display = 'none';
  el.innerHTML = ccSources.map((s, i) => {
    const priority = i === 0 ? 'Primary' : `Backup ${i}`;
    const isPrimary = i === 0;
    return `<div class="source-chip"
      draggable="true"
      ondragstart="onCCChipDragStart(event,${i})"
      ondragover="onCCChipDragOver(event,${i})"
      ondrop="onCCChipDrop(event,${i})"
      ondragend="onCCChipDragEnd()"
      title="Drag to reorder">
      <span class="source-drag-handle">⠿</span>
      <div class="source-info">
        <span class="source-priority${isPrimary ? ' primary' : ''}">${priority}</span>
        <span class="source-name">${esc(s.addonName)}</span>
      </div>
      <button class="source-remove" onclick="removeCCSource(${i})" title="Remove">×</button>
    </div>`;
  }).join('');
}

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
  applyCCFilter();
}
function onCCChipDragEnd() {
  ccDragSrcIdx = null;
  renderCCSources();
}

function removeCCSource(i) { ccSources.splice(i, 1); renderCCSources(); filterCCChannels(); }

function renderCCGrid(channels, suggestions = []) {
  const grid = document.getElementById('cc-grid');
  
  if (!channels.length && !suggestions.length) {
    grid.innerHTML = '<div class="empty"><div class="empty-icon"><span class="material-icons" style="font-size:48px;color:var(--color-text-disabled);">live_tv</span></div><div class="empty-text">No channels found.</div></div>';
    return;
  }
  
  let html = '';
  
  if (suggestions.length) {
    html += '<div class="cc-suggestions">';
    html += '<div class="cc-suggestions-header">Suggested Multi-Source Channels</div>';
    html += `<div class="poster-grid">${suggestions.map((sug, i) => {
      const allAdded = sug.sources.every(src => 
        ccSources.some(s => s.channelId === src.channelId && s.addonUrl === src.addonUrl)
      );
      return `<div class="poster-card tv suggested${allAdded ? ' active' : ''}" data-sug-idx="${i}">
        ${sug.logo ? `<img class="poster-image" src="${esc(sug.logo)}" loading="lazy" onerror="this.outerHTML='<div class=\\'poster-image\\' style=\\'display:flex;align-items:center;justify-content:center;\\'><span class=\\'material-icons\\' style=\\'font-size:32px;color:var(--color-text-disabled);\\'>live_tv</span></div>'">` : '<div class="poster-image" style="display:flex;align-items:center;justify-content:center;"><span class="material-icons" style="font-size:32px;color:var(--color-text-disabled);">live_tv</span></div>'}
        <div class="poster-info">
          <div class="poster-title">${esc(sug.displayName)}</div>
          <div class="poster-meta">${sug.sourceCount} sources</div>
        </div>
      </div>`;
    }).join('')}</div>`;
    html += '</div>';
  }
  
  if (channels.length) {
    html += `<div class="poster-grid">${channels.map((ch, i) => {
      const isSource = ccSources.some(s => s.channelId === ch.id && s.addonUrl === ch.addonUrl);
      return `<div class="poster-card tv${isSource ? ' active' : ''}" data-ch-idx="${i}">
        ${ch.logo ? `<img class="poster-image" src="${esc(ch.logo)}" loading="lazy" onerror="this.outerHTML='<div class=\\'poster-image\\' style=\\'display:flex;align-items:center;justify-content:center;\\'><span class=\\'material-icons\\' style=\\'font-size:32px;color:var(--color-text-disabled);\\'>live_tv</span></div>'">` : '<div class="poster-image" style="display:flex;align-items:center;justify-content:center;"><span class="material-icons" style="font-size:32px;color:var(--color-text-disabled);">live_tv</span></div>'}
        <div class="poster-info">
          <div class="poster-title">${esc(ch.name)}</div>
          <div class="poster-meta">${esc(ch.addonName)}</div>
        </div>
      </div>`;
    }).join('')}</div>`;
  }
  
  grid.innerHTML = html;
  
  grid.querySelectorAll('.poster-card.suggested').forEach(el => {
    el.addEventListener('click', () => {
      const idx = parseInt(el.dataset.sugIdx);
      toggleSuggestedChannel(suggestions[idx]);
    });
  });
  
  grid.querySelectorAll('.poster-card:not(.suggested)').forEach(el => {
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
  applyCCFilter();
}

function toggleSuggestedChannel(suggestion) {
  const allAdded = suggestion.sources.every(src => 
    ccSources.some(s => s.channelId === src.channelId && s.addonUrl === src.addonUrl)
  );
  
  if (allAdded) {
    suggestion.sources.forEach(src => {
      const idx = ccSources.findIndex(s => s.channelId === src.channelId && s.addonUrl === src.addonUrl);
      if (idx >= 0) ccSources.splice(idx, 1);
    });
    toast(`Removed ${suggestion.displayName}`, 'success');
  } else {
    suggestion.sources.forEach(src => {
      const exists = ccSources.some(s => s.channelId === src.channelId && s.addonUrl === src.addonUrl);
      if (!exists) {
        ccSources.push({
          addonName: src.addonName,
          addonUrl: src.addonUrl,
          channelId: src.channelId,
          channelName: src.channelName,
          channelLogo: src.channelLogo
        });
      }
    });
    toast(`Added ${suggestion.displayName} with ${suggestion.sourceCount} sources`, 'success');
  }
  
  renderCCSources();
  applyCCFilter();
}

async function loadCCAddonChannels() {
  if (ccAllChannels.length) { applyCCFilter(); return; }
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
