-- Slideshow overlay settings.
-- Purely presentational: when enabled the player renders a shuffled, looping
-- slideshow of stills / short muted clips on top of the now-playing video.
-- `slideshow_folder` is the prefix inside the public Supabase Storage bucket
-- `Obie_Birthday_Media` that is the source of truth; `slideshow_media` is a cached
-- manifest of that folder so the player never has to list Storage itself.
ALTER TABLE public.player_settings
  ADD COLUMN IF NOT EXISTS slideshow_enabled BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS slideshow_folder TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS slideshow_media JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS slideshow_image_seconds INT DEFAULT 5,
  ADD COLUMN IF NOT EXISTS slideshow_fade_ms INT DEFAULT 600;

COMMENT ON COLUMN public.player_settings.slideshow_folder IS
  'Supabase Storage folder prefix to scan for slideshow media in the Obie_Birthday_Media bucket. Re-scan from the admin Playback settings.';
COMMENT ON COLUMN public.player_settings.slideshow_media IS
  'Cached manifest of the slideshow folder: JSON array of { url, type, title }.';
