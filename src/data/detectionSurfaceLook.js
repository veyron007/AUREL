/**
 * The detection sensor surface's look, drawn into the canvas instead of
 * applied by a CSS filter chain on the full-viewport surface.
 *
 * The surface used `filter: contrast(c) saturate(s) drop-shadow(0 0 3px glow)`,
 * which the compositor re-ran over the whole viewport on every rendered
 * frame. The same look now costs nothing per pixel:
 *  - contrast and saturate are colour transforms, and every stroke on the
 *    surface is a flat colour, so the transformed colour is computed once per
 *    colour (`sensorColor`). The CSS functions work on straight (not
 *    premultiplied) sRGB values, as this does, so antialiased edges keep the
 *    same ratio of colour to coverage.
 *  - the drop-shadow is a faint Gaussian halo (sigma = 1.5 px) under 1 px
 *    lines; two wider, faint strokes in the glow colour under each batch
 *    rebuild its profile (about 8% of the glow at 1 px, 4.5% at 2 px).
 * `mix-blend-mode: screen` stays: it is one blend in the compositor and is
 * what lets the sensor lines lighten the scene.
 */

const COLOR_PATTERN =
  /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i;
const HEX_PATTERN = /^#([0-9a-f]{6})$/i;

/**
 * Glow strokes that rebuild a 3 px CSS drop-shadow under a 1 px line:
 * width added to the line, and opacity relative to the glow colour.
 */
export const GLOW_STROKES = Object.freeze([
  Object.freeze({ extraWidth: 4, alpha: 0.11 }),
  Object.freeze({ extraWidth: 2, alpha: 0.105 }),
]);

/**
 * Parse `rgb()`, `rgba()` or `#rrggbb`.
 * @param {string} text
 * @returns {?{r:number,g:number,b:number,a:number}} Channels 0..255, alpha 0..1.
 */
export function parseCssColor(text) {
  const value = String(text ?? '').trim();
  const hex = value.match(HEX_PATTERN);
  if (hex) {
    const n = Number.parseInt(hex[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }
  const rgb = value.match(COLOR_PATTERN);
  if (!rgb) return null;
  return {
    r: Number(rgb[1]),
    g: Number(rgb[2]),
    b: Number(rgb[3]),
    a: rgb[4] === undefined ? 1 : Number(rgb[4]),
  };
}

/**
 * The factors of a `contrast(c) saturate(s)` filter string.
 * @param {string} filter
 * @returns {{contrast:number, saturate:number}}
 */
export function parseSensorFilter(filter) {
  const read = (name) => {
    const match = String(filter ?? '').match(
      new RegExp(`${name}\\(\\s*([\\d.]+)\\s*\\)`),
    );
    return match ? Number(match[1]) : 1;
  };
  return { contrast: read('contrast'), saturate: read('saturate') };
}

const clampUnit = (v) => Math.min(1, Math.max(0, v));

/**
 * CSS `contrast(c)` then `saturate(s)` on one straight-alpha colour.
 * @param {{r:number,g:number,b:number,a:number}} color
 * @param {{contrast:number, saturate:number}} factors
 * @returns {{r:number,g:number,b:number,a:number}}
 */
export function filterColor(color, { contrast, saturate }) {
  const k = (v) => clampUnit((v / 255) * contrast + (0.5 - 0.5 * contrast));
  const r = k(color.r);
  const g = k(color.g);
  const b = k(color.b);
  const s = saturate;
  return {
    r:
      clampUnit(
        (0.213 + 0.787 * s) * r +
          (0.715 - 0.715 * s) * g +
          (0.072 - 0.072 * s) * b,
      ) * 255,
    g:
      clampUnit(
        (0.213 - 0.213 * s) * r +
          (0.715 + 0.285 * s) * g +
          (0.072 - 0.072 * s) * b,
      ) * 255,
    b:
      clampUnit(
        (0.213 - 0.213 * s) * r +
          (0.715 - 0.715 * s) * g +
          (0.072 + 0.928 * s) * b,
      ) * 255,
    a: color.a,
  };
}

function formatColor({ r, g, b, a }) {
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${a})`;
}

/**
 * A memo of filtered colours for one theme's filter string. Strokes on the
 * surface use a handful of colours, so each is transformed once.
 * @param {string} filter Theme filter, e.g. 'contrast(1.08) saturate(1.04)'.
 * @returns {function(string): string} Colour as it looked through the filter.
 */
export function createSensorPalette(filter) {
  const factors = parseSensorFilter(filter);
  const memo = new Map();
  return (css) => {
    let out = memo.get(css);
    if (out === undefined) {
      const parsed = parseCssColor(css);
      out = parsed ? formatColor(filterColor(parsed, factors)) : css;
      memo.set(css, out);
    }
    return out;
  };
}

/**
 * Stroke a batched path with its glow halo underneath.
 * @param {CanvasRenderingContext2D} ctx
 * @param {?Path2D} path Batched path, or null for the current path.
 * @param {string} color Filtered stroke colour.
 * @param {string} glow Glow colour (the drop-shadow colour; not filtered).
 * @param {number} alpha Batch opacity.
 * @param {number} lineWidth Line width in CSS px.
 */
export function strokeWithGlow(ctx, path, color, glow, alpha, lineWidth) {
  ctx.strokeStyle = glow;
  for (let i = 0; i < GLOW_STROKES.length; i++) {
    const stroke = GLOW_STROKES[i];
    ctx.globalAlpha = alpha * stroke.alpha;
    ctx.lineWidth = lineWidth + stroke.extraWidth;
    strokePath(ctx, path);
  }
  ctx.globalAlpha = alpha;
  ctx.lineWidth = lineWidth;
  ctx.strokeStyle = color;
  strokePath(ctx, path);
}

function strokePath(ctx, path) {
  if (path) ctx.stroke(path);
  else ctx.stroke();
}

function documentTile(width, height) {
  if (typeof document === 'undefined') return null;
  const tile = document.createElement('canvas');
  tile.width = width;
  tile.height = height;
  return tile;
}

/** One cached 1 x 4 px scanline tile per colour, as a repeating pattern. */
export function createScanlinePatternCache(createSurface = documentTile) {
  const patterns = new Map();
  return (ctx, color) => {
    if (patterns.has(color)) return patterns.get(color);
    const tile = createSurface?.(1, 4);
    const tileCtx = tile?.getContext?.('2d');
    let pattern = null;
    if (tileCtx) {
      tileCtx.fillStyle = color;
      tileCtx.fillRect(0, 0, 1, 1);
      pattern = ctx.createPattern?.(tile, 'repeat') ?? null;
    }
    patterns.set(color, pattern);
    return pattern;
  };
}
