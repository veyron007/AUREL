/**
 * @module worldOverlayBitmaps
 * @description Cached card and label bodies for the shared world overlay.
 *
 * A card body (plate, border, accent rule and text) is drawn once into a
 * small bitmap at the device scale it is shown at, and later frames blit it
 * with one `drawImage` instead of re-running the path and glyph work. Leaders
 * and anchor dots stay live because they follow the anchor every frame.
 *
 * Exactness: the bitmap carries the body at the same device-pixel phase as a
 * direct paint. Card rects sit on whole CSS pixels and the bitmap's margin is
 * a whole number of device pixels, so the blit maps texels 1:1. The body is
 * drawn into the bitmap with the card's own opacity and blitted at full
 * opacity: source-over is associative, so painting the body's operations at
 * alpha a onto a clear bitmap and compositing that once equals painting them
 * one by one onto the overlay (to within rounding). A faded card at rest
 * therefore looks exactly as before, not like a group-faded layer.
 *
 * A bitmap is made only for a body whose scale and opacity held for three
 * frames, at most eight new ones per frame, so a zoom or fade that changes
 * them every frame paints directly as before and never churns the cache. The cache is bounded by total texels and evicts the
 * least recently used body. Without an installed surface factory (node tests,
 * a browser without canvas) every painter paints directly.
 */

/** Frames a body's scale and opacity must hold before it is cached. */
const STABLE_FRAMES = 3;
/** New bitmaps drawn per overlay frame at most. */
const MAX_BUILDS_PER_FRAME = 8;
let _buildsThisFrame = 0;

/** Call once per overlay frame, before painting. */
export function beginOverlayBitmapFrame() {
  _buildsThisFrame = 0;
}

/** Device-pixel margin around a body for strokes that straddle its edge. */
const MARGIN_DEVICE_PX = 3;
/** Default texel budget: about 16 MB of RGBA. */
export const DEFAULT_BITMAP_TEXEL_BUDGET = 4_194_304;

let _createSurface = null;
let _texelBudget = DEFAULT_BITMAP_TEXEL_BUDGET;
let _texels = 0;
let _dpr = 1;
/** Content key -> bitmap; Map order is recency (oldest first). */
let _bitmaps = new Map();
let _diagnostics = { hits: 0, builds: 0, direct: 0, evictions: 0 };

/**
 * Enable cached bodies.
 * @param {{createSurface: function(number, number): ?HTMLCanvasElement,
 *   texelBudget?: number}} options
 */
export function installOverlayBitmaps({ createSurface, texelBudget } = {}) {
  if (typeof createSurface !== 'function')
    throw new TypeError('installOverlayBitmaps needs a createSurface function');
  _createSurface = createSurface;
  _texelBudget =
    Number.isFinite(texelBudget) && texelBudget > 0
      ? texelBudget
      : DEFAULT_BITMAP_TEXEL_BUDGET;
  clearOverlayBitmaps();
}

/** Disable cached bodies and release every bitmap. */
export function uninstallOverlayBitmaps() {
  _createSurface = null;
  clearOverlayBitmaps();
}

/** Drop every bitmap (fonts loaded, canvas resized, host destroyed). */
export function clearOverlayBitmaps() {
  _bitmaps = new Map();
  _texels = 0;
  _buildsThisFrame = 0;
}

/**
 * The host canvas's device pixel ratio; bodies are drawn at dpr x paintScale.
 * @param {number} dpr
 */
export function setOverlayBitmapDpr(dpr) {
  const next = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  if (next === _dpr) return;
  _dpr = next;
  clearOverlayBitmaps();
}

/** @returns {{hits:number,builds:number,direct:number,evictions:number,count:number,texels:number}} */
export function getOverlayBitmapDiagnostics() {
  return { ..._diagnostics, count: _bitmaps.size, texels: _texels };
}

export function resetOverlayBitmapDiagnostics() {
  _diagnostics = { hits: 0, builds: 0, direct: 0, evictions: 0 };
}

function sameDetails(a, b) {
  const list = Array.isArray(b) ? b : [];
  if (a.length !== list.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== list[i]) return false;
  return true;
}

/** The entry's memo still describes this body at this scale and opacity. */
function memoMatches(memo, kind, entry, rect, scale, alpha, layout) {
  return (
    memo.kind === kind &&
    memo.scale === scale &&
    memo.alpha === alpha &&
    memo.w === rect.w &&
    memo.h === rect.h &&
    memo.title === entry.title &&
    memo.accent === entry.accent &&
    memo.padX === layout?.padX &&
    memo.padY === layout?.padY &&
    memo.titleH === layout?.titleH &&
    memo.lineH === layout?.lineH &&
    sameDetails(memo.details, entry.details)
  );
}

function contentKey(memo) {
  return [
    memo.kind,
    memo.scale,
    memo.alpha,
    memo.w,
    memo.h,
    memo.accent ?? '',
    memo.padX,
    memo.padY,
    memo.titleH,
    memo.lineH,
    memo.title ?? '',
    ...memo.details,
  ].join('\u0001');
}

