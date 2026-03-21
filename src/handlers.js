/**
 * handlers.js
 * Defines the catalog handler and (channel-only) stream handler.
 *
 * Content type behaviour:
 *  - "movie" / "series" / "tv": this addon provides the catalog row; the user's
 *    installed streaming addons supply the actual streams via the item's ID.
 *    We deliberately do NOT register a stream handler for any of these
 *    types so Stremio falls through naturally to other addons.
 */

'use strict';

/**
 * Build a Stremio MetaPreview for a movie/series/tv-type item (library or external addon item).
 * The id must match what external addons expect (IMDB ID or addon-specific ID).
 */
function libraryMeta(item) {
    const type = item.type || 'movie';
    return {
        id: item.id,
        type: type,
        name: item.title,
        description: item.description || '',
        poster: item.thumbnail || '',
        posterShape: type === 'tv' ? 'square' : 'poster',
        background: item.thumbnail || '',
        imdbRating: item.imdbRating || undefined,
    };
}

/**
 * Register both handlers on the given addonBuilder instance.
 */
function registerHandlers(builder, configProvider) {
    // ── Catalog handler ────────────────────────────────────────────────────────
    builder.defineCatalogHandler(function (args) {
        const { type, id, extra } = args;
        const { rows } = configProvider();

        const row = rows.find(r => r.id === id && (r.contentType || 'movie') === type);
        if (!row || !Array.isArray(row.items)) return Promise.resolve({ metas: [] });

        const skip = parseInt(extra?.skip || 0, 10);
        const allMetas = row.items
            .filter(s => s && (s.type || 'movie') === type)
            .map(s => libraryMeta(s));

        const metas = skip >= allMetas.length ? [] : allMetas.slice(skip);
        console.log(`[catalog] "${row.name}" (${type}/${row.id}) skip=${skip} → ${metas.length} item(s)`);
        return Promise.resolve({ metas });
    });

    // ── Meta handler for custom channels ──────────────────────────────────────
    builder.defineMetaHandler(function ({ type, id }) {
        if (!id.startsWith('stremirow-')) return Promise.resolve({ meta: null });
        const { rows } = configProvider();
        for (const row of rows) {
            const item = (row.items || []).find(i => i.id === id);
            if (item) {
                return Promise.resolve({ meta: libraryMeta(item) });
            }
        }
        return Promise.resolve({ meta: null });
    });

    // ── Stream handler for custom channels ────────────────────────────────────
    builder.defineStreamHandler(async function ({ id }) {
        if (!id.startsWith('stremirow-')) return { streams: [] };
        const config = configProvider();
        const { rows } = config;
        let sources = [];
        
        for (const row of rows) {
            const item = (row.items || []).find(i => i.id === id);
            if (item && Array.isArray(item.sources)) { sources = item.sources; break; }
        }
        
        if (!sources.length && config._orphanCustomChannels) {
            const orphan = config._orphanCustomChannels.find(i => i.id === id);
            if (orphan && Array.isArray(orphan.sources)) {
                sources = orphan.sources;
            }
        }
        
        if (!sources.length) return { streams: [] };

        const streams = [];
        for (let srcIdx = 0; srcIdx < sources.length; srcIdx++) {
            const src = sources[srcIdx];
            try {
                const url = `${src.addonUrl}/stream/tv/${encodeURIComponent(src.channelId)}.json`;
                const res = await fetch(url, { headers: { 'User-Agent': 'stremirow/1.0' } });
                if (!res.ok) continue;
                const data = await res.json();
                const priority = srcIdx === 0 ? 'Primary' : `Backup ${srcIdx}`;
                (data.streams || []).forEach(s => {
                    streams.push({ ...s, name: src.addonName || s.name, title: priority });
                });
            } catch (e) {
                console.error(`[stream] failed ${src.addonUrl}:`, e.message);
            }
        }

        return { streams };
    });
}

module.exports = { registerHandlers };
