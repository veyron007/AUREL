import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CommandPalette,
  paletteRank,
  paletteShortcut,
} from './commandPalette.js';

function fixture({ placeItems = [], layerList = null } = {}) {
  const calls = [];
  let items = placeItems;
  const layers = layerList ?? [
    { id: 'local-firms', name: 'Active fires', enabled: false },
    { id: 'earthquakes', name: 'Earthquakes', enabled: true },
    { id: 'flights', name: 'Live flights', enabled: false },
    { id: 'locked', name: 'Locked feed', enabled: false, available: false },
  ];
  let changes = 0;
  const palette = new CommandPalette({
    places: {
      suggest: (text) => calls.push(['suggest', text]),
      items: () => items,
      status: () => '',
      choose: (index) => calls.push(['place', index]),
      close: () => calls.push(['close-places']),
    },
    layers: {
      list: () => layers,
      toggle: (id) => calls.push(['layer', id]),
    },
    actions: () => [
      {
        id: 'explore',
        title: 'Open Explore',
        keywords: ['explore'],
        run: () => calls.push(['action', 'explore']),
      },
      {
        id: 'reset',
        title: 'Reset to full globe view',
        keywords: ['globe', 'home'],
        run: () => calls.push(['action', 'reset']),
      },
    ],
    words: () => ({ layer: 'Layer', on: 'On', off: 'Off' }),
    onChange: () => changes++,
  });
  return {
    palette,
    calls,
    setPlaces: (next) => {
      items = next;
    },
    changes: () => changes,
  };
}

const key = (name, extra = {}) => ({ key: name, ...extra });

test('opening offers actions, enabled layers and recent places', () => {
  const { palette, calls } = fixture({
    placeItems: [{ key: 'r1', title: 'Dehradun', kind: 'City' }],
  });
  palette.open();
  assert.deepEqual(calls[0], ['suggest', '']);
  const view = palette.view();
  assert.equal(view.open, true);
  assert.deepEqual(
    view.sections.map((section) => section.id),
    ['actions', 'layers', 'places'],
  );
  assert.deepEqual(
    view.sections[1].rows.map((row) => row.title),
    ['Earthquakes'],
    'only enabled layers are offered before typing',
  );
  assert.equal(view.activeId, 'command-palette-row-0');
});

test('typing ranks layers by name and never offers an unavailable layer', () => {
  const { palette, calls } = fixture();
  palette.open();
  palette.setQuery('fire');
  assert.deepEqual(calls.at(-1), ['suggest', 'fire']);
  const view = palette.view();
  assert.equal(view.sections[0].id, 'layers', 'a strong local match leads');
  assert.equal(view.sections[0].rows[0].title, 'Active fires');
  palette.setQuery('locked');
  assert.ok(
    !palette
      .view()
      .sections.some((section) =>
        section.rows.some((row) => row.title === 'Locked feed'),
      ),
  );
});

test('places lead when nothing local matches strongly', () => {
  const { palette, setPlaces } = fixture();
  palette.open();
  setPlaces([
    { key: 'p1', title: 'Mussoorie', detail: 'Uttarakhand', kind: 'City' },
  ]);
  palette.setQuery('muss');
  const view = palette.view();
  assert.equal(view.sections[0].id, 'places');
  assert.equal(view.sections[0].rows[0].detail, 'Uttarakhand');
});

test('arrow keys wrap, Enter runs the highlighted row and closes', () => {
  const { palette, calls } = fixture();
  palette.open();
  palette.setQuery('e');
  const count = palette.rows.length;
  assert.ok(count >= 2);
  assert.equal(palette.key(key('ArrowUp')), true);
  assert.equal(palette.active, count - 1);
  assert.equal(palette.key(key('ArrowDown')), true);
  assert.equal(palette.active, 0);
  palette.key(key('ArrowDown'));
  const chosen = palette.rows[1];
  assert.equal(palette.key(key('Enter')), true);
  assert.equal(palette.isOpen, false);
  assert.ok(calls.some(([, value]) => chosen.key.endsWith(String(value))));
  assert.deepEqual(calls.at(-1), ['close-places']);
});

