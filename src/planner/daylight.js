import { observerSolarElevation } from '../data/satellitePass.js';
export const DAYLIGHT_METHOD =
  'USNO low-precision solar position; standard -0.833° sunrise and -6° civil twilight; no terrain horizon';
const HOUR = 3600000;
function formatter(timeZone) {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
  } catch {
    throw new Error('Invalid IANA time zone.');
  }
}
function parts(at, format) {
  const values = Object.fromEntries(
    format
      .formatToParts(new Date(at))
      .filter((item) => item.type !== 'literal')
      .map((item) => [item.type, item.value]),
  );
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    time: `${values.hour}:${values.minute}:${values.second}`,
  };
}
export function localDateAt(instant, timeZone) {
  const time = typeof instant === 'number' ? instant : Date.parse(instant);
  if (!Number.isFinite(time)) throw new Error('Invalid departure instant.');
  return parts(time, formatter(timeZone)).date;
}
function validateLocal(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(value))
    throw new Error('Invalid local date and time.');
  const at = Date.parse(`${value}:00Z`);
  if (
    !Number.isFinite(at) ||
    new Date(at).toISOString().slice(0, 16) !== value ||
    Number(value.slice(0, 4)) < 1900 ||
    Number(value.slice(0, 4)) > 2100
  )
    throw new Error('Invalid local date and time (1900–2100).');
  return at;
}
/** Reject skipped/ambiguous civil times rather than silently choosing a DST offset. */
export function resolveLocalDateTime(value, timeZone = 'Asia/Kolkata') {
  const nominal = validateLocal(value),
    format = formatter(timeZone),
    offsets = new Set();
  for (let hours = -36; hours <= 36; hours += 3) {
    const at = nominal + hours * HOUR,
      p = parts(at, format);
    offsets.add(Date.parse(`${p.date}T${p.time}Z`) - at);
  }
  const candidates = [...offsets]
    .map((offset) => nominal - offset)
    .filter((at) => {
      const p = parts(at, format);
      return `${p.date}T${p.time.slice(0, 5)}` === value;
    });
  if (!candidates.length)
    throw new Error('This local time does not exist (time-zone gap).');
  if (candidates.length !== 1)
    throw new Error(
      'This local time is ambiguous; choose a time outside the clock change.',
    );
  return new Date(candidates[0]).toISOString();
}
function dayBounds(localDate, timeZone) {
  const noon = Date.parse(resolveLocalDateTime(`${localDate}T12:00`, timeZone)),
    format = formatter(timeZone);
  const dateAt = (at) => parts(at, format).date;
  function edge(before, after) {
    while (after - before > 1) {
      const mid = Math.floor((before + after) / 2);
      if (dateAt(mid) < localDate) before = mid;
      else after = mid;
    }
    return after;
  }
  const start = edge(noon - 36 * HOUR, noon);
  let left = noon,
    right = noon + 36 * HOUR;
  while (right - left > 1) {
    const mid = Math.floor((left + right) / 2);
    if (dateAt(mid) <= localDate) left = mid;
    else right = mid;
  }
  return [start, right];
}
function crossings(lat, lon, start, end, threshold) {
  const elevation = (at) => observerSolarElevation(lat, lon, at) - threshold;
  let previousAt = start,
    previous = elevation(start),
    rise = null,
    set = null,
    dayMs = 0,
    litStart = previous >= 0 ? start : null;
  for (
    let at = Math.min(start + 300000, end);
    previousAt < end;
    at = Math.min(at + 300000, end)
  ) {
    const current = elevation(at);
    if ((previous < 0 && current >= 0) || (previous >= 0 && current < 0)) {
      let left = previousAt,
        right = at;
      for (
        let iteration = 0;
        iteration < 20 && right - left > 1000;
        iteration++
      ) {
        const middle = (left + right) / 2;
        if (elevation(middle) >= 0 === previous >= 0) left = middle;
        else right = middle;
      }
      const event = Math.round((left + right) / 2);
      if (current >= 0) {
        rise ??= event;
        litStart = event;
      } else {
        set ??= event;
        if (litStart !== null) dayMs += event - litStart;
        litStart = null;
      }
    }
    previousAt = at;
    previous = current;
  }
  if (litStart !== null) dayMs += end - litStart;
  return {
    rise,
    set,
    daylightSeconds: Math.round(dayMs / 1000),
    litAtStart: elevation(start) >= 0,
  };
}
export function calculateDaylight({
  lat,
  lon,
  localDate,
  timeZone = 'Asia/Kolkata',
}) {
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    Math.abs(lat) > 90 ||
    Math.abs(lon) > 180
  )
    throw new Error('Invalid daylight location.');
  const [start, end] = dayBounds(localDate, timeZone);
  const sun = crossings(lat, lon, start, end, -0.833),
    civil = crossings(lat, lon, start, end, -6);
  const iso = (value) =>
    value === null ? null : new Date(value).toISOString();
  const polarState =
    sun.rise !== null && sun.set !== null
      ? 'normal'
      : sun.rise === null && sun.set === null
        ? sun.litAtStart
          ? 'polar-day'
          : 'polar-night'
        : 'transition';
  return {
    sunrise: iso(sun.rise),
    sunset: iso(sun.set),
    civilDawn: iso(civil.rise),
    civilDusk: iso(civil.set),
    daylightSeconds: sun.daylightSeconds,
    polarState,
    method: DAYLIGHT_METHOD,
  };
}
