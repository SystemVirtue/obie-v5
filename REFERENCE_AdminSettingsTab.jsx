import { useState, useEffect, useRef, useMemo } from "react";

// ─── Guide content data structure ─────────────────────────────────────────────
const GUIDE_SECTIONS = [
  {
    id: "architecture",
    title: "Architecture Overview",
    icon: "🏗️",
    content: [
      {
        type: "text",
        body: "Obie Jukebox v2 is a server-first, real-time jukebox powered by Supabase. All state and business logic live on the server. The three frontend apps (Admin, Player, Kiosk) are thin clients that only render data and send commands.",
      },
      {
        type: "code",
        label: "Data Flow",
        body: "User Action → Frontend → Edge Function → RPC → Database → Realtime → All Clients",
      },
      {
        type: "table",
        headers: ["Component", "Technology"],
        rows: [
          ["Backend", "Supabase (Postgres + Realtime + Edge Functions)"],
          ["Frontend", "React 18 + Vite + TypeScript"],
          ["Styling", "Tailwind CSS"],
          ["Auth", "Supabase Auth + RLS"],
          ["Player", "YouTube iframe API"],
        ],
      },
      {
        type: "callout",
        variant: "info",
        body: "Real-time sync latency is <100ms. All queue operations use PostgreSQL advisory locks to prevent race conditions.",
      },
    ],
  },
  {
    id: "setup",
    title: "Installation & Setup",
    icon: "🚀",
    content: [
      {
        type: "text",
        body: "Prerequisites: Node.js 18+, Docker (for local Supabase), Supabase CLI, and a Supabase account (free tier supported).",
      },
      {
        type: "code",
        label: "Install & Quick Setup",
        body: `git clone https://github.com/SystemVirtue/obie-v5
cd obie-v5
npm install
./setup.sh`,
      },
      {
        type: "code",
        label: "Start Local Supabase + All Apps",
        body: `npm run supabase:start   # Terminal 1
npm run dev              # Terminal 2
supabase functions logs --local  # Terminal 3`,
      },
      {
        type: "table",
        headers: ["URL", "App"],
        rows: [
          ["http://localhost:5173", "Admin Console"],
          ["http://localhost:5174", "Player Window (keep open!)"],
          ["http://localhost:5175", "Kiosk Interface"],
          ["http://localhost:54323", "Supabase Studio"],
        ],
      },
      {
        type: "callout",
        variant: "warning",
        body: "After setup, always run `npm run supabase:reset` to apply all migrations and seed default data.",
      },
    ],
  },
  {
    id: "auth",
    title: "User Sign-Up / Log-In",
    icon: "🔐",
    content: [
      {
        type: "text",
        body: "The Admin Console requires authentication. Player and Kiosk run as anonymous clients with restricted RLS access.",
      },
      {
        type: "code",
        label: "Create Admin User via SQL",
        body: `INSERT INTO auth.users (email, encrypted_password, email_confirmed_at)
VALUES (
  'admin@example.com',
  crypt('your-password', gen_salt('bf')),
  NOW()
);`,
      },
      {
        type: "text",
        body: "Alternatively, use Supabase Studio → Authentication → Users → Add User, or the Supabase dashboard for cloud projects.",
      },
      {
        type: "table",
        headers: ["Role", "Access Level"],
        rows: [
          ["Admin (authenticated)", "Full read/write — queue, playlists, settings, logs"],
          ["Player (anonymous)", "Read/write own player_status only"],
          ["Kiosk (anonymous)", "Read media_items + player_settings; write own kiosk_sessions"],
        ],
      },
    ],
  },
  {
    id: "queue",
    title: "Admin Console — Queue Tab",
    icon: "🎵",
    content: [
      {
        type: "text",
        body: "The Queue Tab is the main operational view. Priority Queue (paid kiosk requests) always plays before Normal Queue items. Both update in real-time.",
      },
      {
        type: "callout",
        variant: "warning",
        body: "⚠️ The Player Window must be open and running for queue operations to function. The Player sends a heartbeat every 3 seconds.",
      },
      {
        type: "table",
        headers: ["Control", "Action"],
        rows: [
          ["Play/Pause", "Toggle playback on the Player window"],
          ["Skip", "Advance to the next song in queue"],
          ["Clear", "Remove all songs from queue"],
          ["Drag & Drop", "Reorder queue items (atomically server-side)"],
        ],
      },
      {
        type: "code",
        label: "Add Song via SQL",
        body: `SELECT queue_add(
  '00000000-0000-0000-0000-000000000001',
  '<media_item_id>',
  'normal',   -- or 'priority'
  'admin'
);`,
      },
    ],
  },
  {
    id: "playlists",
    title: "Admin Console — Playlists Tab",
    icon: "📋",
    content: [
      {
        type: "text",
        body: "Manage your playlist library. The active playlist auto-loads into the queue when the Player starts. Deduplication ensures videos shared across playlists are stored only once.",
      },
      {
        type: "table",
        headers: ["Playlist", "Songs"],
        rows: [
          ["Obie Playlist (Default)", "1,217"],
          ["Main Playlist", "192"],
          ["Obie Nights", "190"],
          ["Poly", "82"],
          ["Obie Johno", "78"],
          ["DJAMMMS Default", "58"],
          ["Karaoke", "57"],
          ["Obie Jo", "35"],
        ],
      },
      {
        type: "code",
        label: "Set Active Playlist",
        body: `UPDATE players SET
  active_playlist_id = '<playlist-uuid>'
WHERE id = '00000000-0000-0000-0000-000000000001';`,
      },
      {
        type: "code",
        label: "Resume from Specific Position",
        body: `UPDATE player_status
SET now_playing_index = 10
WHERE player_id = '00000000-0000-0000-0000-000000000001';
-- Refresh Player — starts from song #10`,
      },
    ],
  },
  {
    id: "settings",
    title: "Admin Console — Settings Tab",
    icon: "⚙️",
    content: [
      {
        type: "table",
        headers: ["Setting", "Default", "Description"],
        rows: [
          ["loop", "false", "Loop playlist when queue ends"],
          ["shuffle", "false", "Randomise queue order"],
          ["volume", "75", "Playback volume (0–100)"],
          ["freeplay", "false", "Allow requests without credits"],
          ["coin_per_song", "1", "Credits required per song request"],
          ["max_queue_size", "50", "Max songs in normal queue"],
          ["priority_queue_limit", "10", "Max songs in priority queue"],
        ],
      },
      {
        type: "code",
        label: "Update Settings via SQL",
        body: `UPDATE player_settings SET
  freeplay = false,
  coin_per_song = 1,
  shuffle = true,
  volume = 75
WHERE player_id = '00000000-0000-0000-0000-000000000001';`,
      },
      {
        type: "code",
        label: "Set Kiosk Branding",
        body: `UPDATE player_settings SET
  branding = '{
    "name": "My Jukebox",
    "logo": "https://example.com/logo.png",
    "theme": "dark"
  }'::jsonb
WHERE player_id = '00000000-0000-0000-0000-000000000001';`,
      },
    ],
  },
  {
    id: "kiosk",
    title: "Kiosk Webpage",
    icon: "🔍",
    content: [
      {
        type: "text",
        body: "The Kiosk Interface (port 5175) is a touch-optimised public terminal. It searches the local media_items database (not live YouTube) and adds requests to the Priority Queue.",
      },
      {
        type: "text",
        body: "Credits: Each song request costs 1 credit (configurable). Enable freeplay to bypass credits entirely. In production, credits are added via a physical coin acceptor using the WebSerial API.",
      },
      {
        type: "code",
        label: "Credit Operations",
        body: `-- Add credits
SELECT kiosk_increment_credit('<session_id>', 1);

-- Check balance
SELECT credits FROM kiosk_sessions WHERE id = '<session_id>';

-- Enable free play
UPDATE player_settings SET freeplay = true;`,
      },
      {
        type: "callout",
        variant: "info",
        body: "During development, use the 'Insert Coin (Dev)' button on the Kiosk page to add credits for testing.",
      },
    ],
  },
  {
    id: "player",
    title: "Player Webpage",
    icon: "▶️",
    content: [
      {
        type: "callout",
        variant: "warning",
        body: "Keep the Player Window (port 5174) open at all times! It sends a heartbeat every 3 seconds. Without it, the system shows 'Player offline'.",
      },
      {
        type: "table",
        headers: ["State", "Display"],
        rows: [
          ["idle", "Idle screen / logo"],
          ["loading", "Loading spinner while YouTube video loads"],
          ["playing", "Full-screen YouTube iframe"],
          ["paused", "Paused YouTube iframe"],
          ["error", "Error message with retry option"],
        ],
      },
      {
        type: "text",
        body: "The Player auto-initialises on load: calls initialize_player_playlist(), loads the active playlist from now_playing_index, and begins playback automatically.",
      },
      {
        type: "code",
        label: "Debug Overlay Info",
        body: `// Console logs prefixed [Player]:
// - Init status: initializing → loading_playlist → ready/error
// - Player state: idle/playing/paused/loading/error
// - Current track title + artist
// - Progress (0–100%)
// - now_playing_index + media_id`,
      },
    ],
  },
  {
    id: "scripts",
    title: "Edge Functions & Scripts",
    icon: "⚡",
    content: [
      {
        type: "table",
        headers: ["Script", "Purpose"],
        rows: [
          ["setup.sh", "Interactive first-run setup wizard"],
          ["populate-playlist.sh", "Import a single YouTube playlist by ID"],
          ["import-all-playlists.sh", "Batch import multiple playlists"],
          ["retry-failed-playlists.sh", "Retry failed imports with API key rotation"],
        ],
      },
      {
        type: "table",
        headers: ["Edge Function", "Purpose"],
        rows: [
          ["queue-manager", "Queue CRUD (add, remove, reorder, next, skip, clear)"],
          ["player-control", "Status updates, progress, heartbeat"],
          ["kiosk-handler", "Search, credit management, song requests"],
          ["playlist-manager", "Playlist CRUD and YouTube media scraping"],
        ],
      },
      {
        type: "code",
        label: "Deploy Edge Functions",
        body: `npm run supabase:deploy
# Or individually:
supabase functions deploy queue-manager
supabase functions deploy player-control`,
      },
    ],
  },
  {
    id: "youtube",
    title: "YouTube API Setup",
    icon: "📺",
    content: [
      {
        type: "text",
        body: "A YouTube Data API v3 key is required for playlist import. Each key has 10,000 queries/day free. The system supports rotating through multiple keys for large batch imports.",
      },
      {
        type: "code",
        label: "Configure API Key (Local)",
        body: `echo "YOUTUBE_API_KEY=your-key-here" > supabase/.env.local
supabase stop && supabase start`,
      },
      {
        type: "code",
        label: "Configure API Key (Production)",
        body: `supabase secrets set YOUTUBE_API_KEY=your-key-here
supabase secrets list`,
      },
      {
        type: "callout",
        variant: "info",
        body: "Media is cached in media_items by source_id. Re-importing a playlist skips already-cached videos, using minimal API quota.",
      },
    ],
  },
  {
    id: "deployment",
    title: "Production Deployment",
    icon: "🌐",
    content: [
      {
        type: "text",
        body: "Deploy to Supabase Cloud + Vercel/Netlify. Each of the three frontend apps is deployed separately.",
      },
      {
        type: "code",
        label: "Migrate & Deploy",
        body: `supabase login
supabase link --project-ref <your-project-ref>
supabase db push
npm run supabase:deploy
npm run build`,
      },
      {
        type: "callout",
        variant: "warning",
        body: "Never expose the service_role key in frontend code. Use only the anon key in VITE_SUPABASE_ANON_KEY.",
      },
      {
        type: "table",
        headers: ["Resource", "Usage", "Free Limit", "Status"],
        rows: [
          ["Invocations", "25K/mo", "500K/mo", "✅ 5%"],
          ["CPU Time", "21 min", "50 hrs", "✅ 0.7%"],
          ["Realtime", "3 conns", "200 conns", "✅ 1.5%"],
          ["DB Size", "<50 MB", "8 GB", "✅ 0.6%"],
        ],
      },
    ],
  },
  {
    id: "troubleshooting",
    title: "Troubleshooting",
    icon: "🐛",
    content: [
      {
        type: "table",
        headers: ["Issue", "Fix"],
        rows: [
          ["'Player offline' in Admin", "Open http://localhost:5174 and keep it open"],
          ["'Insufficient credits' in Kiosk", "Click 'Insert Coin (Dev)' or enable freeplay"],
          ["Realtime not updating", "Check Realtime is enabled in Supabase dashboard"],
          ["YouTube quota exceeded", "Use retry-failed-playlists.sh with key rotation"],
          ["CORS errors", "Update corsHeaders in supabase/functions/_shared/cors.ts"],
          ["Player not auto-playing", "Check console for [Player] logs; verify playlist exists"],
        ],
      },
      {
        type: "code",
        label: "Check Edge Function Logs",
        body: `supabase functions logs --local`,
      },
      {
        type: "code",
        label: "Test Queue Function",
        body: `curl -X POST http://localhost:54321/functions/v1/queue-manager \\
  -H "Authorization: Bearer YOUR_ANON_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"player_id":"00000000-0000-0000-0000-000000000001","action":"clear"}'`,
      },
    ],
  },
];

