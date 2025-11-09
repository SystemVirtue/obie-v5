-- Add karaoke_mode to player_settings so admin can toggle lyrics overlay
-- Migration: add boolean column karaoke_mode with default false
ALTER TABLE IF EXISTS public.player_settings
ADD COLUMN IF NOT EXISTS karaoke_mode boolean DEFAULT false;

-- Ensure existing rows get an explicit value (in case of older rows)
UPDATE public.player_settings SET karaoke_mode = false WHERE karaoke_mode IS NULL;
