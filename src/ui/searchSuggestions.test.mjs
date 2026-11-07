import test from 'node:test';
import assert from 'node:assert/strict';
import { SearchSuggestions } from './searchSuggestions.js';

const place = (name, extra = {}) => ({
  lat: 30.3,
  lng: 78.0,
  name,
  label: `${name}, Uttarakhand, India`,
  types: ['locality'],
  ...extra,
});

/** A stand-in engine: update() answers synchronously with the rows given. */
function harness(rows) {
  let changes = 0;
  const calls = { cancel: 0, update: [] };
  const list = new SearchSuggestions({
    createEngine: (onUpdate) => ({
      update(text, options) {
        calls.update.push([text, options]);
        onUpdate({
          query: text,
          items: rows(text),
          loading: false,
          remote: 'done',
        });
      },
      cancel() {
        calls.cancel++;
      },
      destroy() {},
    }),
    onChange: () => changes++,
  });
  return { list, calls, changes: () => changes };
}

const rowsFor = (names) => () =>
  names.map((name, i) => ({
    key: `k${i}`,
    source: i ? 'remote' : 'preset',
    place: place(name),
  }));

test('typing opens the list; arrows move and wrap; Escape closes', () => {
  const { list } = harness(rowsFor(['Dehradun', 'Dehradun Cantonment']));
  list.input('dehr', 'bias');
  assert.equal(list.open, true);
  assert.equal(list.activeIndex, -1);
  assert.ok(list.key({ key: 'ArrowDown' }));
  assert.equal(list.activeIndex, 0);
  list.key({ key: 'ArrowDown' });
  list.key({ key: 'ArrowDown' });
  assert.equal(list.activeIndex, 0, 'wraps to the top');
  list.key({ key: 'ArrowUp' });
  assert.equal(list.activeIndex, 1, 'wraps to the bottom');
  assert.equal(list.active().place.name, 'Dehradun Cantonment');
  assert.ok(list.key({ key: 'Escape' }));
  assert.equal(list.open, false);
  assert.equal(list.active(), null);
});

test('Enter and letters are left to the field', () => {
  const { list } = harness(rowsFor(['Dehradun']));
  list.input('dehr');
  assert.equal(list.key({ key: 'Enter' }), false);
  assert.equal(list.key({ key: 'a' }), false);
});

test('the view names each row, its kind and source, and the active option', () => {
  const { list } = harness(rowsFor(['Dehradun', 'Rajpur']));
  list.input('d');
  list.key({ key: 'ArrowDown' });
  const view = list.view();
  assert.equal(view.open, true);
  assert.equal(view.activeId, 'location-suggestion-0');
  assert.equal(view.items[0].title, 'Dehradun');
  assert.equal(view.items[0].detail, 'Uttarakhand, India');
  assert.equal(view.items[0].kind, 'City');
  assert.equal(view.items[0].source, 'Bundled place');
  assert.equal(view.items[1].source, 'OpenStreetMap');
});

test('an empty answer for a real query says so instead of closing silently', () => {
  const { list } = harness(() => []);
  list.input('zzzzq');
  assert.equal(list.open, true);
  assert.match(list.view().status, /No matching places/);
});

test('close cancels pending lookups', () => {
  const { list, calls } = harness(rowsFor(['Dehradun']));
  list.input('deh');
  list.close();
  assert.equal(calls.cancel, 1);
  assert.equal(list.open, false);
});
