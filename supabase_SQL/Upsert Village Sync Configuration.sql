insert into public.mc_sync_config (
  village_id,
  crs,
  min_lon,
  min_lat,
  max_lon,
  max_lat,
  mc_origin_x,
  mc_origin_y,
  mc_origin_z,
  mc_width,
  mc_depth,
  rotation_deg
)
values (
  'village_demo_01',
  'EPSG:4326',
  113.65670800209045,
  23.67331624031067,
  113.66360664367676,
  23.67930293083191,
  1000,
  64,
  1000,
  256,
  256,
  0
)
on conflict (village_id) do update set
  crs = excluded.crs,
  min_lon = excluded.min_lon,
  min_lat = excluded.min_lat,
  max_lon = excluded.max_lon,
  max_lat = excluded.max_lat,
  mc_origin_x = excluded.mc_origin_x,
  mc_origin_y = excluded.mc_origin_y,
  mc_origin_z = excluded.mc_origin_z,
  mc_width = excluded.mc_width,
  mc_depth = excluded.mc_depth,
  rotation_deg = excluded.rotation_deg;