// ─── Scripts data ──────────────────────────────────────────────────────────────
const SCRIPTS = [
  {
    id: "setup",
    name: "setup.sh",
    label: "Run Setup Wizard",
    description: "Interactive first-run configuration — creates env files, seeds database, and links Supabase project.",
    icon: "🚀",
    requiresInput: false,
    command: "./setup.sh",
    category: "Setup",
  },
  {
    id: "populate-playlist",
    name: "populate-playlist.sh",
    label: "Import Single Playlist",
    description: "Import one YouTube playlist into the database. Requires the YouTube Playlist ID (found after 'list=' in the playlist URL).",
    icon: "📥",
    requiresInput: true,
    inputLabel: "YouTube Playlist ID",
    inputPlaceholder: "e.g. PLN9QqCogPsXJCgeL_iEgYnW6Rl_8nIUUH",
    inputHelp: "Find this in your playlist URL: youtube.com/playlist?list=<ID_HERE>",
    command: (id) => `./populate-playlist.sh ${id}`,
    category: "Playlists",
  },
  {
    id: "import-all",
    name: "import-all-playlists.sh",
    label: "Batch Import All Playlists",
    description: "Import all playlists defined in the script. Includes a 3-second delay between imports to avoid YouTube API rate limits.",
    icon: "📦",
    requiresInput: false,
    command: "./import-all-playlists.sh",
    category: "Playlists",
  },
  {
    id: "retry-failed",
    name: "retry-failed-playlists.sh",
    label: "Retry Failed Imports",
    description: "Retry only playlists that failed in a previous batch import. Features automatic API key rotation on quota exceeded (403).",
    icon: "🔄",
    requiresInput: false,
    command: "./retry-failed-playlists.sh",
    category: "Playlists",
  },
];

