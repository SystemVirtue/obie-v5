-- Fix: Add INSERT policy for kiosk_sessions
-- Allow anon users to create kiosk sessions

CREATE POLICY "Kiosk can create session"
  ON kiosk_sessions FOR INSERT
  WITH CHECK (true);

-- Also need to allow queue inserts from kiosk (for requests)
CREATE POLICY "Kiosk can add to queue"
  ON queue FOR INSERT
  WITH CHECK (requested_by = 'kiosk');

-- And allow reading queue for kiosk
CREATE POLICY "Kiosk can read queue"
  ON queue FOR SELECT
  USING (true);
