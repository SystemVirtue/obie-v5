-- Enable RLS on tables
ALTER TABLE kiosk_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE queue ENABLE ROW LEVEL SECURITY;

-- Add missing policies
CREATE POLICY "Kiosk can read session" ON kiosk_sessions FOR SELECT USING (true);
CREATE POLICY "Kiosk can update session" ON kiosk_sessions FOR UPDATE USING (true);