// ─── Utility components ────────────────────────────────────────────────────────
function Badge({ children, variant = "default" }) {
  const variants = {
    default: "bg-zinc-700 text-zinc-300",
    info: "bg-blue-900/60 text-blue-300",
    warning: "bg-amber-900/60 text-amber-300",
    success: "bg-emerald-900/60 text-emerald-300",
    error: "bg-red-900/60 text-red-300",
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded font-mono ${variants[variant]}`}>
      {children}
    </span>
  );
}

function Callout({ variant = "info", children }) {
  const styles = {
    info: "border-blue-500/40 bg-blue-950/40 text-blue-200",
    warning: "border-amber-500/40 bg-amber-950/40 text-amber-200",
    error: "border-red-500/40 bg-red-950/40 text-red-200",
  };
  const icons = { info: "ℹ️", warning: "⚠️", error: "🚨" };
  return (
    <div className={`border rounded-lg p-3 flex gap-2 text-sm ${styles[variant]}`}>
      <span className="shrink-0">{icons[variant]}</span>
      <span>{children}</span>
    </div>
  );
}

function CodeBlock({ label, children }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(children).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="rounded-lg overflow-hidden border border-zinc-700">
      {label && (
        <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-800 border-b border-zinc-700">
          <span className="text-xs text-zinc-400 font-mono">{label}</span>
          <button
            onClick={copy}
            className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            {copied ? "✓ Copied" : "Copy"}
          </button>
        </div>
      )}
      <pre className="p-3 bg-zinc-900 text-sm text-emerald-300 font-mono overflow-x-auto whitespace-pre-wrap leading-relaxed">
        {children}
      </pre>
    </div>
  );
}

function GuideTable({ headers, rows }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-700">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-zinc-800 border-b border-zinc-700">
            {headers.map((h) => (
              <th key={h} className="text-left px-3 py-2 text-zinc-300 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={i}
              className={`border-b border-zinc-800 last:border-0 ${
                i % 2 === 0 ? "bg-zinc-900/50" : "bg-zinc-900/20"
              }`}
            >
              {row.map((cell, j) => (
                <td key={j} className="px-3 py-2 text-zinc-300 font-mono text-xs">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GuideContentBlock({ block }) {
  switch (block.type) {
    case "text":
      return <p className="text-zinc-300 text-sm leading-relaxed">{block.body}</p>;
    case "code":
      return <CodeBlock label={block.label}>{block.body}</CodeBlock>;
    case "callout":
      return <Callout variant={block.variant}>{block.body}</Callout>;
    case "table":
      return <GuideTable headers={block.headers} rows={block.rows} />;
    default:
      return null;
  }
}

// ─── User Guide Modal ──────────────────────────────────────────────────────────
function UserGuideModal({ onClose }) {
  const [activeSection, setActiveSection] = useState(GUIDE_SECTIONS[0].id);
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState({});
  const searchRef = useRef(null);

  useEffect(() => {
    searchRef.current?.focus();
    const handleKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const filteredSections = useMemo(() => {
    if (!search.trim()) return GUIDE_SECTIONS;
    const q = search.toLowerCase();
    return GUIDE_SECTIONS.filter((s) => {
      const inTitle = s.title.toLowerCase().includes(q);
      const inContent = s.content.some((block) => {
        if (block.body && typeof block.body === "string") return block.body.toLowerCase().includes(q);
        if (block.rows) return block.rows.flat().some((c) => c.toLowerCase().includes(q));
        return false;
      });
      return inTitle || inContent;
    });
  }, [search]);

  const activeData = GUIDE_SECTIONS.find((s) => s.id === activeSection) || filteredSections[0];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative z-10 w-full max-w-5xl h-[85vh] flex flex-col rounded-2xl border border-zinc-700 bg-zinc-950 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-zinc-800 bg-zinc-900/80 shrink-0">
          <span className="text-2xl">🎵</span>
          <div>
            <h2 className="text-lg font-bold text-white tracking-tight">
              Obie Jukebox v2 — User Guide
            </h2>
            <p className="text-xs text-zinc-400">
              Complete reference for setup, configuration, and operation
            </p>
          </div>
          <div className="ml-auto">
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg bg-zinc-800 hover:bg-zinc-700 flex items-center justify-center text-zinc-400 hover:text-white transition-colors text-lg"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="px-5 py-3 border-b border-zinc-800 bg-zinc-900/50 shrink-0">
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 text-sm">
              🔍
            </span>
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                if (filteredSections.length > 0 && e.target.value) {
                  setActiveSection(filteredSections[0]?.id);
                }
              }}
              placeholder="Search the guide…"
              className="w-full pl-9 pr-4 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-violet-500 transition-colors"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar Nav */}
          <aside className="w-56 shrink-0 border-r border-zinc-800 overflow-y-auto py-2">
            {filteredSections.map((section) => (
              <button
                key={section.id}
                onClick={() => setActiveSection(section.id)}
                className={`w-full text-left flex items-center gap-2.5 px-4 py-2.5 text-sm transition-all ${
                  activeSection === section.id
                    ? "bg-violet-600/20 border-r-2 border-violet-500 text-violet-300"
                    : "text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200"
                }`}
              >
                <span className="text-base shrink-0">{section.icon}</span>
                <span className="leading-tight">{section.title}</span>
              </button>
            ))}
            {filteredSections.length === 0 && (
              <p className="text-zinc-500 text-sm px-4 py-6 text-center">
                No results for "{search}"
              </p>
            )}
          </aside>

          {/* Content */}
          <main className="flex-1 overflow-y-auto px-6 py-5">
            {activeData && (
              <div>
                <div className="flex items-center gap-3 mb-5">
                  <span className="text-3xl">{activeData.icon}</span>
                  <h3 className="text-xl font-bold text-white">{activeData.title}</h3>
                </div>
                <div className="space-y-4">
                  {activeData.content.map((block, i) => (
                    <GuideContentBlock key={i} block={block} />
                  ))}
                </div>
              </div>
            )}
          </main>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-zinc-800 bg-zinc-900/50 shrink-0 flex items-center justify-between">
          <span className="text-xs text-zinc-500">
            {GUIDE_SECTIONS.length} sections · Press Esc to close
          </span>
          <a
            href="#"
            className="text-xs text-violet-400 hover:text-violet-300 transition-colors"
            onClick={(e) => e.preventDefault()}
          >
            📄 Download PDF Guide
          </a>
        </div>
      </div>
    </div>
  );
}

// ─── Script Runner ─────────────────────────────────────────────────────────────
function ScriptCard({ script }) {
  const [inputVal, setInputVal] = useState("");
  const [status, setStatus] = useState("idle"); // idle | confirm | running | success | error
  const [log, setLog] = useState("");

  const handleRun = () => {
    if (script.requiresInput && !inputVal.trim()) return;
    setStatus("confirm");
  };

  const handleConfirm = () => {
    setStatus("running");
    setLog("$ " + (script.requiresInput ? script.command(inputVal.trim()) : script.command) + "\n");

    // Simulate script execution with progressive log output
    const messages = [
      "Connecting to Supabase...",
      "Authenticating...",
      `Executing ${script.name}...`,
      "Processing...",
      "✓ Done.",
    ];
    let i = 0;
    const interval = setInterval(() => {
      if (i < messages.length) {
        setLog((prev) => prev + messages[i] + "\n");
        i++;
      } else {
        clearInterval(interval);
        setStatus("success");
      }
    }, 600);
  };

  const handleReset = () => {
    setStatus("idle");
    setLog("");
    setInputVal("");
  };

  const categoryColors = {
    Setup: "text-violet-400",
    Playlists: "text-emerald-400",
  };

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
      <div className="p-4">
        <div className="flex items-start gap-3">
          <span className="text-2xl shrink-0 mt-0.5">{script.icon}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <code className="text-sm font-mono text-zinc-300">{script.name}</code>
              <span className={`text-xs font-medium ${categoryColors[script.category] || "text-zinc-400"}`}>
                {script.category}
              </span>
            </div>
            <p className="text-sm text-zinc-400 mt-1 leading-relaxed">{script.description}</p>

            {script.requiresInput && status === "idle" && (
              <div className="mt-3">
                <label className="block text-xs text-zinc-400 mb-1">
                  {script.inputLabel}
                </label>
                <input
                  value={inputVal}
                  onChange={(e) => setInputVal(e.target.value)}
                  placeholder={script.inputPlaceholder}
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-200 font-mono placeholder-zinc-600 focus:outline-none focus:border-violet-500 transition-colors"
                />
                {script.inputHelp && (
                  <p className="text-xs text-zinc-500 mt-1">{script.inputHelp}</p>
                )}
              </div>
            )}
          </div>

          <div className="shrink-0 flex gap-2">
            {status === "idle" && (
              <button
                onClick={handleRun}
                disabled={script.requiresInput && !inputVal.trim()}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 hover:bg-violet-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white text-sm rounded-lg transition-colors font-medium"
              >
                ▶ Run
              </button>
            )}
            {(status === "success" || status === "error") && (
              <button
                onClick={handleReset}
                className="px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 text-sm rounded-lg transition-colors"
              >
                Reset
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Confirm Dialog */}
      {status === "confirm" && (
        <div className="mx-4 mb-4 p-3 rounded-lg bg-amber-950/50 border border-amber-700/50">
          <p className="text-sm text-amber-300 mb-2">
            ⚠️ About to run:
          </p>
          <code className="text-xs text-amber-200 font-mono block mb-3 break-all">
            {script.requiresInput ? script.command(inputVal.trim()) : script.command}
          </code>
          <div className="flex gap-2">
            <button
              onClick={handleConfirm}
              className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white text-sm rounded-lg transition-colors"
            >
              Confirm & Run
            </button>
            <button
              onClick={handleReset}
              className="px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 text-sm rounded-lg transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Log Output */}
      {(status === "running" || status === "success" || status === "error") && log && (
        <div className="mx-4 mb-4 rounded-lg overflow-hidden border border-zinc-700">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-zinc-800 border-b border-zinc-700">
            <div
              className={`w-2 h-2 rounded-full ${
                status === "running"
                  ? "bg-amber-400 animate-pulse"
                  : status === "success"
                  ? "bg-emerald-400"
                  : "bg-red-400"
              }`}
            />
            <span className="text-xs text-zinc-400">
              {status === "running" ? "Running…" : status === "success" ? "Completed" : "Failed"}
            </span>
          </div>
          <pre className="p-3 bg-zinc-950 text-xs text-emerald-300 font-mono whitespace-pre-wrap leading-relaxed max-h-36 overflow-y-auto">
            {log}
          </pre>
        </div>
      )}
    </div>
  );
}

// ─── Settings Toggle / Input components ───────────────────────────────────────
function SettingToggle({ label, description, value, onChange }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 border-b border-zinc-800 last:border-0">
      <div>
        <p className="text-sm font-medium text-zinc-200">{label}</p>
        {description && <p className="text-xs text-zinc-500 mt-0.5">{description}</p>}
      </div>
      <button
        onClick={() => onChange(!value)}
        className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${
          value ? "bg-violet-600" : "bg-zinc-700"
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
            value ? "translate-x-5" : "translate-x-0"
          }`}
        />
      </button>
    </div>
  );
}

