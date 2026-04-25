
CREATE INDEX IF NOT EXISTS idx_player_status_current_media_id
  ON public.player_status (current_media_id);

CREATE INDEX IF NOT EXISTS idx_queue_media_item_id
  ON public.queue (media_item_id);
;
