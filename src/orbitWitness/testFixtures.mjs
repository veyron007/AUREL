/**
 * Orbit Witness fixtures. TLEs are CelesTrak GP sets retrieved on
 * 2026-11-07 (epochs 2026-11-06). The KML is synthetic, written for these
 * tests in ESA's plan schema; it contains no ESA plan content.
 */
export const FIXTURE_TLE = `SENTINEL-2A
1 40697U 15028A   26310.80198507  .00000130  00000+0  66214-4 0  9998
2 40697  98.5623  23.5608 0001145  96.7125 263.4188 14.30819102594128
SENTINEL-2B
1 42063U 17013A   26310.86486051 -.00000053  00000+0 -34863-5 0  9995
2 42063  98.5730  23.6007 0001100  91.9384 268.1925 14.30818044505043
SENTINEL-2C
1 60989U 24157A   26310.75990618  .00000072  00000+0  44072-4 0  9997
2 60989  98.5738  23.4915 0000861  95.4578 264.6703 14.30811052113379
LANDSAT 8
1 39084U 13008A   26310.78935522  .00000260  00000+0  67747-4 0  9991
2 39084  98.2159  19.1121 0001274  90.4217 269.7128 14.57105831718660
LANDSAT 9
1 49260U 21088A   26310.68632671  .00000272  00000+0  70394-4 0  9998
2 49260  98.2139  19.0211 0001153  85.8906 274.2424 14.57106504271755
ISS (ZARYA)
1 25544U 98067A   26310.49826972  .00011492  00000+0  21472-3 0  9994
2 25544  51.6322 315.8635 0007225 355.0594   5.0322 15.49214228593815
`;

export const MUSSOORIE = Object.freeze({ lat: 30.4598, lon: 78.0644 });

/** Earth Search record of the Phase 4 scene (see phase-4/SCIENCE-ADMISSION.md). */
export const S2B_SCENE = Object.freeze({
  id: 'S2B_43RGP_20261025_0_L2A',
  datetime: '2026-10-25T05:40:34.715Z',
});

function placemark({ id, mode = 'NOBS', start, end, ring }) {
  const coordinates = ring.map(([lon, lat]) => `${lon},${lat},0`).join(' ');
  return `<Placemark>
  <name>${id}</name>
  <TimeSpan><begin>${start}</begin><end>${end}</end></TimeSpan>
  <ExtendedData>
    <Data name="ID"><value>${id}</value></Data>
    <Data name="Mode"><value>${mode}</value></Data>
    <Data name="ObservationTimeStart"><value>${start}</value></Data>
    <Data name="ObservationTimeStop"><value>${end}</value></Data>
    <Data name="OrbitRelative"><value>105</value></Data>
  </ExtendedData>
  <Polygon><outerBoundaryIs><LinearRing><coordinates>${coordinates}</coordinates></LinearRing></outerBoundaryIs></Polygon>
</Placemark>`;
}

/** A box ring around a point, [lon, lat] pairs, closed. */
export const boxAround = ({ lat, lon }, half = 1) => [
  [lon - half, lat - half],
  [lon + half, lat - half],
  [lon + half, lat + half],
  [lon - half, lat + half],
  [lon - half, lat - half],
];

/** Synthetic plan text in ESA's schema. */
export function syntheticPlan(takes) {
  return `<?xml version="1.0" encoding="iso-8859-1"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
<name>S2 Planned Observations from synthetic test file</name>
${takes.map(placemark).join('\n')}
</Document></kml>`;
}

export const SYNTHETIC_PLAN_NAME =
  'S2B_MP_ACQ__KML_20261022T120000_20261109T150000.kml';
