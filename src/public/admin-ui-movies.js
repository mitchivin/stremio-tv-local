/* exported setMovieType, onMovieSearch, onCatalogChange, onGenreChange, loadMoreMovies, renderMovieGrid */
// ─── Movies & Series (CineMeta)
const CINEMETA_CATALOGS = {
  movie: [
    {
      id: 'top',
      name: 'Popular',
      genres: [
        'Action',
        'Adventure',
        'Animation',
        'Biography',
        'Comedy',
        'Crime',
        'Documentary',
        'Drama',
        'Family',
        'Fantasy',
        'History',
        'Horror',
        'Mystery',
        'Romance',
        'Sci-Fi',
        'Sport',
        'Thriller',
        'War',
        'Western',
      ],
    },
    { id: 'year', name: 'New', genres: Array.from({ length: 107 }, (_, i) => `${2026 - i}`) },
    {
      id: 'imdbRating',
      name: 'Featured',
      genres: [
        'Action',
        'Adventure',
        'Animation',
        'Biography',
        'Comedy',
        'Crime',
        'Documentary',
        'Drama',
        'Family',
        'Fantasy',
        'History',
        'Horror',
        'Mystery',
        'Romance',
        'Sci-Fi',
        'Sport',
        'Thriller',
        'War',
        'Western',
      ],
    },
  ],
  series: [
    {
      id: 'top',
      name: 'Popular',
      genres: [
        'Action',
        'Adventure',
        'Animation',
        'Biography',
        'Comedy',
        'Crime',
        'Documentary',
        'Drama',
        'Family',
        'Fantasy',
        'History',
        'Horror',
        'Mystery',
        'Romance',
        'Sci-Fi',
        'Sport',
        'Thriller',
        'War',
        'Western',
        'Reality-TV',
        'Talk-Show',
        'Game-Show',
      ],
    },
    { id: 'year', name: 'New', genres: Array.from({ length: 107 }, (_, i) => `${2026 - i}`) },
    {
      id: 'imdbRating',
      name: 'Featured',
      genres: [
        'Action',
        'Adventure',
        'Animation',
        'Biography',
        'Comedy',
        'Crime',
        'Documentary',
        'Drama',
        'Family',
        'Fantasy',
        'History',
        'Horror',
        'Mystery',
        'Romance',
        'Sci-Fi',
        'Sport',
        'Thriller',
        'War',
        'Western',
        'Reality-TV',
        'Talk-Show',
        'Game-Show',
      ],
    },
  ],
};

function updateCineMetaDropdowns() {
  const catalogs = CINEMETA_CATALOGS[movieType] || [];
  const catSelect = document.getElementById('movie-catalog');
  const prevCat = catSelect.value;
  catSelect.innerHTML = catalogs.map((c) => `<option value="${c.id}">${c.name}</option>`).join('');
  if (catalogs.some((c) => c.id === prevCat)) catSelect.value = prevCat;
  updateCineMetaGenres(document.getElementById('movie-genre').value);
}

function updateCineMetaGenres(preserveGenre) {
  const catalogs = CINEMETA_CATALOGS[movieType] || [];
  const catId = document.getElementById('movie-catalog').value;
  const catalog = catalogs.find((c) => c.id === catId);
  const genSelect = document.getElementById('movie-genre');
  if (!catalog || !catalog.genres || catalog.genres.length === 0) {
    genSelect.style.display = 'none';
    genSelect.innerHTML = '';
  } else {
    genSelect.style.display = '';
    let html =
      catalog.id === 'year'
        ? `<option value="">All Years</option>`
        : `<option value="">All Genres</option>`;
    html += catalog.genres.map((g) => `<option value="${esc(g)}">${esc(g)}</option>`).join('');
    genSelect.innerHTML = html;
    if (preserveGenre && catalog.genres.includes(preserveGenre)) genSelect.value = preserveGenre;
  }
}

function setMovieType(t) {
  movieType = t;
  updateCineMetaDropdowns();
  const q = document.getElementById('movie-search').value.trim();
  if (q.length >= 2) searchCineMeta(q);
  else loadCategory();
}
function onMovieSearch() {
  clearTimeout(movieTimer);
  const q = document.getElementById('movie-search').value.trim();
  if (!q) {
    loadCategory();
    return;
  }
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
    grid.innerHTML =
      '<div class="empty" style="grid-column:1/-1"><div class="empty-icon"><span class="material-icons" style="font-size:48px;color:var(--color-text-disabled);">hourglass_empty</span></div><div class="empty-text">Loading…</div></div>';
  } else {
    const btn = document.getElementById('load-more-btn');
    if (btn) btn.textContent = 'Loading...';
  }
  try {
    const d = await fetch(`/api/stremio/proxy-catalog?url=${encodeURIComponent(url)}`).then((r) =>
      r.json()
    );
    if (d.error) throw new Error(d.error);
    const newResults = (d.metas || []).map((m) => ({
      id: m.id,
      type: movieType,
      title: m.name,
      thumbnail: m.poster || '',
      description: m.description || '',
      year: m.year || null,
    }));
    if (append) {
      if (newResults.length === 0) {
        toast('No more results', 'success');
        renderMovieGrid(false);
        return;
      }
      movieResults.push(...newResults);
    } else {
      movieResults = newResults;
    }
    renderMovieGrid(newResults.length >= 15);
  } catch (e) {
    if (!append)
      grid.innerHTML = `<div class="empty" style="grid-column:1/-1"><div class="empty-icon"><span class="material-icons" style="font-size:48px;color:var(--color-error);">error</span></div><div class="empty-text">${esc(e.message)}</div></div>`;
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
  if (!movieResults.length) {
    grid.innerHTML =
      '<div class="empty" style="grid-column:1/-1"><div class="empty-icon"><span class="material-icons" style="font-size:48px;color:var(--color-text-disabled);">inbox</span></div><div class="empty-text">No results.</div></div>';
    return;
  }
  const placeholder =
    'https://images.placeholders.dev/?width=300&height=450&text=No%20Poster&bgColor=%231a1a1a&textColor=%23666';
  let html = movieResults
    .map((item) => {
      const inActiveRow = tempRowItems.some((i) => i.id === item.id);
      return `<div class="poster-card${inActiveRow ? ' active' : ''}" onclick='toggleActiveRowItem(${safeJson(item)})'>
    ${item.thumbnail ? `<img class="poster-image" src="${esc(item.thumbnail)}" loading="lazy" onerror="this.src='${placeholder}'">` : `<img class="poster-image" src="${placeholder}">`}
    <div class="poster-info">
      <div class="poster-title">${esc(item.title)}</div>
      ${item.year ? `<div class="poster-meta">${item.year}</div>` : ''}
    </div>
  </div>`;
    })
    .join('');
  if (hasMore) {
    html += `<div style="grid-column:1/-1;text-align:center;padding:20px 0;">
      <button class="btn btn-ghost" id="load-more-btn" onclick="loadMoreMovies()">Load More</button>
    </div>`;
  }
  grid.innerHTML = html;
}
