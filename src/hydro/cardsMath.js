/**
 * Arithmetic behind the Raindrop data cards. Pure and unit-free in the sense
 * that it never formats: callers attach source, unit, time and class.
 */

/**
 * Percentile rank of one day's GloFAS value within the returned past days of
 * the same 0.05° cell (inclusive rank, 0–100). Forecast days are excluded
 * from the reference set. This is a rank inside the model's own recent
 * series, not a return period and not a discharge.
 * @param {{time:string[], values:(number|null)[]}} series Daily GMT dates.
 * @param {number} nowMs
 */
export function glofasPercentile(series, nowMs) {
  const today = new Date(nowMs).toISOString().slice(0, 10);
  const index = series.time.indexOf(today);
  if (index < 0 || !Number.isFinite(series.values[index]))
    return { status: 'no-today' };
  const reference = [];
  for (let i = 0; i < index; i++)
    if (Number.isFinite(series.values[i])) reference.push(series.values[i]);
  if (reference.length < 30) return { status: 'short-series', n: reference.length };
  const value = series.values[index];
  const atOrBelow = reference.filter((v) => v <= value).length;
  return {
    status: 'ok',
    percentile: Math.round((atOrBelow / reference.length) * 100),
    n: reference.length,
    day: today,
    from: series.time[0],
    to: series.time[index - 1],
  };
}

/**
 * Up to `k` representative points for a polygon forecast: the area-weighted
 * centres of the IMERG cells, grouped by a deterministic farthest-point seed
 * and one assignment pass. Each point carries the share of catchment area it
 * represents.
 * @param {Array<{center:[number, number], km2:number}>} cells
 */
export function representativePoints(cells, k = 3) {
  const usable = cells.filter((cell) => cell.km2 > 0);
  if (!usable.length) return [];
  const total = usable.reduce((sum, cell) => sum + cell.km2, 0);
  const seeds = [usable.reduce((a, b) => (b.km2 > a.km2 ? b : a)).center];
  const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
  while (seeds.length < Math.min(k, usable.length)) {
    let best = null,
      bestDistance = -1;
    for (const cell of usable) {
      const distance = Math.min(...seeds.map((seed) => d2(seed, cell.center)));
      if (distance > bestDistance) {
        best = cell;
        bestDistance = distance;
      }
    }
    if (bestDistance <= 0) break;
    seeds.push(best.center);
  }
  const groups = seeds.map(() => ({ km2: 0, lon: 0, lat: 0 }));
  for (const cell of usable) {
    let index = 0;
    seeds.forEach((seed, i) => {
      if (d2(seed, cell.center) < d2(seeds[index], cell.center)) index = i;
    });
    const group = groups[index];
    group.km2 += cell.km2;
    group.lon += cell.center[0] * cell.km2;
    group.lat += cell.center[1] * cell.km2;
  }
  return groups
    .filter((group) => group.km2 > 0)
    .map((group) => ({
      lat: +(group.lat / group.km2).toFixed(2),
      lon: +(group.lon / group.km2).toFixed(2),
      share: group.km2 / total,
    }));
}

/**
 * Weighted polygon totals for the next hours from hourly forecast points.
 * @param {Array<{time:string[], precipitation:(number|null)[]}>} points
 * @param {number[]} shares Matching weights that sum to one.
 * @param {number[]} windows Hours ahead, e.g. [1, 3, 24].
 */
export function polygonForecast(points, shares, nowMs, windows = [1, 3, 24]) {
  const start = Math.floor(nowMs / 3600_000) * 3600_000;
  return windows.map((hours) => {
    let total = 0,
      complete = true;
    points.forEach((point, index) => {
      let sum = 0;
      for (let h = 1; h <= hours; h++) {
        // Open-Meteo hourly precipitation is the total of the preceding hour.
        const at = point.time.indexOf(
          new Date(start + h * 3600_000).toISOString().slice(0, 19) + 'Z',
        );
        const value = at >= 0 ? point.precipitation[at] : null;
        if (!Number.isFinite(value)) complete = false;
        else sum += value;
      }
      total += sum * shares[index];
    });
    return {
      hours,
      totalMm: total,
      complete,
      from: new Date(start).toISOString(),
      to: new Date(start + hours * 3600_000).toISOString(),
    };
  });
}

/** Minutes between an observation time and now, never negative. */
export function latencyMinutes(observedIso, nowMs) {
  const at = Date.parse(observedIso);
  if (!Number.isFinite(at)) return null;
  return Math.max(0, Math.round((nowMs - at) / 60_000));
}

