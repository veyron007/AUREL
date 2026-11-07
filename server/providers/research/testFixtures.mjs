const id = 'S2B_43RGP_20261025_0_L2A';
export function itemFixture() {
  const base = `https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/43/R/GP/2026/10/${id}/`;
  const band = (name, res) => ({
    href: base + name + '.tif',
    type: 'image/tiff; application=geotiff; profile=cloud-optimized',
    'eo:bands': [{ name }],
    gsd: res,
    'proj:shape': [109800 / res, 109800 / res],
    'proj:transform': [res, 0, 699960, 0, -res, 3400020],
    'raster:bands': [
      {
        nodata: 0,
        data_type: res === 10 ? 'uint16' : 'uint8',
        spatial_resolution: res,
        ...(res === 10 ? { scale: 0.0001, offset: -0.1 } : {}),
      },
    ],
  });
  return {
    id,
    collection: 'sentinel-2-l2a',
    properties: {
      datetime: '2026-10-25T05:40:34.715000Z',
      'proj:epsg': 32643,
      's2:processing_baseline': '05.13',
      'eo:cloud_cover': 3,
    },
    assets: {
      red: band('B04', 10),
      nir: band('B08', 10),
      scl: band('SCL', 20),
    },
  };
}
