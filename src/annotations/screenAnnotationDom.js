/**
 * Per-frame geometry writes for the screen annotation board.
 *
 * The board's view (src/ui/views/panels/ScreenAnnotations.vue) renders each
 * mark's STRUCTURE once — tags, keys, classes, static attributes, callout
 * text — and hands every element back to the renderer. The renderer then
 * writes the per-frame GEOMETRY (positions, sizes, opacity, display) straight
 * onto those elements, so a camera move never re-renders the view.
 *
 * Element kinds the view hands back for a mark:
 *   'group'           the mark's <g>          opacity, display
 *   'part:<childKey>' one shape of the mark   the part's `set` attrs, display
 *   'callout'         the callout's <g>       transform
 *   'card'            the callout card rect   width, height
 *   'accent'          the accent bar rect     height, x, y
 *   'text'            the callout text        (measured, never written)
 */

const DISPLAY = Symbol('display');

/** The values last written to each element, so unchanged ones are skipped. */
const written = new WeakMap();

function writtenTo(element) {
  let cache = written.get(element);
  if (!cache) {
    cache = new Map();
    written.set(element, cache);
  }
  return cache;
}

/** Set each attribute whose value differs from the one last written. */
export function writeAttributes(element, attrs) {
  const cache = writtenTo(element);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || cache.get(name) === value)
      continue;
    element.setAttribute(name, value);
    cache.set(name, value);
  }
}

/** Set the inline display ('' shows, 'none' hides), as the view used to. */
export function writeDisplay(element, value) {
  const cache = writtenTo(element);
  const next = value || '';
  if (cache.get(DISPLAY) === next) return;
  element.style.display = next;
  cache.set(DISPLAY, next);
}

/** A mark's shape parts in document order, keyed as the view keys them. */
export function partEntries(parts) {
  const entries = [];
  if (parts.poly) entries.push(['poly', parts.poly]);
  if (parts.path) entries.push(['path', parts.path]);
  parts.dots?.forEach((dot, index) => entries.push([`dot-${index}`, dot]));
  if (parts.ringOuter) entries.push(['ring-outer', parts.ringOuter]);
  if (parts.ringInner) entries.push(['ring-inner', parts.ringInner]);
  if (parts.dot) entries.push(['dot', parts.dot]);
  if (parts.leader) entries.push(['leader', parts.leader]);
  return entries;
}

const PART_PREFIX = 'part:';

function partFor(parts, kind) {
  const key = kind.slice(PART_PREFIX.length);
  return partEntries(parts).find(([entryKey]) => entryKey === key)?.[1];
}

function calloutGeometry(label, kind) {
  if (kind === 'callout') return { transform: label.transform };
  if (!label.sized) return null;
  if (kind === 'card')
    return { width: String(label.width), height: String(label.height) };
  if (kind === 'accent')
    return { height: String(label.height - 8), x: '0', y: '4' };
  return null;
}

/** Write a mark's current geometry onto one of its elements. */
export function writeMarkElement(rec, kind, element) {
  if (!element) return;
  if (kind === 'group') {
    writeAttributes(element, { opacity: rec.group.opacity });
    writeDisplay(element, rec.group.display);
    return;
  }
  if (kind.startsWith(PART_PREFIX)) {
    const part = partFor(rec.parts, kind);
    if (!part) return;
    writeAttributes(element, part.set);
    writeDisplay(element, part.display);
    return;
  }
  const label = rec.parts.label;
  const attrs = label ? calloutGeometry(label, kind) : null;
  if (attrs) writeAttributes(element, attrs);
}

/** Write a mark's current geometry onto every element it has. */
export function writeMark(rec) {
  for (const [kind, element] of rec.elements)
    writeMarkElement(rec, kind, element);
}

// --- Screen bounds -----------------------------------------------------------
// Each mark's on-screen extent, from the geometry the frame projected, so the
// tracked-entity fade never has to ask the browser for layout (getBBox).

export function emptyBounds() {
  return { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
}

/** Grow a frame-local bounds accumulator to cover a point (± radius). */
export function extendBounds(bounds, x, y, radius = 0) {
  const px = Number(x);
  const py = Number(y);
  if (!Number.isFinite(px) || !Number.isFinite(py)) return;
  bounds.left = Math.min(bounds.left, px - radius);
  bounds.right = Math.max(bounds.right, px + radius);
  bounds.top = Math.min(bounds.top, py - radius);
  bounds.bottom = Math.max(bounds.bottom, py + radius);
}

/**
 * A mark's final bounds: its shapes, its leader and its placed callout card,
 * or null when nothing was projected (as an empty getBBox was ignored).
 */
export function markBounds(shapes, parts) {
  const bounds = { ...(shapes ?? emptyBounds()) };
  const leader = parts.leader?.set;
  if (leader) {
    extendBounds(bounds, leader.x1, leader.y1);
    extendBounds(bounds, leader.x2, leader.y2);
  }
  const label = parts.label;
  if (label && Number.isFinite(label._x) && Number.isFinite(label._y)) {
    extendBounds(bounds, label._x, label._y);
    extendBounds(bounds, label._x + label.width, label._y + label.height);
  }
  if (!Number.isFinite(bounds.left)) return null;
  const width = bounds.right - bounds.left;
  const height = bounds.bottom - bounds.top;
  return width === 0 && height === 0 ? null : bounds;
}

/** Whether bounds touch a rectangle grown by a margin on every side. */
export function boundsOverlap(bounds, rect, margin) {
  return (
    bounds.left <= rect.right + margin &&
    bounds.right >= rect.left - margin &&
    bounds.top <= rect.bottom + margin &&
    bounds.bottom >= rect.top - margin
  );
}
