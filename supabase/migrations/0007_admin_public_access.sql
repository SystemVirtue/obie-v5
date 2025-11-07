-- Allow public read access for admin console
-- The admin console uses anon key, not authentication
-- This is acceptable for a private jukebox system

-- Allow public read access to playlists
CREATE POLICY "Public can read playlists"
  ON playlists FOR SELECT
  USING (true);

-- Allow public read access to playlist_items
CREATE POLICY "Public can read playlist_items"
  ON playlist_items FOR SELECT
  USING (true);

-- Allow public read access to media_items
CREATE POLICY "Public can read media_items"
  ON media_items FOR SELECT
  USING (true);

-- Allow public read access to players
CREATE POLICY "Public can read players"
  ON players FOR SELECT
  USING (true);

-- Allow public read access to player_status
CREATE POLICY "Public can read player_status"
  ON player_status FOR SELECT
  USING (true);

-- Allow public read access to player_settings
CREATE POLICY "Public can read player_settings"
  ON player_settings FOR SELECT
  USING (true);

-- Allow public read access to queue
CREATE POLICY "Public can read queue"
  ON queue FOR SELECT
  USING (true);

-- Allow public read access to system_logs
CREATE POLICY "Public can read system_logs"
  ON system_logs FOR SELECT
  USING (true);

-- Note: Write access is still controlled by Edge Functions using service role
-- This just allows the admin UI to see the data
