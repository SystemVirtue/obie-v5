-- Ken Burns / vignette polish for the slideshow overlay.
-- `slideshow_kenburns_enabled` makes the still-image move run for the whole hold
-- time (continuous drift) instead of settling after a fixed 2s; when off the
-- player keeps the original behaviour. `slideshow_kenburns_style` picks which
-- moves are allowed. `slideshow_vignette_strength` feathers a still's edges into
-- the video behind it (0 disables). All strictly presentational — none of these
-- touch playback, queueing or audio.
ALTER TABLE public.player_settings
  ADD COLUMN IF NOT EXISTS slideshow_kenburns_enabled BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS slideshow_kenburns_style TEXT DEFAULT 'random',
  ADD COLUMN IF NOT EXISTS slideshow_vignette_strength INT DEFAULT 0;

COMMENT ON COLUMN public.player_settings.slideshow_kenburns_enabled IS
  'Run the still-image Ken Burns move for the whole hold time instead of a fixed 2s.';
COMMENT ON COLUMN public.player_settings.slideshow_kenburns_style IS
  'Which Ken Burns moves the player may pick: fade | zoom | pan | both | random.';
COMMENT ON COLUMN public.player_settings.slideshow_vignette_strength IS
  'Vignette strength 0-100 for still images: fades the slide edges to transparent. 0 disables.';