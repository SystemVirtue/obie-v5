-- Migration: Add priority_player_id to players table for priority player mechanism
-- This allows only the first connected player instance to control queue progression

ALTER TABLE players ADD COLUMN priority_player_id uuid REFERENCES players(id);

-- Add comment for documentation
COMMENT ON COLUMN players.priority_player_id IS 'ID of the player instance designated as priority (controls queue progression). Only one player can be priority at a time.';