UPDATE public.model_price_catalog
SET
  roles = array_remove(roles, 'page image review'),
  updated_at = NOW()
WHERE 'page image review' = ANY(roles);
