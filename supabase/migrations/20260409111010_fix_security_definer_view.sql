
DROP VIEW IF EXISTS public.playlists_with_counts;

CREATE VIEW public.playlists_with_counts
WITH (security_invoker = true)
AS
SELECT
  p.*,
  COALESCE(count(pi.id), 0) AS item_count
FROM public.playlists p
LEFT JOIN public.playlist_items pi ON pi.playlist_id = p.id
GROUP BY p.id;
;
