-- Fix: Add INSERT policy for kiosk_sessions
-- Allow anon users to create kiosk sessions

-- Enable RLS on kiosk_sessions
ALTER TABLE kiosk_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Kiosk can create session"
  ON kiosk_sessions FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Kiosk can read session"
  ON kiosk_sessions FOR SELECT
  USING (true);

CREATE POLICY "Kiosk can update session"
  ON kiosk_sessions FOR UPDATE
  USING (true);

-- Also need to allow queue inserts from kiosk (for requests)
ALTER TABLE queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Kiosk can add to queue"
  ON queue FOR INSERT
  WITH CHECK (requested_by = 'kiosk');

-- And allow reading queue for kiosk
CREATE POLICY "Kiosk can read queue"
  ON queue FOR SELECT
  USING (true);
