# Development Guide - Obie Jukebox v2

Guide for developers working on the jukebox codebase.

---

## Development Setup

### First-Time Setup

```bash
# Clone repository
git clone <repo-url>
cd obie-v5

# Install dependencies
npm install

# Start Supabase (requires Docker)
npm run supabase:start

# Create .env files for each frontend
cp .env.example web/admin/.env
cp .env.example web/player/.env
cp .env.example web/kiosk/.env

# Update .env files with your Supabase credentials
```

### Daily Workflow

```bash
# Terminal 1: Supabase
npm run supabase:start

# Terminal 2: Frontend apps
npm run dev

# Terminal 3: Logs
supabase functions logs --local
```

---

## Project Architecture

### Data Flow

```
User Action → Frontend → Edge Function → RPC → Database → Realtime → All Clients
```

**Example**: Adding a song to queue

1. Admin clicks "Add to Queue"
2. Calls `callQueueManager({ action: 'add', ... })`
3. Edge Function authenticates request
4. Calls SQL RPC `queue_add(...)`
5. RPC inserts row with advisory lock
6. Realtime broadcasts INSERT event
7. All subscribed clients receive update
8. UIs re-render with new queue state

### State Management

**Rule**: All state lives in Supabase. Clients are views.

❌ **Don't**:
```typescript
const [queue, setQueue] = useState([]);
const addToQueue = (item) => {
  setQueue([...queue, item]); // Local state mutation
};
```

✅ **Do**:
```typescript
const [queue, setQueue] = useState([]);
useEffect(() => {
  const sub = subscribeToQueue(playerId, setQueue);
  return () => sub.unsubscribe();
}, []);

const addToQueue = async (item) => {
  await callQueueManager({ action: 'add', ... }); // Server handles it
  // Realtime subscription automatically updates UI
};
```

---

## Code Style

### TypeScript

- Use strict mode (enabled in tsconfig.json)
- Define interfaces for all data types
- Use `async/await` over promises
- Handle errors explicitly

### React

- Functional components only
- Use hooks for state and effects
- Extract reusable components
- Keep components < 200 lines

### Edge Functions (Deno)

- Use ES modules
- Handle CORS in all endpoints
- Validate inputs before RPC calls
- Return JSON with proper status codes

---

## Adding a New Feature

### Example: Add "Favorite Songs" Feature

#### 1. Update Database Schema

Create new migration:

```sql
-- supabase/migrations/0002_add_favorites.sql

CREATE TABLE favorites (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users ON DELETE CASCADE,
  media_item_id UUID REFERENCES media_items ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, media_item_id)
);

CREATE INDEX idx_favorites_user ON favorites(user_id);

-- RLS Policy
ALTER TABLE favorites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own favorites"
  ON favorites FOR ALL
  USING (auth.uid() = user_id);

-- Enable Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE favorites;
```

Apply migration:
```bash
supabase db reset
```

#### 2. Add Types to Shared Client

```typescript
// web/shared/supabase-client.ts

export interface Favorite {
  id: string;
  user_id: string;
  media_item_id: string;
  created_at: string;
}

// Add to Database interface
export interface Database {
  public: {
    Tables: {
      // ... existing tables
      favorites: { Row: Favorite };
    };
  };
}

// Add API helper
export async function addFavorite(mediaItemId: string) {
  const { data, error } = await supabase
    .from('favorites')
    .insert({ media_item_id: mediaItemId })
    .select()
    .single();
  
  if (error) throw error;
  return data;
}
```

#### 3. Add UI Component

```typescript
// web/admin/src/components/FavoritesView.tsx

import { useEffect, useState } from 'react';
import { supabase, addFavorite, type Favorite } from '@shared/supabase-client';

export function FavoritesView() {
  const [favorites, setFavorites] = useState<Favorite[]>([]);

  useEffect(() => {
    // Fetch initial favorites
    supabase
      .from('favorites')
      .select('*, media_item:media_items(*)')
      .then(({ data }) => setFavorites(data || []));

    // Subscribe to changes
    const channel = supabase
      .channel('favorites')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'favorites'
      }, () => {
        // Refetch on change
        supabase
          .from('favorites')
          .select('*, media_item:media_items(*)')
          .then(({ data }) => setFavorites(data || []));
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return (
    <div>
      <h2>My Favorites</h2>
      {favorites.map(fav => (
        <div key={fav.id}>
          {/* Render favorite */}
        </div>
      ))}
    </div>
  );
}
```

---

## Testing

### Manual Testing

1. **Player must be running** for any queue operations
2. Test all three apps in parallel
3. Verify Realtime updates across clients
4. Check Edge Function logs for errors

### Test Player Status

