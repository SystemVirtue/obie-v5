-- Fix queue_next RLS issue
-- Problem: SECURITY DEFINER functions can't update player_status due to RLS
-- Solution: Add policy to allow postgres role to bypass RLS for system functions

-- Drop existing restrictive policy
DROP POLICY IF EXISTS "Admin full access to player_status" ON player_status;

-- Recreate with postgres role access
CREATE POLICY "Admin and system full access to player_status"
  ON player_status FOR ALL
  USING (
    auth.role() = 'authenticated' OR 
    current_user = 'postgres'
  );

-- Also update queue policy to allow postgres role
DROP POLICY IF EXISTS "Admin full access to queue" ON queue;

CREATE POLICY "Admin and system full access to queue"
  ON queue FOR ALL
  USING (
    auth.role() = 'authenticated' OR 
    current_user = 'postgres'
  );
