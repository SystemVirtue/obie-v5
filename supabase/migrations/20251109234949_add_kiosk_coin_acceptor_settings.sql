-- Add kiosk coin acceptor settings to player_settings table
ALTER TABLE player_settings
ADD COLUMN IF NOT EXISTS kiosk_coin_acceptor_enabled BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS kiosk_coin_acceptor_connected BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS kiosk_coin_acceptor_device_id TEXT;

-- Add comment for documentation
COMMENT ON COLUMN player_settings.kiosk_coin_acceptor_enabled IS 'Whether kiosk should attempt to connect to coin acceptor device';
COMMENT ON COLUMN player_settings.kiosk_coin_acceptor_connected IS 'Current connection status of kiosk coin acceptor';
COMMENT ON COLUMN player_settings.kiosk_coin_acceptor_device_id IS 'Device ID of connected coin acceptor';