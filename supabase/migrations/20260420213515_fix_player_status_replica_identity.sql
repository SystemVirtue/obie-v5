-- Fix player_status REPLICA IDENTITY to FULL for Realtime
-- The admin console subscribes to player_status UPDATE events, but with
-- REPLICA IDENTITY DEFAULT (only primary key), the state field is not sent
-- in the Realtime payload, so the admin console can't detect state changes.

ALTER TABLE public.player_status REPLICA IDENTITY FULL;;