```bash
# Check if player is online
curl http://localhost:54321/rest/v1/players \
  -H "apikey: YOUR_ANON_KEY" \
  -H "Authorization: Bearer YOUR_ANON_KEY"
```

### Test Edge Functions

```bash
# Test queue-manager
curl -X POST http://localhost:54321/functions/v1/queue-manager \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "player_id": "00000000-0000-0000-0000-000000000001",
    "action": "clear"
  }'
```

---

## Database Management

### Reset Database

```bash
npm run supabase:reset
```

This:
1. Drops all tables
2. Runs all migrations
3. Seeds default data

### Create Migration

```bash
supabase migration new <name>
```

Edit the generated file in `supabase/migrations/`.

### Seed Data

Add seed data to migration:

```sql
-- At end of 0001_initial_schema.sql

INSERT INTO media_items (source_id, title, artist, url, duration)
VALUES 
  ('youtube:test1', 'Test Song 1', 'Test Artist', 'https://youtube.com/watch?v=test1', 180),
  ('youtube:test2', 'Test Song 2', 'Test Artist', 'https://youtube.com/watch?v=test2', 200);
```

---

## Debugging

### Enable Verbose Logs

```typescript
// In Edge Function
console.log('Debug:', JSON.stringify(data, null, 2));
```

View logs:
```bash
supabase functions logs --local
```

### Realtime Connection Issues

Check connection status:

```typescript
const channel = supabase.channel('test');
channel.subscribe((status) => {
  console.log('Realtime status:', status); // Should be 'SUBSCRIBED'
});
```

### Database Query Debugging

```typescript
const { data, error } = await supabase
  .from('queue')
  .select('*')
  .eq('player_id', playerId);

console.log('Query result:', { data, error });
```

---

## Performance Tips

### Minimize Edge Function Calls

❌ **Don't**:
```typescript
// Calling function for each item
for (const item of items) {
  await callQueueManager({ action: 'add', media_item_id: item.id });
}
```

✅ **Do**:
```typescript
// Batch operation (add to Edge Function)
await callQueueManager({ action: 'add_batch', items: items.map(i => i.id) });
```

### Use Realtime Efficiently

❌ **Don't**:
```typescript
// Separate subscriptions for each table
useEffect(() => {
  subscribeToTable('queue', ...);
  subscribeToTable('player_status', ...);
  subscribeToTable('settings', ...);
}, []);
```

✅ **Do**:
```typescript
// One channel with multiple listeners
useEffect(() => {
  const channel = supabase.channel('player_all')
    .on('postgres_changes', { table: 'queue' }, handleQueue)
    .on('postgres_changes', { table: 'player_status' }, handleStatus)
    .on('postgres_changes', { table: 'settings' }, handleSettings)
    .subscribe();
  
  return () => supabase.removeChannel(channel);
}, []);
```

---

## Common Patterns

### Error Handling

```typescript
async function handleAction() {
  try {
    const result = await callEdgeFunction(...);
    // Success
  } catch (error) {
    console.error('Action failed:', error);
    // Show user-friendly message
    setError(error.message || 'Something went wrong');
  }
}
```

### Loading States

```typescript
const [isLoading, setIsLoading] = useState(false);

async function handleAction() {
  setIsLoading(true);
  try {
    await callEdgeFunction(...);
  } finally {
    setIsLoading(false); // Always reset
  }
}
```

### Optimistic Updates

```typescript
const [queue, setQueue] = useState([]);

async function removeItem(id) {
  // Optimistic update
  setQueue(queue.filter(item => item.id !== id));
  
  try {
    await callQueueManager({ action: 'remove', queue_id: id });
  } catch (error) {
    // Revert on error
    setQueue(originalQueue);
    console.error('Failed to remove:', error);
  }
}
```

---

## Git Workflow

### Branch Naming

- `feature/add-favorites` - New features
- `fix/queue-bug` - Bug fixes
- `refactor/simplify-player` - Code improvements
- `docs/update-readme` - Documentation

### Commit Messages

```
feat: add favorites feature
fix: resolve queue race condition
refactor: simplify player status logic
docs: update deployment guide
chore: update dependencies
```

### Pull Request

1. Create feature branch
2. Make changes
3. Test locally
4. Push and create PR
5. Request review

---

## Resources

- [Supabase Docs](https://supabase.com/docs)
- [React Docs](https://react.dev)
- [Vite Docs](https://vitejs.dev)
- [Deno Docs](https://deno.land/manual)
- [Tailwind Docs](https://tailwindcss.com/docs)

---

## Getting Help

- Check existing issues on GitHub
- Read Supabase Discord #help channel
- Consult README and DEPLOYMENT guides
- Ask in team Slack/Discord

---

**Happy coding! 🎵**
