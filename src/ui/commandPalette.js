import { foldName, matchRank } from '../search/suggest.js';

/**
 * The command palette's list: places from the location field's suggestion
 * engine, layers from the data layer catalog and a few actions (destinations,
 * reset, voice). It owns only the query, which row is highlighted and the keys
 * that move between rows. Every row runs an existing owner's operation, which
 * the composition supplies; this module neither fetches nor toggles anything
 * itself.
 */
export const PALETTE_LIMITS = Object.freeze({
  places: 6,
  layers: 6,
  actions: 8,
});
export const PALETTE_MAX_QUERY = 120;
const EMPTY_LAYER_SUGGESTIONS = 4;

/** The best match rank of a query against any of the texts; null when none match. */
export function paletteRank(query, texts) {
  const folded = foldName(query);
  if (!folded) return 0;
  let best = null;
  for (const text of texts) {
    const rank = matchRank(text, folded);
    if (rank !== null && (best === null || rank < best)) best = rank;
  }
  return best;
}

function ranked(entries, query, textsOf) {
  return entries
    .map((entry, order) => ({
      entry,
      order,
      rank: paletteRank(query, textsOf(entry)),
    }))
    .filter((item) => item.rank !== null)
    .sort((a, b) => a.rank - b.rank || a.order - b.order);
}

const EDITABLE =
  "input, textarea, select, [contenteditable='true'], [contenteditable='']";

/**
 * The palette's keyboard shortcut in a keydown, if any: ⌘K or Ctrl+K toggles
 * it anywhere; "/" opens it when the person is not typing in a field.
 * @param {KeyboardEvent} event
 * @returns {'toggle'|'open'|null}
 */
export function paletteShortcut(event) {
  if (!event || event.defaultPrevented || event.isComposing) return null;
  const key = String(event.key ?? '').toLowerCase();
  if (
    (event.metaKey || event.ctrlKey) &&
    !event.altKey &&
    !event.shiftKey &&
    key === 'k'
  )
    return 'toggle';
  if (
    key === '/' &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.target?.closest?.(EDITABLE)
  )
    return 'open';
  return null;
}

export class CommandPalette {
  /**
   * @param {object} options
   * @param {?{suggest: Function, items: Function, status?: Function, choose: Function, close: Function}} [options.places]
   * @param {?{list: Function, toggle: Function}} [options.layers]
   * @param {() => Array<{id: string, title: string, meta?: string, keywords?: string[], run: Function}>} [options.actions]
   * @param {() => {layer: string, on: string, off: string}} [options.words] Translated row labels.
   * @param {Function} [options.onChange]
   */
  constructor({
    places = null,
    layers = null,
    actions = () => [],
    words = () => ({ layer: 'Layer', on: 'On', off: 'Off' }),
    onChange = () => {},
    limits = PALETTE_LIMITS,
  } = {}) {
    Object.assign(this, { places, layers, actions, words, onChange, limits });
    this.isOpen = false;
    this.query = '';
    this.rows = [];
    this.sections = [];
    this.active = -1;
    this.destroyed = false;
  }

