export function comparisonInput(date) {
  return {
    sourceId: 'nasa-gibs',
    sourceLabel: 'NASA GIBS HLS S30',
    time: { kind: 'day', date },
    retrievedAt: '2026-11-07T06:00:00.000Z',
    probedAt: '2026-11-07T06:00:00.000Z',
    license: 'NASA Earth science data policy',
    attribution: 'NASA GIBS / HLS',
    asset: { kind: 'gibs', productId: 'S30', requestedDate: date },
    georeference: { crs: 'EPSG:4326', extent: [77, 29, 79, 31] },
    nativeResolutionM: 30,
    cloudCoverPct: null,
    cloudScope: 'scene',
    granuleIds: ['granule-' + date],
    availability: 'present',
    coverage: 'partial',
    alignment: 'unverified',
  };
}
export function comparisonSnapshot() {
  return {
    version: 1,
    // i18n-ignore: immutable test fixture metadata, never production UI copy
    title: 'Dehradun seasonal comparison',
    capturedAt: '2026-11-07T06:00:00.000Z',
    extent: [78, 30, 78.1, 30.4],
    method: 'manual-visual',
    splitPosition: 0.5,
    before: comparisonInput('2026-01-01'),
    after: comparisonInput('2026-10-01'),
  };
}
