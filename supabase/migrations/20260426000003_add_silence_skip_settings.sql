ALTER TABLE public.player_settings
  ADD COLUMN IF NOT EXISTS silence_skip_enabled BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS silence_skip_tail_seconds INT DEFAULT 20,
  ADD COLUMN IF NOT EXISTS silence_skip_duration_ms INT DEFAULT 3000,
  ADD COLUMN IF NOT EXISTS silence_skip_threshold NUMERIC DEFAULT 0.01;
