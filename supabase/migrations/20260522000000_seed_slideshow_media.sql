-- Seed the slideshow manifest with the known contents of the public
-- `Obie_Birthday_Media` bucket (89 files: 68 images, 21 video clips).
--
-- Why seed at all: the admin "Scan Folder" action already produces exactly this
-- list from the bucket at runtime. Seeding just means the overlay has content on
-- first load without anyone having to visit the admin and press Scan. A later
-- scan overwrites this wholesale, so it is a starting point, not a lock-in.
--
-- The URLs below are the same shape `getPublicUrl()` returns for the production
-- project (https://<ref>.supabase.co/storage/v1/object/public/<bucket>/<file>),
-- percent-encoded. If the project ref ever changes, re-run "Scan Folder" to
-- regenerate them against the live bucket.
--
-- Guarded on an empty manifest so re-running this never clobbers a real scan or
-- an admin's hand-curated list. Deliberately leaves `slideshow_enabled` alone:
-- seeding files should not switch the overlay on by itself.

UPDATE public.player_settings
SET slideshow_media = $manifest$[
  {
    "url": "https://syccqoextpxifmumvxqw.supabase.co/storage/v1/object/public/Obie_Birthday_Media/8BE06CD8-55A4-43F4-80E7-693500F55EA6%201.mov",
    "type": "video",
    "title": "8BE06CD8-55A4-43F4-80E7-693500F55EA6 1.mov"
  },
  {
    "url": "https://syccqoextpxifmumvxqw.supabase.co/storage/v1/object/public/Obie_Birthday_Media/att.NJxTB-kqeLvhvHb9BT8pJlzYvkPtlpcHueEEeWOe9sA.mp4",
    "type": "video",
    "title": "att.NJxTB-kqeLvhvHb9BT8pJlzYvkPtlpcHueEEeWOe9sA.mp4"
  },
  {
    "url": "https://syccqoextpxifmumvxqw.supabase.co/storage/v1/object/public/Obie_Birthday_Media/BEA04512-6CFF-4B29-892D-0CE8B0D3E612%201.mov",
    "type": "video",
    "title": "BEA04512-6CFF-4B29-892D-0CE8B0D3E612 1.mov"
  },
  {
    "url": "https://syccqoextpxifmumvxqw.supabase.co/storage/v1/object/public/Obie_Birthday_Media/CAA7080C-BA64-4836-A75A-943077BDEC69.mov",
    "type": "video",
    "title": "CAA7080C-BA64-4836-A75A-943077BDEC69.mov"
  },
  {
    "url": "https://syccqoextpxifmumvxqw.supabase.co/storage/v1/object/public/Obie_Birthday_Media/dd7536bc-87f3-43d5-b5d0-6193d1c2ce4c.jpeg",
    "type": "image",
    "title": "dd7536bc-87f3-43d5-b5d0-6193d1c2ce4c.jpeg"
  },
  {
    "url": "https://syccqoextpxifmumvxqw.supabase.co/storage/v1/object/public/Obie_Birthday_Media/DF7A8A2D-C684-4D5A-9944-F589DAD810FC.mov",
    "type": "video",
    "title": "DF7A8A2D-C684-4D5A-9944-F589DAD810FC.mov"
  },
  {
    "url": "https://syccqoextpxifmumvxqw.supabase.co/storage/v1/object/public/Obie_Birthday_Media/IMG_0400.jpeg",
    "type": "image",
    "title": "IMG_0400.jpeg"
  },
  {
    "url": "https://syccqoextpxifmumvxqw.supabase.co/storage/v1/object/public/Obie_Birthday_Media/IMG_1080.jpeg",
    "type": "image",
    "title": "IMG_1080.jpeg"
  },
  {
    "url": "https://syccqoextpxifmumvxqw.supabase.co/storage/v1/object/public/Obie_Birthday_Media/IMG_1081.jpeg",
    "type": "image",
    "title": "IMG_1081.jpeg"
  },
  {
    "url": "https://syccqoextpxifmumvxqw.supabase.co/storage/v1/object/public/Obie_Birthday_Media/IMG_1261.jpeg",
    "type": "image",
    "title": "IMG_1261.jpeg"
  },
  {
    "url": "https://syccqoextpxifmumvxqw.supabase.co/storage/v1/object/public/Obie_Birthday_Media/IMG_1318%202.mov",
    "type": "video",
    "title": "IMG_1318 2.mov"
  },
  {
    "url": "https://syccqoextpxifmumvxqw.supabase.co/storage/v1/object/public/Obie_Birthday_Media/IMG_1584.jpeg",
    "type": "image",
    "title": "IMG_1584.jpeg"
  },
  {
    "url": "https://syccqoextpxifmumvxqw.supabase.co/storage/v1/object/public/Obie_Birthday_Media/IMG_1585.jpeg",
    "type": "image",
    "title": "IMG_1585.jpeg"
  },
  {
    "url": "https://syccqoextpxifmumvxqw.supabase.co/storage/v1/object/public/Obie_Birthday_Media/IMG_1586.jpeg",
    "type": "image",
    "title": "IMG_1586.jpeg"
  },
  {
    "url": "https://syccqoextpxifmumvxqw.supabase.co/storage/v1/object/public/Obie_Birthday_Media/IMG_1684%202.mov",
    "type": "video",
    "title": "IMG_1684 2.mov"
  },
  {
    "url": "https://syccqoextpxifmumvxqw.supabase.co/storage/v1/object/public/Obie_Birthday_Media/IMG_1687.jpeg",
    "type": "image",
    "title": "IMG_1687.jpeg"
  },
  {
    "url": "https://syccqoextpxifmumvxqw.supabase.co/storage/v1/object/public/Obie_Birthday_Media/IMG_1689.jpeg",
    "type": "image",
    "title": "IMG_1689.jpeg"
  },
  {
    "url": "https://syccqoextpxifmumvxqw.supabase.co/storage/v1/object/public/Obie_Birthday_Media/IMG_1775.jpeg",
    "type": "image",
    "title": "IMG_1775.jpeg"
  },
  {
    "url": "https://syccqoextpxifmumvxqw.supabase.co/storage/v1/object/public/Obie_Birthday_Media/IMG_1776.jpeg",
    "type": "image",
    "title": "IMG_1776.jpeg"
  },
  {
    "url": "https://syccqoextpxifmumvxqw.supabase.co/storage/v1/object/public/Obie_Birthday_Media/IMG_1808.jpeg",
    "type": "image",
    "title": "IMG_1808.jpeg"
  },
  {
    "url": "https://syccqoextpxifmumvxqw.supabase.co/storage/v1/object/public/Obie_Birthday_Media/IMG_1809.jpeg",
    "type": "image",
    "title": "IMG_1809.jpeg"
  },
  {
    "url": "https://syccqoextpxifmumvxqw.supabase.co/storage/v1/object/public/Obie_Birthday_Media/IMG_1811%202.mov",
    "type": "video",
    "title": "IMG_1811 2.mov"
  },
  {
    "url": "https://syccqoextpxifmumvxqw.supabase.co/storage/v1/object/public/Obie_Birthday_Media/IMG_1830.mov",
    "type": "video",
    "title": "IMG_1830.mov"
  },
  {
    "url": "https://syccqoextpxifmumvxqw.supabase.co/storage/v1/object/public/Obie_Birthday_Media/IMG_1843.jpeg",
    "type": "image",
    "title": "IMG_1843.jpeg"
  },
  {
    "url": "https://syccqoextpxifmumvxqw.supabase.co/storage/v1/object/public/Obie_Birthday_Media/IMG_1845.jpeg",
    "type": "image",
    "title": "IMG_1845.jpeg"
  },
  {
    "url": "https://syccqoextpxifmumvxqw.supabase.co/storage/v1/object/public/Obie_Birthday_Media/IMG_2132.jpeg",
    "type": "image",
    "title": "IMG_2132.jpeg"
  },
  {
    "url": "https://syccqoextpxifmumvxqw.supabase.co/storage/v1/object/public/Obie_Birthday_Media/IMG_2657.jpeg",
    "type": "image",
    "title": "IMG_2657.jpeg"
  },
  {
    "url": "https://syccqoextpxifmumvxqw.supabase.co/storage/v1/object/public/Obie_Birthday_Media/IMG_2669.jpeg",
    "type": "image",
    "title": "IMG_2669.jpeg"
  },
  {
    "url": "https://syccqoextpxifmumvxqw.supabase.co/storage/v1/object/public/Obie_Birthday_Media/IMG_2835.jpeg",
    "type": "image",
    "title": "IMG_2835.jpeg"
  },
  {
    "url": "https://syccqoextpxifmumvxqw.supabase.co/storage/v1/object/public/Obie_Birthday_Media/IMG_2836.jpeg",
    "type": "image",
    "title": "IMG_2836.jpeg"
  },
  {
    "url": "https://syccqoextpxifmumvxqw.supabase.co/storage/v1/object/public/Obie_Birthday_Media/IMG_3070.jpeg",
    "type": "image",
    "title": "IMG_3070.jpeg"
  },
  {
    "url": "https://syccqoextpxifmumvxqw.supabase.co/storage/v1/object/public/Obie_Birthday_Media/IMG_3094.jpeg",
    "type": "image",
    "title": "IMG_3094.jpeg"
  },
  {
    "url": "https://syccqoextpxifmumvxqw.supabase.co/storage/v1/object/public/Obie_Birthday_Media/IMG_3168.jpeg",
    "type": "image",
    "title": "IMG_3168.jpeg"
  },
  {
    "url": "https://syccqoextpxifmumvxqw.supabase.co/storage/v1/object/public/Obie_Birthday_Media/IMG_3313.jpeg",
    "type": "image",
    "title": "IMG_3313.jpeg"
  },
  {
    "url": "https://syccqoextpxifmumvxqw.supabase.co/storage/v1/object/public/Obie_Birthday_Media/IMG_3315.mov",
    "type": "video",
    "title": "IMG_3315.mov"
  },
  {
    "url": "https://syccqoextpxifmumvxqw.supabase.co/storage/v1/object/public/Obie_Birthday_Media/IMG_3323.jpeg",
    "type": "image",
    "title": "IMG_3323.jpeg"
  },
  {
    "url": "https://syccqoextpxifmumvxqw.supabase.co/storage/v1/object/public/Obie_Birthday_Media/IMG_3395%201.mov",
    "type": "video",
    "title": "IMG_3395 1.mov"
  },
  {
    "url": "https://syccqoextpxifmumvxqw.supabase.co/storage/v1/object/public/Obie_Birthday_Media/IMG_3412%204.jpeg",
    "type": "image",
    "title": "IMG_3412 4.jpeg"
  },
  {
    "url": "https://syccqoextpxifmumvxqw.supabase.co/storage/v1/object/public/Obie_Birthday_Media/IMG_3417.jpeg",
    "type": "image",
    "title": "IMG_3417.jpeg"
  },
  {
    "url": "https://syccqoextpxifmumvxqw.supabase.co/storage/v1/object/public/Obie_Birthday_Media/IMG_3418%202.jpeg",
    "type": "image",
    "title": "IMG_3418 2.jpeg"
  },
  {
    "url": "https://syccqoextpxifmumvxqw.supabase.co/storage/v1/object/public/Obie_Birthday_Media/IMG_3421.jpeg",
    "type": "image",
    "title": "IMG_3421.jpeg"
  },
  {
    "url": "https://syccqoextpxifmumvxqw.supabase.co/storage/v1/object/public/Obie_Birthday_Media/IMG_3423%201.jpeg",
    "type": "image",
    "title": "IMG_3423 1.jpeg"
  },
  {
    "url": "https://syccqoextpxifmumvxqw.supabase.co/storage/v1/object/public/Obie_Birthday_Media/IMG_3425.jpeg",
    "type": "image",
    "title": "IMG_3425.jpeg"
  },
  {
    "url": "https://syccqoextpxifmumvxqw.supabase.co/storage/v1/object/public/Obie_Birthday_Media/IMG_3426.jpeg",
    "type": "image",
    "title": "IMG_3426.jpeg"
  },
  {
    "url": "https://syccqoextpxifmumvxqw.supabase.co/storage/v1/object/public/Obie_Birthday_Media/IMG_3427%201.jpeg",
    "type": "image",
    "title": "IMG_3427 1.jpeg"
  },
  {
    "url": "https://syccqoextpxifmumvxqw.supabase.co/storage/v1/object/public/Obie_Birthday_Media/IMG_3494.mov",
    "type": "video",
    "title": "IMG_3494.mov"
  },
  {
    "url": "https://syccqoextpxifmumvxqw.supabase.co/storage/v1/object/public/Obie_Birthday_Media/IMG_3527.mov",
    "type": "video",
    "title": "IMG_3527.mov"
  },
  {
    "url": "https://syccqoextpxifmumvxqw.supabase.co/storage/v1/object/public/Obie_Birthday_Media/IMG_3533%201.mov",
    "type": "video",
    "title": "IMG_3533 1.mov"
  },
  {
    "url": "https://syccqoextpxifmumvxqw.supabase.co/storage/v1/object/public/Obie_Birthday_Media/IMG_3545.mov",
    "type": "video",
    "title": "IMG_3545.mov"
  },
  {
    "url": "https://syccqoextpxifmumvxqw.supabase.co/storage/v1/object/public/Obie_Birthday_Media/IMG_3546%201.jpeg",
    "type": "image",
    "title": "IMG_3546 1.jpeg"
  },
  {
    "url": "https://syccqoextpxifmumvxqw.supabase.co/storage/v1/object/public/Obie_Birthday_Media/IMG_3568.jpeg",
    "type": "image",
    "title": "IMG_3568.jpeg"
  },
  {
    "url": "https://syccqoextpxifmumvxqw.supabase.co/storage/v1/object/public/Obie_Birthday_Media/IMG_3599.mov",
    "type": "video",
    "title": "IMG_3599.mov"
  },
  {
    "url": "https://syccqoextpxifmumvxqw.supabase.co/storage/v1/object/public/Obie_Birthday_Media/IMG_3639.jpeg",
    "type": "image",
    "title": "IMG_3639.jpeg"
  },
  {
    "url": "https://syccqoextpxifmumvxqw.supabase.co/storage/v1/object/public/Obie_Birthday_Media/IMG_3669.mov",
    "type": "video",
    "title": "IMG_3669.mov"
  },
  {
    "url": "https://syccqoextpxifmumvxqw.supabase.co/storage/v1/object/public/Obie_Birthday_Media/IMG_3670.mov",
    "type": "video",
    "title": "IMG_3670.mov"
  },
  {
    "url": "https://syccqoextpxifmumvxqw.supabase.co/storage/v1/object/public/Obie_Birthday_Media/IMG_3673.mov",
    "type": "video",
    "title": "IMG_3673.mov"
  },
  {
    "url": "https://syccqoextpxifmumvxqw.supabase.co/storage/v1/object/public/Obie_Birthday_Media/IMG_3714.jpeg",
    "type": "image",
    "title": "IMG_3714.jpeg"
  },
  {
    "url": "https://syccqoextpxifmumvxqw.supabase.co/storage/v1/object/public/Obie_Birthday_Media/IMG_3790.jpeg",
    "type": "image",
    "title": "IMG_3790.jpeg"
  },
  {
    "url": "https://syccqoextpxifmumvxqw.supabase.co/storage/v1/object/public/Obie_Birthday_Media/IMG_4209%201.jpeg",
    "type": "image",
    "title": "IMG_4209 1.jpeg"
  },
  {
    "url": "https://syccqoextpxifmumvxqw.supabase.co/storage/v1/object/public/Obie_Birthday_Media/IMG_4303.jpeg",
    "type": "image",
    "title": "IMG_4303.jpeg"
  },
  {
    "url": "https://syccqoextpxifmumvxqw.supabase.co/storage/v1/object/public/Obie_Birthday_Media/IMG_4423%201.jpeg",
    "type": "image",
    "title": "IMG_4423 1.jpeg"
  },
  {
    "url": "https://syccqoextpxifmumvxqw.supabase.co/storage/v1/object/public/Obie_Birthday_Media/IMG_4518%201.jpeg",
    "type": "image",
    "title": "IMG_4518 1.jpeg"
  },
  {
    "url": "https://syccqoextpxifmumvxqw.supabase.co/storage/v1/object/public/Obie_Birthday_Media/IMG_4842.mov",
    "type": "video",
    "title": "IMG_4842.mov"
  },
  {
    "url": "https://syccqoextpxifmumvxqw.supabase.co/storage/v1/object/public/Obie_Birthday_Media/IMG_4880.jpeg",
    "type": "image",
    "title": "IMG_4880.jpeg"
  },
  {
    "url": "https://syccqoextpxifmumvxqw.supabase.co/storage/v1/object/public/Obie_Birthday_Media/IMG_4956.jpeg",
    "type": "image",
    "title": "IMG_4956.jpeg"
  },
  {
    "url": "https://syccqoextpxifmumvxqw.supabase.co/storage/v1/object/public/Obie_Birthday_Media/IMG_5023.jpeg",
    "type": "image",
    "title": "IMG_5023.jpeg"
  },
  {
    "url": "https://syccqoextpxifmumvxqw.supabase.co/storage/v1/object/public/Obie_Birthday_Media/IMG_5049.jpeg",
    "type": "image",
    "title": "IMG_5049.jpeg"
  },
  {
    "url": "https://syccqoextpxifmumvxqw.supabase.co/storage/v1/object/public/Obie_Birthday_Media/IMG_5084.jpeg",
    "type": "image",
    "title": "IMG_5084.jpeg"
  },
  {
    "url": "https://syccqoextpxifmumvxqw.supabase.co/storage/v1/object/public/Obie_Birthday_Media/IMG_5085.jpeg",
    "type": "image",
    "title": "IMG_5085.jpeg"
  },
  {
    "url": "https://syccqoextpxifmumvxqw.supabase.co/storage/v1/object/public/Obie_Birthday_Media/IMG_5124.jpeg",
    "type": "image",
    "title": "IMG_5124.jpeg"
  },
  {
    "url": "https://syccqoextpxifmumvxqw.supabase.co/storage/v1/object/public/Obie_Birthday_Media/IMG_5134.jpeg",
    "type": "image",
    "title": "IMG_5134.jpeg"
  },
  {
    "url": "https://syccqoextpxifmumvxqw.supabase.co/storage/v1/object/public/Obie_Birthday_Media/IMG_5135.jpeg",
    "type": "image",
    "title": "IMG_5135.jpeg"
  },
  {
    "url": "https://syccqoextpxifmumvxqw.supabase.co/storage/v1/object/public/Obie_Birthday_Media/IMG_5136.jpeg",
    "type": "image",
    "title": "IMG_5136.jpeg"
  },
  {
    "url": "https://syccqoextpxifmumvxqw.supabase.co/storage/v1/object/public/Obie_Birthday_Media/IMG_5137.jpeg",
    "type": "image",
    "title": "IMG_5137.jpeg"
  },
  {
    "url": "https://syccqoextpxifmumvxqw.supabase.co/storage/v1/object/public/Obie_Birthday_Media/IMG_5138.jpeg",
    "type": "image",
    "title": "IMG_5138.jpeg"
  },
  {
    "url": "https://syccqoextpxifmumvxqw.supabase.co/storage/v1/object/public/Obie_Birthday_Media/IMG_5146.jpeg",
    "type": "image",
    "title": "IMG_5146.jpeg"
  },
  {
    "url": "https://syccqoextpxifmumvxqw.supabase.co/storage/v1/object/public/Obie_Birthday_Media/IMG_5147.jpeg",
    "type": "image",
    "title": "IMG_5147.jpeg"
  },
  {
    "url": "https://syccqoextpxifmumvxqw.supabase.co/storage/v1/object/public/Obie_Birthday_Media/IMG_5151.jpeg",
    "type": "image",
    "title": "IMG_5151.jpeg"
  },
  {
    "url": "https://syccqoextpxifmumvxqw.supabase.co/storage/v1/object/public/Obie_Birthday_Media/IMG_5152.jpeg",
    "type": "image",
    "title": "IMG_5152.jpeg"
  },
  {
    "url": "https://syccqoextpxifmumvxqw.supabase.co/storage/v1/object/public/Obie_Birthday_Media/IMG_5153.jpeg",
    "type": "image",
    "title": "IMG_5153.jpeg"
  },
  {
    "url": "https://syccqoextpxifmumvxqw.supabase.co/storage/v1/object/public/Obie_Birthday_Media/IMG_5154-1.jpeg",
    "type": "image",
    "title": "IMG_5154-1.jpeg"
  },
  {
    "url": "https://syccqoextpxifmumvxqw.supabase.co/storage/v1/object/public/Obie_Birthday_Media/IMG_5154.jpeg",
    "type": "image",
    "title": "IMG_5154.jpeg"
  },
  {
    "url": "https://syccqoextpxifmumvxqw.supabase.co/storage/v1/object/public/Obie_Birthday_Media/IMG_5155-1.jpeg",
    "type": "image",
    "title": "IMG_5155-1.jpeg"
  },
  {
    "url": "https://syccqoextpxifmumvxqw.supabase.co/storage/v1/object/public/Obie_Birthday_Media/IMG_5155.jpeg",
    "type": "image",
    "title": "IMG_5155.jpeg"
  },
  {
    "url": "https://syccqoextpxifmumvxqw.supabase.co/storage/v1/object/public/Obie_Birthday_Media/IMG_5255.jpeg",
    "type": "image",
    "title": "IMG_5255.jpeg"
  },
  {
    "url": "https://syccqoextpxifmumvxqw.supabase.co/storage/v1/object/public/Obie_Birthday_Media/IMG_5275.jpeg",
    "type": "image",
    "title": "IMG_5275.jpeg"
  },
  {
    "url": "https://syccqoextpxifmumvxqw.supabase.co/storage/v1/object/public/Obie_Birthday_Media/IMG_5290.jpeg",
    "type": "image",
    "title": "IMG_5290.jpeg"
  },
  {
    "url": "https://syccqoextpxifmumvxqw.supabase.co/storage/v1/object/public/Obie_Birthday_Media/IMG_9886.jpeg",
    "type": "image",
    "title": "IMG_9886.jpeg"
  },
  {
    "url": "https://syccqoextpxifmumvxqw.supabase.co/storage/v1/object/public/Obie_Birthday_Media/InstaToon_2_4154970858.mov",
    "type": "video",
    "title": "InstaToon_2_4154970858.mov"
  }
]$manifest$::jsonb
WHERE slideshow_media IS NULL
   OR slideshow_media = '[]'::jsonb;
