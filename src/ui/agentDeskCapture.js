import {
  LEGEND_FOOTNOTE,
  buildViewLegend,
  legendLines,
} from '../fieldkit/legend.js';
import { renderFreshCesiumFrame } from '../voice/realtimeViewport.js';

const DEFAULT_MAX_WIDTH = 1280;
const LINE_HEIGHT = 18;
const PADDING = 12;
const LEGEND_TITLE = 'Legend · layer — class · last refresh';
/** Fallbacks when the theme tokens cannot be read (canvas needs colours). */
const FALLBACK = Object.freeze({
  surface: '#0b1418',
  ink: '#e8e0cf',
  muted: '#a99f8c',
  accent: '#d6ab55',
});

function token(name, fallback) {
  try {
    const value = globalThis
      .getComputedStyle?.(globalThis.document.documentElement)
      .getPropertyValue(name)
      .trim();
    return value || fallback;
  } catch {
    return fallback;
  }
}

function drawLegend(ctx, { top, width, lines }) {
  const surface = token('--bg-panel', FALLBACK.surface);
  ctx.fillStyle = surface.startsWith('#') ? surface : FALLBACK.surface;
  ctx.fillRect(0, top, width, PADDING * 2 + LINE_HEIGHT * (lines.length + 1));
  ctx.textBaseline = 'top';
  ctx.font = '600 13px system-ui, sans-serif';
  ctx.fillStyle = token('--accent', FALLBACK.accent);
  ctx.fillText(LEGEND_TITLE, PADDING, top + PADDING);
  ctx.font = '12px system-ui, sans-serif';
  lines.forEach((line, index) => {
    ctx.fillStyle =
      index === lines.length - 1
        ? token('--text-secondary', FALLBACK.muted)
        : token('--text-primary', FALLBACK.ink);
    ctx.fillText(
      line,
      PADDING,
      top + PADDING + LINE_HEIGHT * (index + 1),
      width - PADDING * 2,
    );
  });
}

/**
 * `render_view`'s capture: a fresh globe frame with the legend drawn under
 * it, as base64 PNG, plus the legend rows as data. Null when the tab is
 * hidden or no fresh frame is drawn, so a stale frame is never passed off as
 * current.
 */
export function createViewCapture({
  viewer,
  readLayers,
  readBaseMap = () => null,
  now = Date.now,
}) {
  return async ({ maxWidth = DEFAULT_MAX_WIDTH } = {}) => {
    const source = viewer?.scene?.canvas;
    if (!source?.width || !source?.height) return null;
    if (!(await renderFreshCesiumFrame(viewer))) return null;
    const capturedAt = new Date(now()).toISOString();
    const legend = buildViewLegend(readLayers(), {
      now: now(),
      baseMap: readBaseMap(),
    });
    const lines = [...legendLines(legend), LEGEND_FOOTNOTE];
    const scale = Math.min(1, maxWidth / source.width);
    const width = Math.max(1, Math.round(source.width * scale));
    const height = Math.max(1, Math.round(source.height * scale));
    const canvas = globalThis.document.createElement('canvas');
    canvas.width = width;
    canvas.height = height + PADDING * 2 + LINE_HEIGHT * (lines.length + 1);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(source, 0, 0, width, height);
    drawLegend(ctx, { top: height, width, lines });
    const dataUrl = canvas.toDataURL('image/png');
    return {
      image: dataUrl.slice(dataUrl.indexOf(',') + 1),
      legend,
      width: canvas.width,
      height: canvas.height,
      captured_at: capturedAt,
    };
  };
}
