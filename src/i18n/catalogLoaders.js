// One loader per shipped translation catalog. Each is a literal dynamic
// import, so the bundler emits every catalog as its own chunk and a page
// downloads only the language it shows. English is the source text and has
// no catalog. Adding a locale: docs/TRANSLATORS.md.

const pickDefault = ({ default: catalog }) => catalog;

/** @type {Readonly<Record<string, () => Promise<Record<string, unknown>>>>} */
export const CATALOG_LOADERS = Object.freeze({
  ar: () =>
    import('./locales/ar.json', { with: { type: 'json' } }).then(pickDefault),
  de: () =>
    import('./locales/de.json', { with: { type: 'json' } }).then(pickDefault),
  es: () =>
    import('./locales/es.json', { with: { type: 'json' } }).then(pickDefault),
  fr: () =>
    import('./locales/fr.json', { with: { type: 'json' } }).then(pickDefault),
  it: () =>
    import('./locales/it.json', { with: { type: 'json' } }).then(pickDefault),
  ja: () =>
    import('./locales/ja.json', { with: { type: 'json' } }).then(pickDefault),
  pt: () =>
    import('./locales/pt.json', { with: { type: 'json' } }).then(pickDefault),
  ru: () =>
    import('./locales/ru.json', { with: { type: 'json' } }).then(pickDefault),
  uk: () =>
    import('./locales/uk.json', { with: { type: 'json' } }).then(pickDefault),
  'zh-CN': () =>
    import('./locales/zh-CN.json', { with: { type: 'json' } }).then(
      pickDefault,
    ),
  'zh-Hant': () =>
    import('./locales/zh-Hant.json', { with: { type: 'json' } }).then(
      pickDefault,
    ),
});
