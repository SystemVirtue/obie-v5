# Kiosk Background Assets

This directory contains background assets that loop continuously on the kiosk display.

## Current Playlist Order:
1. `Obie_NEON1.png` - 20 seconds (image)
2. `Obie_Shield_Crest_Animation.mp4` - plays once (video)
3. `Obie - Carla v1.mp4` - plays once (video)
4. `Obie_NEON2.png` - 20 seconds (image)
5. `Obie_Shield_Crest_Animation2.mp4` - plays once (video)

## How to Add New Assets:

1. **Add your asset files** to this directory
2. **Update the playlist** in `/src/components/BackgroundPlaylist.tsx`:
   - Add a new entry to the `DEFAULT_BACKGROUND_ASSETS` array
   - Specify:
     - `id`: unique identifier
     - `type`: 'image' or 'video'
     - `src`: path to the asset (relative to `/public`)
     - `duration`: display time in seconds (only for images, videos play once)

## Asset Requirements:
- **Images**: PNG, JPG, or other web-compatible formats
- **Videos**: MP4 format recommended for best compatibility
- **Sizing**: Assets will be scaled to fill the screen (`object-cover`)
- **Performance**: Keep file sizes reasonable for web playback

## Example Addition:
```typescript
{
  id: 'my-new-asset',
  type: 'image',
  src: '/assets/background/my-new-asset.png',
  duration: 15  // 15 seconds for images
}
```