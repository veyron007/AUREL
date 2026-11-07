/** A profile accepts only evidenced orthometric elevations, never rendering fallbacks. */
function sameRequestedPoint(point, sample) {
  return (
    Number.isFinite(point?.lat) &&
    Number.isFinite(point?.lon) &&
    point.lat.toFixed(5) === sample.lat.toFixed(5) &&
    point.lon.toFixed(5) === sample.lon.toFixed(5)
  );
}

export function calculateProfile(sampling, envelope = {}) {
  const versions = new Set(),
    dates = [];
  const samples = sampling.samples.map((sample, index) => {
    const result = envelope.results?.[index];
    const provenance =
      result?.provenance || (envelope.tileset ? envelope : null);
    const accepted =
      provenance?.tileset === 'mapterhorn-egm08' &&
      typeof provenance.version === 'string' &&
      provenance.version.length > 0 &&
      provenance.version.length <= 100 &&
      (!Object.hasOwn(provenance, 'requested') ||
        sameRequestedPoint(provenance.requested, sample)) &&
      sameRequestedPoint(result, sample) &&
      (!result?.source || result.source === 'reearth') &&
      Number.isFinite(result?.elevation) &&
      result.elevation >= -12000 &&
      result.elevation <= 10000;
    if (accepted) {
      versions.add(`${provenance.tileset}@${provenance.version}`);
      if (
        typeof provenance.retrievedAt === 'string' &&
        Number.isFinite(Date.parse(provenance.retrievedAt))
      )
        dates.push(Date.parse(provenance.retrievedAt));
    }
    return { ...sample, elevationM: accepted ? result.elevation : null };
  });
  const heights = samples
    .map((sample) => sample.elevationM)
    .filter((value) => value !== null);
  return {
    datum: 'EGM2008',
    samples,
    minM: heights.length ? Math.min(...heights) : null,
    maxM: heights.length ? Math.max(...heights) : null,
    sampleSpacingM: sampling.sampleSpacingM,
    resolutionM: null,
    complete: heights.length === samples.length,
    datasetVersions: [...versions].sort(),
    sourceId: 'reearth',
    sourceLabel: 'Re:Earth / Mapterhorn',
    retrievedAt: dates.length
      ? new Date(Math.min(...dates)).toISOString()
      : null,
    attribution: 'Mapterhorn; Re:Earth',
    license: null,
    link: 'https://terrain.reearth.land/',
  };
}
