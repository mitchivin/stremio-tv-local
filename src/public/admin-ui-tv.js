/* exported updateTVPanel, onTVAddonChange, applyTVFilter, onCCAddonChange, onCCGenreChange, renderCCSources, onCCChipDragStart, onCCChipDragOver, onCCChipDrop, removeCCSource */
// ─── TV Channel State
let ccSources = [];
let ccAllChannels = [];
let ccDetectedMatches = [];
let ccEditingId = null;
let ccIsNew = false;

// ─── Auto-Detect
function normaliseName(n) {
  return n
    .toLowerCase()
    .replace(/\b(fhd|uhd|hd|4k|sd)\b/g, '')
    .replace(/\b(nz|au|uk|us|ca|ie|de|nl|al|se|sg|hk|my)\b/g, '')
    .replace(/\[bu\]|\[bkp\]|\[backup\]/g, '')  // Strip backup indicators
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// ─── CC channel filter
const CC_FILTER_GENRES = new Set([
  'radio',
  'music',
  'podcast',
  'podcasts',
  'audio',
  'soundtracks',
  'music channels',
  'radio stations',
  'music radio',
  'au iptv radio',
  'nz radio',
  'extra: ca | dazn',
  'extra: uk | dazn',
  'extra: uk | spfl',
  'extra: uk | tnt sports',
  'extra: uk | sky sports',
  'extra: int | dirtvision',
  'all tv channels',
  'all tv',
  'all',
  'traditional channels',
  'other channels',
  'regional channels',
  'ca tv',
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
  /\b\d{2,3}[.\s]?\d?\s*fm\b/i,
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
  if (/^(melbourne|perth|hobart|brisbane|adelaide|darwin|canberra)\s+tv$/i.test(g.trim()))
    return true;
  return false;
}
function isCCFiltered(name) {
  if (!name) return true;
  return CC_FILTER_PATTERNS.some((p) => p.test(name));
}

async function updateTVPanel() {
  console.log('[CC] updateTVPanel called');
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
    console.log(`[CC] Using cached channels: ${ccAllChannels.length}`);
    // Ensure detected matches are built if not already
    if (!ccDetectedMatches || !ccDetectedMatches.length) {
      buildDetectedMatches();
    }
    populateTVAddonDropdown();
    applyTVFilter();
    setCCStatus(
      `${ccAllChannels.length} channels from ${tvAddons.length} addon${tvAddons.length !== 1 ? 's' : ''}`
    );
    return;
  }

  const auth = await fetch(`/api/stremio/status${getUserParam()}`)
    .then((r) => r.json())
    .catch(() => null);
  if (!auth || !auth.loggedIn) {
    console.log('[CC] Not logged in');
    body.innerHTML = `<div class="empty" style="padding:40px 0;text-align:center;">
      <div class="empty-icon"><span class="material-icons" style="font-size:48px;color:var(--color-text-disabled);">lock</span></div>
      <div class="empty-text" style="margin-bottom:12px;">Sign in to browse TV Channels</div>
      <button class="btn btn-primary" onclick="openModal('stremio-login-modal')">Connect Stremio Account</button>
    </div>`;
    if (toolbar) toolbar.style.display = 'none';
    return;
  }

  if (!tvAddons.length) {
    console.log('[CC] Fetching addons from API');
    setCCStatus('Loading addons…');
    try {
      const resp = await fetch(`/api/stremio/addons${getUserParam()}`);
      if (resp.status === 401) {
        console.log('[CC] Auth failed');
        body.innerHTML =
          '<div class="empty"><div class="empty-icon"><span class="material-icons" style="font-size:48px;color:var(--color-text-disabled);">lock</span></div><div class="empty-text">Session expired. Please sign in again.</div></div>';
        if (toolbar) toolbar.style.display = 'none';
        return;
      }
      const d = await resp.json();
      tvAddons = (d.addons || []).filter(isTvAddon);
      console.log(`[CC] Fetched ${tvAddons.length} TV addons`);
    } catch (e) {
      console.error('[CC] Error fetching addons:', e);
      setCCStatus('');
      body.innerHTML = `<div class="empty"><div class="empty-icon"><span class="material-icons" style="font-size:48px;color:var(--color-error);">error</span></div><div class="empty-text">${esc(e.message)}</div></div>`;
      return;
    }
  }

  if (!tvAddons.length) {
    console.log('[CC] No TV addons found');
    body.innerHTML =
      '<div class="empty"><div class="empty-icon"><span class="material-icons" style="font-size:48px;color:var(--color-text-disabled);">signal_cellular_connected_no_internet_0_bar</span></div><div class="empty-text">No IPTV or TV addons found.</div></div>';
    if (toolbar) toolbar.style.display = 'none';
    return;
  }

  populateTVAddonDropdown();

  if (!ccAllChannels.length) {
    console.log('[CC] Loading all channels');
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
}

function onTVAddonChange() {
  const sel = document.getElementById('tv-addon-select');
  const val = sel ? sel.value : '';
  const genreSel = document.getElementById('tv-genre-select');
  const addonIdx = parseInt(val);
  if (!isNaN(addonIdx) && tvAddons[addonIdx]) {
    const addon = tvAddons[addonIdx];
    const genres = new Set();
    (addon.manifest.catalogs || [])
      .filter((c) => c.type === 'tv' || c.type === 'channel')
      .forEach((cat) => {
        const genreExtra = (cat.extra || []).find((e) => e.name === 'genre');
        if (genreExtra && genreExtra.options) {
          genreExtra.options.filter((g) => !isCCFilteredGenre(g)).forEach((g) => genres.add(g));
        }
      });
    if (genreSel) {
      genreSel.innerHTML =
        '<option value="">All Genres</option>' +
        Array.from(genres)
          .sort()
          .map((g) => `<option value="${esc(g)}">${esc(g)}</option>`)
          .join('');
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

  const addonIdx = parseInt(val);
  let filtered = ccAllChannels;
  if (!isNaN(addonIdx)) filtered = filtered.filter((c) => c.addonIdx === addonIdx);
  if (genre) {
    filtered = filtered.filter((c) => c.genres.includes(genre));
  } else {
    filtered = filtered.filter((c) => c.genres.some((g) => !isCCFilteredGenre(g)));
  }
  if (q) filtered = filtered.filter((c) => c.name.toLowerCase().includes(q));
  filtered = [...filtered].sort((a, b) => a.name.localeCompare(b.name));

  // Show saved multi-source channels above regular channels only when on "All Addons"
  const saved = !val
    ? getAllCustomChannels().filter((c) => !q || c.title.toLowerCase().includes(q))
    : [];

  renderTVGrid(filtered, saved);
}

function renderTVGrid(channels, saved = []) {
  const grid = document.getElementById('tv-grid');
  if (!grid) return;

  let html = '';

  // Show saved multi-source channels section above regular channels
  if (saved.length) {
    html += '<div class="cc-suggestions">';
    html += '<div class="cc-suggestions-header">My Multi-Source Channels</div>';
    html += `<div class="poster-grid">${saved
      .map((ch, i) => {
        const inRow = tempRowItems.some((x) => x.id === ch.id);
        return `<div class="poster-card tv saved-ms${inRow ? ' active' : ''}" data-saved-idx="${i}">
        ${ch.thumbnail ? `<img class="poster-image" src="${esc(ch.thumbnail)}" loading="lazy" onerror="this.outerHTML='<div class=\\'poster-image\\' style=\\'display:flex;align-items:center;justify-content:center;\\'><span class=\\'material-icons\\' style=\\'font-size:32px;color:var(--color-text-disabled);\\'>live_tv</span></div>'">` : '<div class="poster-image" style="display:flex;align-items:center;justify-content:center;"><span class="material-icons" style="font-size:32px;color:var(--color-text-disabled);">live_tv</span></div>'}
        <div class="poster-info">
          <div class="poster-title">${esc(ch.title)}</div>
          <div class="poster-meta">${(ch.sources || []).length} sources</div>
        </div>
      </div>`;
      })
      .join('')}</div>`;
    html += '</div>';
  }

  if (!channels.length && !saved.length) {
    grid.innerHTML =
      '<div class="empty"><div class="empty-icon"><span class="material-icons" style="font-size:48px;color:var(--color-text-disabled);">inbox</span></div><div class="empty-text">No channels found.</div></div>';
    return;
  }

  if (channels.length) {
    html += '<div class="cc-suggestions">';
    html += '<div class="cc-suggestions-header">All Channels</div>';
    html += `<div class="poster-grid">${channels
      .map((ch, i) => {
        const inRow = tempRowItems.some((x) => {
          if (x.id === ch.id) return true;
          if (x.id && x.id.startsWith('stremirow-') && x.sources) {
            return x.sources.some((s) => s.channelId === ch.id && s.addonUrl === ch.addonUrl);
          }
          return false;
        });
        return `<div class="poster-card tv${inRow ? ' active' : ''}" data-tv-idx="${i}">
        ${ch.logo ? `<img class="poster-image" src="${esc(ch.logo)}" loading="lazy" onerror="this.outerHTML='<div class=\\'poster-image\\' style=\\'display:flex;align-items:center;justify-content:center;\\'><span class=\\'material-icons\\' style=\\'font-size:32px;color:var(--color-text-disabled);\\'>live_tv</span></div>'">` : '<div class="poster-image" style="display:flex;align-items:center;justify-content:center;"><span class="material-icons" style="font-size:32px;color:var(--color-text-disabled);">live_tv</span></div>'}
        <div class="poster-info">
          <div class="poster-title">${esc(ch.name)}</div>
          <div class="poster-meta">${esc(ch.addonName)}</div>
        </div>
      </div>`;
      })
      .join('')}</div>`;
    html += '</div>';
  }

  grid.innerHTML = html;

  grid.querySelectorAll('.poster-card.saved-ms').forEach((el) => {
    el.addEventListener('click', () => {
      const ch = saved[parseInt(el.dataset.savedIdx)];
      const idx = tempRowItems.findIndex((x) => x.id === ch.id);
      if (idx >= 0) {
        tempRowItems.splice(idx, 1);
        toast(`Removed ${ch.title}`, 'success');
      } else {
        tempRowItems.push({ ...ch });
        toast(`Added ${ch.title}`, 'success');
      }
      renderRowItems();
      applyTVFilter();
    });
  });

  grid.querySelectorAll('.poster-card:not(.saved-ms)').forEach((el) => {
    el.addEventListener('click', () => {
      const ch = channels[parseInt(el.dataset.tvIdx)];
      if (!ch) return;
      toggleActiveRowItem({
        id: ch.id,
        type: 'tv',
        title: ch.name,
        thumbnail: ch.logo || '',
        description: '',
      });
    });
  });
}

function setCCStatus(msg) {
  const el = document.getElementById('cc-load-status');
  if (el) {
    el.textContent = msg;
    el.style.display = msg ? '' : 'none';
  }
  const tvEl = document.getElementById('tv-load-status');
  if (tvEl) {
    tvEl.textContent = msg;
    tvEl.style.display = msg ? '' : 'none';
  }
}

async function loadAllCCChannels() {
  console.log('[CC] loadAllCCChannels started, tvAddons:', tvAddons.length);
  if (!tvAddons.length) {
    console.log('[CC] No TV addons found');
    renderCCGrid([]);
    setCCStatus('');
    return;
  }

  ccAllChannels = [];
  ccDetectedMatches = [];
  renderCCGrid([]);
  setCCStatus(`Loading 0 / ${tvAddons.length} addons…`);

  let completed = 0;

  await Promise.all(
    tvAddons.map(async (addon, addonIdx) => {
      console.log(`[CC] Loading addon ${addonIdx}: ${addon.manifest.name}`);
      let baseUrl = addon.transportUrl.replace('/manifest.json', '');
      
      // Fix localhost URLs when running on remote deployment
      if (baseUrl.includes('127.0.0.1') || baseUrl.includes('localhost')) {
        const currentOrigin = window.location.origin;
        const path = baseUrl.replace(/^https?:\/\/[^/]+/, '');
        baseUrl = currentOrigin + path;
        console.log(`[CC] Fixed localhost URL to: ${baseUrl}`);
      }
      const cats = (addon.manifest.catalogs || []).filter(
        (c) => c.type === 'tv' || c.type === 'channel'
      );
      const urlPairs = [];
      cats.forEach((cat) => {
        const genreExtra = (cat.extra || []).find((e) => e.name === 'genre');
        if (genreExtra && genreExtra.options && genreExtra.options.length) {
          genreExtra.options
            .filter((g) => !isCCFilteredGenre(g))
            .forEach((g) =>
              urlPairs.push({
                url: `${baseUrl}/catalog/${cat.type}/${cat.id}/genre=${encodeURIComponent(g)}.json`,
                genre: g,
              })
            );
        } else {
          urlPairs.push({ url: `${baseUrl}/catalog/${cat.type}/${cat.id}.json`, genre: '' });
        }
      });

      const results = await Promise.all(
        urlPairs.map((p) =>
          fetch(`/api/stremio/proxy-catalog?url=${encodeURIComponent(p.url)}`)
            .then((r) => r.json())
            .catch(() => ({ metas: [] }))
        )
      );

      console.log(`[CC] Addon ${addonIdx} fetched ${results.length} catalog results`);
      let totalMetas = 0;
      results.forEach((r) => totalMetas += (r.metas || []).length);
      console.log(`[CC] Addon ${addonIdx} total metas: ${totalMetas}`);

      const seen = new Set(ccAllChannels.map((c) => c.id + '|' + c.addonUrl + '|' + c.genre));
      // Track normalized names per addon to deduplicate within same source
      const seenByAddonAndName = new Map();
      
      results.forEach((d, i) => {
        const genre = urlPairs[i].genre;
        (d.metas || []).forEach((m) => {
          const key = m.id + '|' + baseUrl + '|' + genre;
          if (m && m.id && !seen.has(key) && !isCCFiltered(m.name)) {
            // Normalize name for deduplication (remove region prefixes like "AU: ", "NZ: ")
            const normalizedName = m.name.replace(/^(AU|NZ|US):\s*/i, '').trim();
            const addonSourceKey = baseUrl + '|' + normalizedName;
            
            // Skip if we already have this normalized name from this addon/source
            if (seenByAddonAndName.has(addonSourceKey)) {
              console.log(`[CC] Skipping duplicate: ${normalizedName} from addon ${addonIdx}`);
              return;
            }
            seenByAddonAndName.set(addonSourceKey, true);
            
            seen.add(key);
            const existing = ccAllChannels.find((c) => c.id === m.id && c.addonUrl === baseUrl);
            if (existing) {
              existing.genres.push(genre);
              console.log(`[CC] Added genre to existing: ${normalizedName}`);
            } else {
              console.log(`[CC] Adding new channel: ${normalizedName} (ID: ${m.id})`);
              ccAllChannels.push({
                id: m.id,
                name: normalizedName,
                logo: m.poster || m.logo || '',
                addonName: addon.manifest.name,
                addonUrl: baseUrl,
                addonIdx,
                genre,
                genres: [genre],
              });
            }
          }
        });
      });

      completed++;
      setCCStatus(
        `Loading ${completed} / ${tvAddons.length} addons… (${ccAllChannels.length} channels)`
      );

      applyCCFilter();
      if (document.getElementById('tv-grid')) applyTVFilter();
    })
  );

  buildDetectedMatches();

  console.log(`[CC] Final: ${ccAllChannels.length} channels loaded`);
  console.log('[CC] All channels:', ccAllChannels.map(c => ({ name: c.name, id: c.id, addon: c.addonName })));

  setCCStatus(
    `${ccAllChannels.length} channels from ${tvAddons.length} addon${tvAddons.length !== 1 ? 's' : ''}`
  );
  applyCCFilter();

  // Update dropdown in case we're in the row builder modal
  populateTVAddonDropdown();
}

function buildDetectedMatches() {
  const nameMap = {};

  for (const ch of ccAllChannels) {
    const key = normaliseName(ch.name);
    if (!key) continue;
    if (!nameMap[key]) nameMap[key] = [];
    nameMap[key].push(ch);
  }

  // Helper to determine source type from channel ID (for MIPTV)
  function getSourceType(channel) {
    const id = channel.id || '';
    if (id.startsWith('miptv-backup2-')) return 'backup2';
    if (id.startsWith('miptv-backup-')) return 'backup';
    if (id.match(/^miptv-(news|sports|entertainment)-/)) return 'primary';
    // For non-MIPTV channels, use addonName as the source type
    return channel.addonName;
  }

  ccDetectedMatches = Object.entries(nameMap)
    .filter(([, channels]) => {
      const addons = new Set(channels.map((c) => c.addonName));
      const sourceTypes = new Set(channels.map(getSourceType));
      // Multi-source = either from 2+ addons OR 2+ different source types within same addon
      return addons.size >= 2 || sourceTypes.size >= 2;
    })
    .map(([key, channels]) => {
      const seenSources = new Set();
      const sources = [];
      for (const ch of channels) {
        const sourceType = getSourceType(ch);
        // Unique by source type (for MIPTV) or by addon name (for other addons)
        const uniqueKey = ch.id.startsWith('miptv-') ? sourceType : ch.addonName;
        if (!seenSources.has(uniqueKey)) {
          seenSources.add(uniqueKey);
          sources.push({
            addonName: ch.addonName,
            addonUrl: ch.addonUrl,
            channelId: ch.id,
            channelName: ch.name,
            channelLogo: ch.logo || '',
            sourceType: ch.id.startsWith('miptv-backup-') ? 'backup' : 'primary',
          });
        }
      }
      const display = channels[0];
      return {
        normalizedName: key,
        displayName: display.name,
        logo: display.logo,
        sourceCount: sources.length,
        sources,
      };
    })
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

function applyCCFilter() {
  const sel = document.getElementById('cc-addon-select');
  const addonIdx = sel ? parseInt(sel.value) : NaN;
  const addon = !isNaN(addonIdx) ? tvAddons[addonIdx] : null;
  const isMIPTVAllSources = addon && addon.manifest.id === 'org.miptv-combined.iptv';
  
  const filterVal = document.getElementById('cc-genre-select')?.value || '';
  const q = (document.getElementById('cc-search')?.value || '').toLowerCase();

  let filtered = ccAllChannels;
  
  // Filter by addon
  if (!isNaN(addonIdx)) {
    filtered = filtered.filter((c) => c.addonIdx === addonIdx);
  }
  
  // Filter by source (for MIPTV) or genre (for others)
  if (isMIPTVAllSources && filterVal) {
    if (filterVal === 'primary') {
      filtered = filtered.filter((c) => c.id.match(/^miptv-(news|sports|entertainment)-/));
    } else if (filterVal === 'backup') {
      filtered = filtered.filter((c) => c.id.startsWith('miptv-backup-') && !c.id.startsWith('miptv-backup2-'));
    } else if (filterVal === 'backup2') {
      filtered = filtered.filter((c) => c.id.startsWith('miptv-backup2-'));
    }
  } else if (!isMIPTVAllSources && filterVal) {
    filtered = filtered.filter((c) => c.genres.includes(filterVal));
  } else if (!isMIPTVAllSources) {
    filtered = filtered.filter((c) => c.genres.some((g) => !isCCFilteredGenre(g)));
  }
  
  // Filter by search
  if (q) {
    filtered = filtered.filter((c) => c.name.toLowerCase().includes(q));
  }
  
  filtered = [...filtered].sort((a, b) => a.name.localeCompare(b.name));
  renderCCGrid(filtered);
}

let ccDragSrcIdx = null;

function renderCCSources() {
  const el = document.getElementById('cc-sources-list');
  const hint = document.getElementById('cc-sources-hint');
  if (!ccSources.length) {
    el.innerHTML =
      '<span style="font-size:11px;color:var(--color-text-disabled);padding:4px 2px;">Click channels below to add sources</span>';
    if (hint) hint.style.display = '';
    return;
  }
  if (hint) hint.style.display = 'none';
  el.innerHTML = ccSources
    .map((s, i) => {
      const priority = i === 0 ? 'Primary' : `Backup ${i}`;
      const isPrimary = i === 0;
      return `<div class="source-chip"
      draggable="true"
      ondragstart="onCCChipDragStart(event,${i})"
      ondragover="onCCChipDragOver(event,${i})"
      ondrop="onCCChipDrop(event,${i})"
      ondragend="onCCChipDragEnd()"
      title="Drag to reorder">
      <span class="source-priority${isPrimary ? ' primary' : ''}">${priority}</span>
      <span class="source-name">${esc(s.addonName)}</span>
      <button class="source-remove" onclick="removeCCSource(${i})" title="Remove">×</button>
    </div>`;
    })
    .join('');
}

function onCCChipDragStart(e, i) {
  ccDragSrcIdx = i;
  e.dataTransfer.effectAllowed = 'move';
  e.currentTarget.style.opacity = '0.4';
}
function onCCChipDragOver(e, i) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
}
function onCCChipDrop(e, targetIdx) {
  e.preventDefault();
  e.stopPropagation();
  if (ccDragSrcIdx === null || ccDragSrcIdx === targetIdx) {
    onCCChipDragEnd();
    return;
  }
  const moved = ccSources.splice(ccDragSrcIdx, 1)[0];
  ccSources.splice(targetIdx, 0, moved);
  ccDragSrcIdx = null;
  renderCCSources();
  applyCCFilter();
}
function onCCChipDragEnd() {
  ccDragSrcIdx = null;
  document.querySelectorAll('.source-chip').forEach((el) => (el.style.opacity = ''));
}

function removeCCSource(i) {
  ccSources.splice(i, 1);
  renderCCSources();
  applyCCFilter();
}

function renderCCGrid(channels) {
  console.log(`[CC] renderCCGrid called with ${channels.length} channels`);
  const grid = document.getElementById('cc-grid');

  if (!channels.length) {
    console.log('[CC] No channels to render');
    grid.innerHTML =
      '<div class="empty"><div class="empty-icon"><span class="material-icons" style="font-size:48px;color:var(--color-text-disabled);">live_tv</span></div><div class="empty-text">No channels found.</div></div>';
    return;
  }

  grid.innerHTML = `<div class="poster-grid">${channels
    .map((ch, i) => {
      const isSource = ccSources.some((s) => s.channelId === ch.id && s.addonUrl === ch.addonUrl);
      const sourceType = ch.id.startsWith('miptv-backup2-') ? 'Backup2 Source' : ch.id.startsWith('miptv-backup-') ? 'Backup Source' : 'Primary Source';
      console.log(`[CC] Rendering channel: ${ch.name} (${ch.id}) - Type: ${sourceType}`);
      const tooltipText = `${esc(ch.name)}\n${sourceType}\nID: ${esc(ch.id)}`;
      return `<div class="poster-card tv${isSource ? ' active' : ''}" data-ch-idx="${i}" title="${tooltipText}">
        ${ch.logo ? `<img class="poster-image" src="${esc(ch.logo)}" loading="lazy" onerror="this.outerHTML='<div class=\\'poster-image\\' style=\\'display:flex;align-items:center;justify-content:center;\\'><span class=\\'material-icons\\' style=\\'font-size:32px;color:var(--color-text-disabled);\\'>live_tv</span></div>'">` : '<div class="poster-image" style="display:flex;align-items:center;justify-content:center;"><span class="material-icons" style="font-size:32px;color:var(--color-text-disabled);">live_tv</span></div>'}
        <div class="poster-info">
          <div class="poster-title">${esc(ch.name)}</div>
          <div class="poster-meta">${sourceType}</div>
        </div>
      </div>`;
    })
    .join('')}</div>`;

  grid.querySelectorAll('.poster-card').forEach((el) => {
    el.addEventListener('click', () => {
      toggleCCSource(channels[parseInt(el.dataset.chIdx)]);
    });
  });
}

function toggleCCSource(ch) {
  const idx = ccSources.findIndex((s) => s.channelId === ch.id && s.addonUrl === ch.addonUrl);
  if (idx >= 0) ccSources.splice(idx, 1);
  else
    ccSources.push({
      addonName: ch.addonName,
      addonUrl: ch.addonUrl,
      channelId: ch.id,
      channelName: ch.name,
      channelLogo: ch.logo || '',
      sourceType: ch.id.startsWith('miptv-backup-') ? 'backup' : 'primary',
    });
  renderCCSources();
  applyCCFilter();
}

function onCCAddonChange() {
  const sel = document.getElementById('cc-addon-select');
  const addonIdx = sel ? parseInt(sel.value) : NaN;
  const genreSel = document.getElementById('cc-genre-select');

  if (!isNaN(addonIdx) && tvAddons[addonIdx]) {
    const addon = tvAddons[addonIdx];
    
    // Check if this is MIPTV (All Sources)
    const isMIPTVAllSources = addon.manifest.id === 'org.miptv-combined.iptv';
    
    if (isMIPTVAllSources) {
      // Show source dropdown instead of genres
      if (genreSel) {
        genreSel.innerHTML = `
          <option value="">All Sources</option>
          <option value="primary">Primary Source</option>
          <option value="backup">Backup Source</option>
          <option value="backup2">Backup2 Source</option>
        `;
        genreSel.disabled = false;
        // Change label if possible
        const label = document.querySelector('label[for="cc-genre-select"]');
        if (label) label.textContent = 'Source:';
      }
    } else {
      // Normal genre dropdown for other addons
      const genres = new Set();
      (addon.manifest.catalogs || [])
        .filter((c) => c.type === 'tv' || c.type === 'channel')
        .forEach((cat) => {
          const genreExtra = (cat.extra || []).find((e) => e.name === 'genre');
          if (genreExtra && genreExtra.options) {
            genreExtra.options.filter((g) => !isCCFilteredGenre(g)).forEach((g) => genres.add(g));
          }
        });
      if (genreSel) {
        genreSel.innerHTML =
          '<option value="">All Genres</option>' +
          Array.from(genres)
            .sort()
            .map((g) => `<option value="${esc(g)}">${esc(g)}</option>`)
            .join('');
        genreSel.disabled = false;
        // Reset label
        const label = document.querySelector('label[for="cc-genre-select"]');
        if (label) label.textContent = 'Genre:';
      }
    }
  } else if (genreSel) {
    genreSel.innerHTML = '<option value="">All Genres</option>';
    genreSel.disabled = true;
    const label = document.querySelector('label[for="cc-genre-select"]');
    if (label) label.textContent = 'Genre:';
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
