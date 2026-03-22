/**
 * manifest.js
 * Dynamically builds the Stremio addon manifest from the loaded config.
 *
 * Row content types:
 *  - "movie" / "series" / "tv": this addon supplies the custom curated
 *    catalog row; streams are served by the user's other installed addons.
 *
 * Each row entry in ui-config.json becomes one catalog → one home-screen row.
 */

// The set of content types among items across all rows
const CONTENT_TYPES = ['movie', 'series', 'tv'];

function buildManifest(addonMeta, rows) {
  // Each row becomes one catalog entry.
  // Filter out the auto-generated "Custom Channels" row
  const catalogs = rows
    .filter((row) => row.id !== 'custom-channels')
    .map((row) => {
      const type = row.contentType || 'movie';
      const posterShape = type === 'tv' ? 'square' : 'poster';

      return {
        id: row.id,
        type,
        name: row.name,
        posterShape,
        extra: [{ name: 'skip', isRequired: false }],
      };
    });

  // Always use a fresh timestamp so Stremio busts its cache on every manifest fetch.
  // Never use the version baked into addonMeta — that's stale from the last save.
  const version = `1.0.${Date.now()}`;

  return {
    id: 'com.stremirow.custom',
    version,
    name: 'StremiRow',
    description: addonMeta.description || 'Personal curated rows...',
    logo: addonMeta.logo || undefined,

    resources: [
      'catalog',
      { name: 'meta', types: ['tv'], idPrefixes: ['stremirow-'] },
      { name: 'stream', types: ['tv'], idPrefixes: ['stremirow-'] },
    ],
    types: CONTENT_TYPES,
    catalogs,

    behaviorHints: { adult: false, p2p: false },
  };
}
module.exports = { buildManifest };
