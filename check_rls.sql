-- Check current RLS status
SELECT schemaname, tablename, rowsecurity FROM pg_tables WHERE tablename IN ('kiosk_sessions', 'queue');

-- Check existing policies
SELECT tablename, policyname, cmd FROM pg_policies WHERE tablename IN ('kiosk_sessions', 'queue');

-- Check if default player exists
SELECT id, name FROM players WHERE id = '00000000-0000-0000-0000-000000000001';

-- Enable RLS (only if not already enabled)
-- ALTER TABLE kiosk_sessions ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE queue ENABLE ROW LEVEL SECURITY;
