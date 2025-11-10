-- Add kiosk virtual insert coin button setting
ALTER TABLE player_settings
ADD COLUMN IF NOT EXISTS kiosk_show_virtual_coin_button BOOLEAN DEFAULT true;

-- Update existing records to show the button by default
UPDATE player_settings
SET kiosk_show_virtual_coin_button = true
WHERE kiosk_show_virtual_coin_button IS NULL;