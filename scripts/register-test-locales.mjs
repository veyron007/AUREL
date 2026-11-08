import { CATALOG_LOADERS } from '../src/i18n/catalogLoaders.js';
import { loadLocale } from '../src/i18n/index.js';

// Loads every translation catalog before a test runs: `node --import=<this
// file>`. The browser fetches one catalog on demand (src/i18n/index.js), so
// a test that switches locale with the synchronous setLocale would otherwise
// see English until the catalog arrived.
await Promise.all(Object.keys(CATALOG_LOADERS).map(loadLocale));