  open() {
    if (this.destroyed || this.isOpen) return;
    this.isOpen = true;
    this.query = '';
    // An empty query offers recent places, as the location field does.
    this.safe(() => this.places?.suggest(''));
    this.rebuild(null);
    this.onChange();
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.query = '';
    this.rows = [];
    this.sections = [];
    this.active = -1;
    this.safe(() => this.places?.close());
    this.onChange();
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  /** The palette field's text changed. */
  setQuery(text) {
    if (!this.isOpen) return;
    this.query = String(text ?? '').slice(0, PALETTE_MAX_QUERY);
    this.safe(() => this.places?.suggest(this.query));
    this.rebuild(null);
    this.onChange();
  }

  /** A source's answers changed (new place suggestions, a layer toggled). */
  refresh() {
    if (!this.isOpen) return;
    this.rebuild(this.rows[this.active]?.key ?? null);
    this.onChange();
  }

  rebuild(keepKey) {
    const query = this.query.trim();
    const places = this.placeRows();
    const layers = this.layerRows(query);
    const actions = this.actionRows(query);
    const strongLocal = [...layers.rows, ...actions.rows].some(
      (row) => row.rank <= 1,
    );
    const order = !query
      ? [actions, layers, places]
      : strongLocal
        ? [layers, actions, places]
        : [places, layers, actions];
    this.sections = order.filter((section) => section.rows.length);
    this.rows = this.sections.flatMap((section) => section.rows);
    const kept = keepKey
      ? this.rows.findIndex((row) => row.key === keepKey)
      : -1;
    this.active = kept >= 0 ? kept : this.rows.length ? 0 : -1;
  }

  placeRows() {
    const items = this.safe(() => this.places?.items()) || [];
    return {
      id: 'places',
      rows: items.slice(0, this.limits.places).map((item, index) => ({
        key: `place:${item.key ?? index}`,
        section: 'places',
        title: String(item.title ?? ''),
        detail: item.detail ? String(item.detail) : '',
        meta: item.kind ? String(item.kind) : '',
        rank: 2,
        run: () => this.places.choose(index),
      })),
    };
  }

  layerRows(query) {
    const layers = (this.safe(() => this.layers?.list()) || []).filter(
      (layer) => layer && layer.available !== false,
    );
    const words = this.words();
    let chosen;
    if (query) {
      chosen = ranked(layers, query, (layer) => [layer.name, layer.id]).map(
        ({ entry, rank }) => ({ layer: entry, rank }),
      );
    } else {
      const enabled = layers.filter((layer) => layer.enabled);
      chosen = (
        enabled.length ? enabled : layers.slice(0, EMPTY_LAYER_SUGGESTIONS)
      ).map((layer) => ({ layer, rank: 3 }));
    }
    return {
      id: 'layers',
      rows: chosen.slice(0, this.limits.layers).map(({ layer, rank }) => ({
        key: `layer:${layer.id}`,
        section: 'layers',
        title: String(layer.name ?? layer.id),
        detail: layer.enabled ? words.on : words.off,
        meta: words.layer,
        pressed: Boolean(layer.enabled),
        rank,
        run: () => this.layers.toggle(layer.id),
      })),
    };
  }

  actionRows(query) {
    const actions = (this.safe(() => this.actions()) || []).filter(Boolean);
    const chosen = query
      ? ranked(actions, query, (action) => [
          action.title,
          ...(action.keywords || []),
        ])
      : actions.map((entry) => ({ entry, rank: 3 }));
    return {
      id: 'actions',
      rows: chosen.slice(0, this.limits.actions).map(({ entry, rank }) => ({
        key: `action:${entry.id}`,
        section: 'actions',
        title: String(entry.title),
        detail: '',
        meta: entry.meta ? String(entry.meta) : '',
        rank,
        run: entry.run,
      })),
    };
  }

  move(delta) {
    const count = this.rows.length;
    if (!count) return;
    this.active = (((this.active + delta) % count) + count) % count;
    this.onChange();
  }

  highlight(index) {
    if (index < 0 || index >= this.rows.length || index === this.active) return;
    this.active = index;
    this.onChange();
  }

  /**
   * Run a row's operation and close. The row is read before closing because
   * closing the palette also closes the place suggestions it lists.
   * @returns {boolean} Whether a row ran.
   */
  activate(index = this.active) {
    const row = this.rows[index];
    if (!this.isOpen || !row) return false;
    try {
      const result = row.run?.();
      // An owner's asynchronous failure is that owner's to report.
      if (result && typeof result.catch === 'function') result.catch(() => {});
    } finally {
      this.close();
    }
    return true;
  }

  /** Handle a key in the palette field; true when the key was used. */
  key(event) {
    if (!this.isOpen || event.isComposing) return false;
    switch (event.key) {
      case 'ArrowDown':
        this.move(1);
        return true;
      case 'ArrowUp':
        this.move(-1);
        return true;
      case 'PageDown':
      case 'End':
        if (event.key === 'End' && !event.ctrlKey) return false;
        this.highlight(this.rows.length - 1);
        return true;
      case 'PageUp':
      case 'Home':
        if (event.key === 'Home' && !event.ctrlKey) return false;
        this.highlight(0);
        return true;
      case 'Enter':
        this.activate();
        return true;
      case 'Escape':
        this.close();
        return true;
      case 'Tab':
        // The field is the palette's only stop; keep focus inside the dialog.
        return true;
      default:
        return false;
    }
  }

  /** The palette as its view renders it. */
  view() {
    if (!this.isOpen) return { open: false };
    let index = 0;
    return {
      open: true,
      query: this.query,
      activeId: this.active >= 0 ? `command-palette-row-${this.active}` : null,
      status: this.safe(() => this.places?.status?.()) || '',
      empty: this.rows.length === 0,
      sections: this.sections.map((section) => ({
        id: section.id,
        rows: section.rows.map((row) => {
          const position = index++;
          return {
            key: row.key,
            id: `command-palette-row-${position}`,
            index: position,
            section: row.section,
            title: row.title,
            detail: row.detail,
            meta: row.meta,
            pressed: row.pressed,
            active: position === this.active,
          };
        }),
      })),
    };
  }

  /** A source that throws must not break the palette. */
  safe(read) {
    try {
      return read();
    } catch {
      return null;
    }
  }

  destroy() {
    if (this.destroyed) return;
    this.close();
    this.destroyed = true;
  }
}
