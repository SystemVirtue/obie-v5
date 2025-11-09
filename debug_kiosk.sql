-- Check if default player exists
SELECT id, name FROM players WHERE id = '00000000-0000-0000-0000-000000000001';

-- Check RLS status
SELECT schemaname, tablename, rowsecurity FROM pg_tables WHERE tablename IN ('kiosk_sessions', 'queue');

-- Check existing policies
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check 
FROM pg_policies 
WHERE tablename IN ('kiosk_sessions', 'queue');
