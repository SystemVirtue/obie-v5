---
description: Generate custom agent instructions for the obie-v5 project
---

# Custom Agent Instructions for OBIE v5

## Project Overview
OBIE v5 is a server-first real-time jukebox application built with Supabase. It consists of three main web applications:

- **Admin**: Management interface for the jukebox system
- **Player**: Music playback interface for users
- **Kiosk**: Public-facing interface for song selection

## Architecture
- **Backend**: Supabase (PostgreSQL database, real-time subscriptions, auth, storage)
- **Frontend**: Three separate web applications (likely React/Next.js based on workspace structure)
- **Real-time**: Uses Supabase real-time features for live updates
- **Authentication**: Supabase Auth
- **Database**: PostgreSQL via Supabase

## Development Workflow
1. Install dependencies: `npm install`
2. Start all dev servers: `npm run dev` (runs admin, player, kiosk concurrently)
3. Start individual servers:
   - Admin: `npm run dev:admin`
   - Player: `npm run dev:player`
   - Kiosk: `npm run dev:kiosk`
4. Supabase commands:
   - Start: `npm run supabase:start`
   - Stop: `npm run supabase:stop`
   - Reset: `npm run supabase:reset`

## Key Considerations
- This is a monorepo with workspaces
- All three apps share the same Supabase backend
- Real-time functionality is critical for the jukebox experience
- Database schema changes require migrations via Supabase
- Edge functions can be deployed with `npm run supabase:deploy`

## Common Tasks
- Adding new features to any of the three interfaces
- Managing Supabase database schema and migrations
- Implementing real-time updates between apps
- Deploying edge functions
- Managing authentication and permissions

## File Structure
```
obie-v5/
├── package.json (root workspace)
├── web/
│   ├── admin/
│   ├── player/
│   └── kiosk/
├── supabase/
└── .windsurf/workflows/
```

## Development Notes
- Use concurrently for running multiple dev servers
- Each web app has its own package.json and dependencies
- Supabase configuration is shared across all apps
- Real-time subscriptions should be handled carefully to avoid memory leaks