function SettingSlider({ label, description, value, onChange, min = 0, max = 100 }) {
  return (
    <div className="py-3 border-b border-zinc-800 last:border-0">
      <div className="flex items-center justify-between mb-2">
        <div>
          <p className="text-sm font-medium text-zinc-200">{label}</p>
          {description && <p className="text-xs text-zinc-500 mt-0.5">{description}</p>}
        </div>
        <Badge>{value}</Badge>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-violet-500 h-1.5 rounded-full cursor-pointer"
      />
    </div>
  );
}

function SettingNumber({ label, description, value, onChange, min = 0 }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 border-b border-zinc-800 last:border-0">
      <div>
        <p className="text-sm font-medium text-zinc-200">{label}</p>
        {description && <p className="text-xs text-zinc-500 mt-0.5">{description}</p>}
      </div>
      <input
        type="number"
        min={min}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-20 px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-center text-zinc-200 focus:outline-none focus:border-violet-500"
      />
    </div>
  );
}

// ─── Main Settings Tab Component ───────────────────────────────────────────────
export default function AdminSettingsTab() {
  const [showGuide, setShowGuide] = useState(false);
  const [saveStatus, setSaveStatus] = useState("idle");
  const [activeScriptCategory, setActiveScriptCategory] = useState("All");

  const [settings, setSettings] = useState({
    loop: false,
    shuffle: true,
    volume: 75,
    freeplay: false,
    coinPerSong: 1,
    searchEnabled: true,
    maxQueueSize: 50,
    priorityQueueLimit: 10,
  });

  const [branding, setBranding] = useState({
    name: "Obie Jukebox",
    logo: "",
    theme: "dark",
  });

  const set = (key) => (val) => setSettings((s) => ({ ...s, [key]: val }));

  const handleSave = () => {
    setSaveStatus("saving");
    setTimeout(() => {
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2500);
    }, 900);
  };

  const scriptCategories = ["All", ...new Set(SCRIPTS.map((s) => s.category))];
  const visibleScripts =
    activeScriptCategory === "All"
      ? SCRIPTS
      : SCRIPTS.filter((s) => s.category === activeScriptCategory);

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      {/* User Guide Modal */}
      {showGuide && <UserGuideModal onClose={() => setShowGuide(false)} />}

      <div className="max-w-4xl mx-auto px-4 py-8 space-y-8">
        {/* Page Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white tracking-tight">Settings</h1>
            <p className="text-sm text-zinc-500 mt-1">
              Player ID:{" "}
              <code className="text-zinc-400 font-mono text-xs">
                00000000-0000-0000-0000-000000000001
              </code>
            </p>
          </div>

          {/* View User Guide Button */}
          <button
            onClick={() => setShowGuide(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 text-white rounded-xl font-medium text-sm shadow-lg shadow-violet-900/30 transition-all hover:shadow-violet-800/40 hover:scale-105"
          >
            <span>📖</span>
            View User Guide
          </button>
        </div>

        {/* ── Playback Settings ─────────────────────────────────────────────── */}
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
          <div className="px-5 py-4 border-b border-zinc-800 flex items-center gap-2">
            <span className="text-lg">🎧</span>
            <h2 className="font-semibold text-zinc-100">Playback</h2>
          </div>
          <div className="px-5">
            <SettingToggle
              label="Loop Playlist"
              description="Restart from the beginning when the queue ends"
              value={settings.loop}
              onChange={set("loop")}
            />
            <SettingToggle
              label="Shuffle"
              description="Randomise queue order when loading a playlist"
              value={settings.shuffle}
              onChange={set("shuffle")}
            />
            <SettingSlider
              label="Volume"
              description="Default playback volume (0–100)"
              value={settings.volume}
              onChange={set("volume")}
            />
          </div>
        </section>

        {/* ── Kiosk Settings ────────────────────────────────────────────────── */}
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
          <div className="px-5 py-4 border-b border-zinc-800 flex items-center gap-2">
            <span className="text-lg">🔍</span>
            <h2 className="font-semibold text-zinc-100">Kiosk</h2>
          </div>
          <div className="px-5">
            <SettingToggle
              label="Free Play Mode"
              description="Allow song requests without requiring credits"
              value={settings.freeplay}
              onChange={set("freeplay")}
            />
            <SettingToggle
              label="Search Enabled"
              description="Allow kiosk users to search for songs"
              value={settings.searchEnabled}
              onChange={set("searchEnabled")}
            />
            <SettingNumber
              label="Credits per Song"
              description="Number of credits required for each song request"
              value={settings.coinPerSong}
              onChange={set("coinPerSong")}
              min={1}
            />
            <SettingNumber
              label="Max Queue Size"
              description="Maximum songs allowed in the normal queue"
              value={settings.maxQueueSize}
              onChange={set("maxQueueSize")}
              min={1}
            />
            <SettingNumber
              label="Priority Queue Limit"
              description="Maximum songs allowed in the priority (paid) queue"
              value={settings.priorityQueueLimit}
              onChange={set("priorityQueueLimit")}
              min={1}
            />
          </div>
        </section>

        {/* ── Branding ──────────────────────────────────────────────────────── */}
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
          <div className="px-5 py-4 border-b border-zinc-800 flex items-center gap-2">
            <span className="text-lg">🎨</span>
            <h2 className="font-semibold text-zinc-100">Branding</h2>
            <span className="text-xs text-zinc-500 ml-1">Kiosk & Player display</span>
          </div>
          <div className="px-5 py-4 space-y-4">
            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-1.5">
                Jukebox Name
              </label>
              <input
                value={branding.name}
                onChange={(e) => setBranding((b) => ({ ...b, name: e.target.value }))}
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-200 focus:outline-none focus:border-violet-500 transition-colors"
                placeholder="My Jukebox"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-1.5">
                Logo URL
              </label>
              <input
                value={branding.logo}
                onChange={(e) => setBranding((b) => ({ ...b, logo: e.target.value }))}
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-200 font-mono focus:outline-none focus:border-violet-500 transition-colors"
                placeholder="https://example.com/logo.png"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-1.5">Theme</label>
              <div className="flex gap-2">
                {["dark", "light"].map((t) => (
                  <button
                    key={t}
                    onClick={() => setBranding((b) => ({ ...b, theme: t }))}
                    className={`px-4 py-2 rounded-lg text-sm capitalize transition-colors ${
                      branding.theme === t
                        ? "bg-violet-600 text-white"
                        : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                    }`}
                  >
                    {t === "dark" ? "🌙" : "☀️"} {t}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ── Save Button ───────────────────────────────────────────────────── */}
        <div className="flex justify-end">
          <button
            onClick={handleSave}
            className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-medium transition-all ${
              saveStatus === "saved"
                ? "bg-emerald-600 text-white"
                : "bg-violet-600 hover:bg-violet-500 text-white"
            }`}
          >
            {saveStatus === "saving" ? (
              <>
                <span className="inline-block w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                Saving…
              </>
            ) : saveStatus === "saved" ? (
              <>✓ Saved</>
            ) : (
              <>💾 Save Settings</>
            )}
          </button>
        </div>

        {/* ── Functions & Scripts ───────────────────────────────────────────── */}
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
          <div className="px-5 py-4 border-b border-zinc-800">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-lg">⚡</span>
              <h2 className="font-semibold text-zinc-100">Functions & Scripts</h2>
            </div>
            <p className="text-xs text-zinc-500">
              Run server-side scripts and Edge Functions directly from the Admin Console.
              Operations are executed on the backend — monitor Supabase logs for full output.
            </p>
          </div>

          {/* Category filter */}
          <div className="px-5 py-3 border-b border-zinc-800 flex gap-2">
            {scriptCategories.map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveScriptCategory(cat)}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                  activeScriptCategory === cat
                    ? "bg-violet-600 text-white"
                    : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          <div className="p-4 space-y-3">
            {visibleScripts.map((script) => (
              <ScriptCard key={script.id} script={script} />
            ))}
          </div>

          <div className="px-5 py-3 border-t border-zinc-800 bg-zinc-900/30">
            <p className="text-xs text-zinc-600">
              ⚡ Scripts connect to your configured Supabase instance. Ensure your{" "}
              <code className="text-zinc-500">YOUTUBE_API_KEY</code> is set before running
              playlist import scripts.
            </p>
          </div>
        </section>

        {/* Footer spacer */}
        <div className="h-8" />
      </div>
    </div>
  );
}
