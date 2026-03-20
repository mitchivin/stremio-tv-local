/**
 * loader.js
 * Loads and validates ui-config.json from storage.
 * Produces a slug ID for each row if one isn't set.
 */

const storage = require('./storage');

/**
 * Convert a human-readable name to a URL/ID-safe slug.
 */
function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Load and validate the configuration from the storage layer.
 */
async function loadConfig() {
  const uiConfig = await storage.loadConfig();

  if (!uiConfig.addon || !uiConfig.addon.id || !uiConfig.addon.name) {
    throw new Error('Configuration must have an "addon" object with at least "id" and "name" fields.');
  }

  if (!Array.isArray(uiConfig.rows)) {
    throw new Error('Configuration must have a "rows" array.');
  }

  uiConfig.rows.forEach((row, i) => {
    if (!row.id) row.id = slugify(row.name);
    if (!row.name) throw new Error(`Row [${i}] is missing required field "name"`);
    if (!Array.isArray(row.items)) {
      throw new Error(`Row [${i}] ("${row.name}") must have an "items" array`);
    }
  });

  // Detect duplicate slugs
  const seenIds = new Set();
  uiConfig.rows.forEach(row => {
    if (seenIds.has(row.id)) {
      throw new Error(`Two rows produce the same slug ID "${row.id}". Please give them distinct names.`);
    }
    seenIds.add(row.id);
  });

  return {
    rows: uiConfig.rows,
    addonMeta: uiConfig.addon,
  };
}

module.exports = { loadConfig };
