import { msg, t } from '../i18n/index.js';

/** Human label for where a suggestion came from. */
const SOURCE_LABELS = Object.freeze({
  coordinate: msg('Coordinates'),
  recent: msg('Recent'),
  preset: msg('Bundled place'),
  remote: msg('OpenStreetMap'),
});

/** Short kind for a suggestion row, from the place's types. */
function kindOf(place, source) {
  const types = place.types || [];
  if (source === 'coordinate') return msg('Coordinates');
  if (types.includes('country')) return msg('Country');
  if (types.includes('administrative_area_level_1')) return msg('State');
  if (types.includes('locality')) return msg('City');
  if (types.includes('sublocality')) return msg('District');
  if (types.includes('route')) return msg('Street');
  if (types.includes('point_of_interest')) return msg('Landmark');
  return msg('Place');
}

/**
 * The location field's suggestion list as a combobox: which rows are shown,
 * which one is active, and the keys that move between them. The engine
 * (src/search/suggest.js) decides what to fetch and when; this only presents
 * its answers and turns keys and clicks into a chosen place.
 */
export class SearchSuggestions {
  constructor({ createEngine, onChange = () => {} }) {
    this.onChange = onChange;
    this.open = false;
    this.items = [];
    this.activeIndex = -1;
    this.loading = false;
    this.remote = 'idle';
    this.query = '';
    this.engine = createEngine((state) => this.receive(state));
  }
  receive(state) {
    const previousKey = this.items[this.activeIndex]?.key;
    this.items = state.items;
    this.loading = state.loading;
    this.remote = state.remote;
    this.query = state.query;
    // Keep the highlighted row highlighted when more rows arrive.
    this.activeIndex = previousKey
      ? this.items.findIndex((row) => row.key === previousKey)
      : -1;
    this.open = this.items.length > 0 || this.loading || this.showsEmpty();
    this.onChange();
  }
  showsEmpty() {
    return (
      this.query.trim().length >= 3 &&
      !this.loading &&
      this.items.length === 0 &&
      ['done', 'cached', 'unavailable'].includes(this.remote)
    );
  }
  /** The field's text changed, or it gained focus. */
  input(text, bias) {
    this.engine.update(text, { bias });
  }
  /** Handle a key in the field; true when the key was used. */
  key(event) {
    if (!this.open) {
      if (event.key === 'ArrowDown' && this.items.length) {
        this.open = true;
        this.activeIndex = 0;
        this.onChange();
        return true;
      }
      return false;
    }
    const count = this.items.length;
    if (event.key === 'ArrowDown' && count) {
      this.activeIndex = (this.activeIndex + 1) % count;
    } else if (event.key === 'ArrowUp' && count) {
      this.activeIndex =
        this.activeIndex <= 0 ? count - 1 : this.activeIndex - 1;
    } else if (event.key === 'Home' && count && event.altKey) {
      this.activeIndex = 0;
    } else if (event.key === 'Escape') {
      this.close();
      return true;
    } else return false;
    this.onChange();
    return true;
  }
  /** The highlighted row, if the list is open and one is highlighted. */
  active() {
    return this.open ? (this.items[this.activeIndex] ?? null) : null;
  }
  highlight(index) {
    if (index < 0 || index >= this.items.length || index === this.activeIndex)
      return;
    this.activeIndex = index;
    this.onChange();
  }
  /** Close the list and stop any pending lookup. */
  close() {
    this.engine.cancel();
    if (!this.open && this.activeIndex === -1) return;
    this.open = false;
    this.activeIndex = -1;
    this.onChange();
  }
  /** The list as the dock renders it. */
  view() {
    const status = this.loading
      ? t('Looking up places…')
      : this.remote === 'unavailable'
        ? t('Online suggestions unavailable; showing saved places.')
        : this.showsEmpty()
          ? t('No matching places. Press Enter to search anyway.')
          : '';
    return {
      open: this.open,
      activeIndex: this.activeIndex,
      activeId:
        this.open && this.activeIndex >= 0
          ? `location-suggestion-${this.activeIndex}`
          : null,
      loading: this.loading,
      status,
      items: this.items.map((row, index) => {
        const label = String(row.place.label || row.place.name);
        const [title, ...rest] = label.split(', ');
        return {
          key: row.key,
          id: `location-suggestion-${index}`,
          title,
          detail: rest.join(', '),
          kind: t(kindOf(row.place, row.source)),
          source: t(SOURCE_LABELS[row.source] || msg('Place')),
          sourceId: row.source,
          active: index === this.activeIndex,
        };
      }),
    };
  }
  destroy() {
    this.engine.destroy();
  }
}
