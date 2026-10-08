-- Normalize historical plural layer names to the canonical runtime names.
-- Safe to run repeatedly: rows already using singular names are unchanged.

update public.village_datasets as dataset
set layer_manifest = jsonb_set(
  dataset.layer_manifest,
  '{layers}',
  (
    select jsonb_agg(
      case layer ->> 'type'
        when 'buildings' then jsonb_set(layer, '{type}', '"building"'::jsonb)
        when 'roads' then jsonb_set(layer, '{type}', '"road"'::jsonb)
        else layer
      end
      order by ordinal
    )
    from jsonb_array_elements(dataset.layer_manifest -> 'layers') with ordinality as item(layer, ordinal)
  ),
  true
)
where jsonb_typeof(dataset.layer_manifest -> 'layers') = 'array'
  and exists (
    select 1
    from jsonb_array_elements(dataset.layer_manifest -> 'layers') as item(layer)
    where layer ->> 'type' in ('buildings', 'roads')
  )
returning dataset.id, dataset.village_id, dataset.status, dataset.layer_manifest;