test('choosing a place uses the location owner with the listed index', () => {
  const { palette, calls, setPlaces } = fixture();
  palette.open();
  setPlaces([
    { key: 'a', title: 'Rishikesh' },
    { key: 'b', title: 'Haridwar' },
  ]);
  palette.setQuery('zzz');
  palette.refresh();
  const index = palette.rows.findIndex((row) => row.title === 'Haridwar');
  palette.activate(index);
  assert.ok(calls.some((call) => call[0] === 'place' && call[1] === 1));
});

test('choosing a layer toggles it through the layer owner', () => {
  const { palette, calls } = fixture();
  palette.open();
  palette.setQuery('earthquakes');
  palette.activate();
  assert.ok(
    calls.some((call) => call[0] === 'layer' && call[1] === 'earthquakes'),
  );
});

test('Escape closes; Tab is kept inside; other keys type', () => {
  const { palette } = fixture();
  palette.open();
  assert.equal(palette.key(key('Tab')), true);
  assert.equal(palette.key(key('a')), false);
  assert.equal(palette.key(key('Home')), false, 'Home moves the caret');
  assert.equal(palette.key(key('ArrowDown', { isComposing: true })), false);
  assert.equal(palette.key(key('Escape')), true);
  assert.equal(palette.isOpen, false);
  assert.deepEqual(palette.view(), { open: false });
  assert.equal(palette.key(key('Enter')), false);
});

test('refresh keeps the highlighted row when new places arrive', () => {
  const { palette, setPlaces } = fixture();
  palette.open();
  palette.setQuery('e');
  palette.move(1);
  const keyBefore = palette.rows[palette.active].key;
  setPlaces([{ key: 'late', title: 'Late answer' }]);
  palette.refresh();
  assert.equal(palette.rows[palette.active].key, keyBefore);
});

test('a throwing source or row does not break the palette', () => {
  const palette = new CommandPalette({
    places: {
      suggest() {
        throw new Error('offline');
      },
      items() {
        throw new Error('offline');
      },
      choose() {},
      close() {
        throw new Error('offline');
      },
    },
    actions: () => [
      {
        id: 'bad',
        title: 'Broken',
        run: () => Promise.reject(new Error('owner failed')),
      },
    ],
  });
  palette.open();
  assert.equal(palette.view().sections[0].rows[0].title, 'Broken');
  assert.equal(palette.activate(), true);
  assert.equal(palette.isOpen, false);
  palette.destroy();
  palette.open();
  assert.equal(palette.isOpen, false, 'a destroyed palette stays closed');
});

test('queries are bounded and ranks prefer exact and prefix matches', () => {
  const { palette } = fixture();
  palette.open();
  palette.setQuery('x'.repeat(500));
  assert.equal(palette.query.length, 120);
  assert.equal(paletteRank('earth', ['Earthquakes']), 1);
  assert.equal(paletteRank('quakes', ['Earthquakes']), 3);
  assert.equal(paletteRank('zzz', ['Earthquakes']), null);
});

test('⌘K and Ctrl+K toggle; "/" opens only outside fields', () => {
  const field = {
    closest: (selector) => (selector.includes('input') ? field : null),
  };
  const map = { closest: () => null };
  assert.equal(
    paletteShortcut({ key: 'k', metaKey: true, target: field }),
    'toggle',
  );
  assert.equal(
    paletteShortcut({ key: 'K', ctrlKey: true, target: map }),
    'toggle',
  );
  assert.equal(
    paletteShortcut({ key: 'k', ctrlKey: true, shiftKey: true }),
    null,
  );
  assert.equal(paletteShortcut({ key: '/', target: map }), 'open');
  assert.equal(paletteShortcut({ key: '/', target: field }), null);
  assert.equal(
    paletteShortcut({ key: '/', target: map, defaultPrevented: true }),
    null,
  );
  assert.equal(paletteShortcut({ key: 'k', target: map }), null);
});