function evictToBudget() {
  for (const [key, bitmap] of _bitmaps) {
    if (_texels <= _texelBudget) return;
    _bitmaps.delete(key);
    _texels -= bitmap.texels;
    _diagnostics.evictions++;
  }
}

function lookupOrBuild(memo, entry, drawBody) {
  const key = contentKey(memo);
  const found = _bitmaps.get(key);
  if (found) {
    // Refresh recency; this runs once per entry object, not per frame.
    _bitmaps.delete(key);
    _bitmaps.set(key, found);
    return found;
  }
  // New bitmaps are spread over frames so a burst of fresh cards (a data
  // refresh, the end of a zoom) never stalls one frame; the rest paint
  // directly until their turn.
  if (_buildsThisFrame >= MAX_BUILDS_PER_FRAME) return null;
  _buildsThisFrame++;
  const offset = Math.ceil(MARGIN_DEVICE_PX);
  const width = Math.ceil(memo.w * memo.scale) + offset * 2;
  const height = Math.ceil(memo.h * memo.scale) + offset * 2;
  if (width * height > _texelBudget / 4) return null;
  const surface = _createSurface(width, height);
  const bctx = surface?.getContext?.('2d');
  if (!bctx) return null;
  bctx.setTransform(memo.scale, 0, 0, memo.scale, offset, offset);
  bctx.globalAlpha = memo.alpha;
  drawBody(bctx, entry, memo.rect, memo.kind);
  const bitmap = { surface, width, height, offset, texels: width * height };
  _bitmaps.set(key, bitmap);
  _texels += bitmap.texels;
  _diagnostics.builds++;
  evictToBudget();
  return bitmap;
}

/**
 * The entry's memo, rewritten in place when the body changed. The memo is
 * per-entry scratch owned by this module; reusing it keeps a zoom or fade,
 * where scale or opacity changes every frame, free of allocation.
 */
function currentMemo(ctx, entry, kind, rect, scale, alpha, layout) {
  let memo = entry._overlayBitmapMemo;
  if (memo && memoMatches(memo, kind, entry, rect, scale, alpha, layout)) {
    memo.seen++;
    return memo;
  }
  if (!memo) {
    memo = { rect: { x: 0, y: 0, w: 0, h: 0 }, details: [], ltr: null };
    entry._overlayBitmapMemo = memo;
  }
  memo.kind = kind;
  memo.scale = scale;
  memo.alpha = alpha;
  memo.w = memo.rect.w = rect.w;
  memo.h = memo.rect.h = rect.h;
  memo.title = entry.title;
  memo.accent = entry.accent;
  memo.padX = layout?.padX;
  memo.padY = layout?.padY;
  memo.titleH = layout?.titleH;
  memo.lineH = layout?.lineH;
  const details = Array.isArray(entry.details) ? entry.details : [];
  memo.details.length = details.length;
  for (let i = 0; i < details.length; i++) memo.details[i] = details[i];
  memo.bitmap = null;
  memo.ltr ??= directionIsLtr(ctx);
  // Seen once: a zoom or fade may still be moving it.
  memo.seen = 1;
  return memo;
}

function directionIsLtr(ctx) {
  const canvas = ctx?.canvas;
  if (!canvas || typeof getComputedStyle !== 'function') return true;
  try {
    return getComputedStyle(canvas).direction !== 'rtl';
  } catch {
    return true;
  }
}

/**
 * Paint one body from its cached bitmap when possible.
 *
 * `drawBody(ctx, entry, rect, kind)` must draw the body with `rect` as its
 * box and set every context property it relies on; it is called once per
 * bitmap and, on the direct path, on the caller's context.
 *
 * @param {CanvasRenderingContext2D} ctx Host context (dpr x paintScale transform).
 * @param {object} entry Normalized overlay entry (carries the memo).
 * @param {string} kind Body kind: label, track, card, selected or tactical.
 * @param {{x:number,y:number,w:number,h:number}} rect Body rect in ctx units.
 * @param {number} paintScale Card scale inside the host transform.
 * @param {?object} layout Measured layout the body reads (tactical only).
 * @param {function} drawBody Body painter.
 * @returns {void}
 */
export function paintOverlayBody(
  ctx,
  entry,
  kind,
  rect,
  paintScale,
  layout,
  drawBody,
) {
  if (!_createSurface) {
    drawBody(ctx, entry, rect, kind);
    return;
  }
  const scale = _dpr * (paintScale || 1);
  const alpha = ctx.globalAlpha;
  const memo = currentMemo(ctx, entry, kind, rect, scale, alpha, layout);
  if (!memo.bitmap && memo.ltr && memo.seen >= STABLE_FRAMES)
    memo.bitmap = lookupOrBuild(memo, entry, drawBody);
  if (!memo.bitmap) {
    _diagnostics.direct++;
    drawBody(ctx, entry, rect, kind);
    return;
  }
  _diagnostics.hits++;
  const { surface, width, height, offset } = memo.bitmap;
  // The opacity is in the bitmap already.
  ctx.globalAlpha = 1;
  ctx.drawImage(
    surface,
    rect.x - offset / scale,
    rect.y - offset / scale,
    width / scale,
    height / scale,
  );
  ctx.globalAlpha = alpha;
}
