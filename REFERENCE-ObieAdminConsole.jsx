import { useState, useEffect, useRef } from "react";

/* ─── Google Fonts injection ─────────────────────────────────────────────── */
const FontInjector = () => {
  useEffect(() => {
    const link = document.createElement("link");
    link.href = "https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap";
    link.rel = "stylesheet";
    document.head.appendChild(link);
  }, []);
  return null;
};

/* ─── Mock Data ──────────────────────────────────────────────────────────── */
const MOCK_NOW_PLAYING = {
  title: "Sonnentanz (Sun Don't Shine)",
  artist: "Klangkarussell ft. Will Heard",
  playlist: "Obie Playlist",
  duration: 272,
  progress: 94,
  thumbnail: "https://i.ytimg.com/vi/4UDNndFX94Y/mqdefault.jpg",
  accentColor: "#d97706",
};

const MOCK_UP_NEXT = [
  { id: 1, title: "Midnight City", artist: "M83", duration: "4:03", thumbnail: "https://i.ytimg.com/vi/gGdGFtwCNBE/mqdefault.jpg" },
  { id: 2, title: "Oblivion", artist: "Grimes", duration: "5:03", thumbnail: "https://i.ytimg.com/vi/1rZdHGmRbdA/mqdefault.jpg" },
  { id: 3, title: "Flume", artist: "Bon Iver", duration: "3:40", thumbnail: "https://i.ytimg.com/vi/JlVID4VhLWI/mqdefault.jpg" },
];

const MOCK_KIOSK_REQUESTS = [
  { id: 1, title: "Bohemian Rhapsody", artist: "Queen", requester: "Table 4", credits: 2, thumbnail: "https://i.ytimg.com/vi/fJ9rUzIMcZQ/mqdefault.jpg" },
  { id: 2, title: "Sweet Child O'Mine", artist: "Guns N' Roses", requester: "Bar", credits: 1, thumbnail: "https://i.ytimg.com/vi/1w7OgIMMRc4/mqdefault.jpg" },
];

const MOCK_QUEUE = [
  { id: 1, pos: 1, title: "Midnight City", artist: "M83", duration: "4:03", type: "normal" },
  { id: 2, pos: 2, title: "Oblivion", artist: "Grimes", duration: "5:03", type: "normal" },
  { id: 3, pos: 3, title: "Flume", artist: "Bon Iver", duration: "3:40", type: "normal" },
  { id: 4, pos: 4, title: "Do I Wanna Know?", artist: "Arctic Monkeys", duration: "4:32", type: "normal" },
  { id: 5, pos: 5, title: "Electric Feel", artist: "MGMT", duration: "3:49", type: "normal" },
  { id: 6, pos: 6, title: "Holocene", artist: "Bon Iver", duration: "5:37", type: "normal" },
  { id: 7, pos: 7, title: "Crystalised", artist: "The xx", duration: "3:31", type: "normal" },
  { id: 8, pos: 8, title: "Take Care", artist: "Drake ft. Rihanna", duration: "4:38", type: "normal" },
];

const MOCK_PLAYLISTS = [
  { id: 1, name: "Obie Playlist", songs: 1217, active: true, lastPlayed: "Now" },
  { id: 2, name: "Main Playlist", songs: 192, active: false, lastPlayed: "Yesterday" },
  { id: 3, name: "Obie Nights", songs: 190, active: false, lastPlayed: "2 days ago" },
  { id: 4, name: "Poly", songs: 82, active: false, lastPlayed: "4 days ago" },
  { id: 5, name: "Obie Johno", songs: 78, active: false, lastPlayed: "1 week ago" },
  { id: 6, name: "DJAMMMS Default", songs: 58, active: false, lastPlayed: "1 week ago" },
  { id: 7, name: "Karaoke", songs: 57, active: false, lastPlayed: "2 weeks ago" },
  { id: 8, name: "Obie Jo", songs: 35, active: false, lastPlayed: "1 month ago" },
];

const MOCK_LOGS = [
  { id: 1, time: "14:32:01", level: "info", message: "Song started: Sonnentanz by Klangkarussell", source: "player-control" },
  { id: 2, time: "14:31:58", level: "info", message: "Queue advanced — now_playing_index: 94", source: "queue-manager" },
  { id: 3, time: "14:31:55", level: "info", message: "Kiosk request added to priority queue: Bohemian Rhapsody", source: "kiosk-handler" },
  { id: 4, time: "14:31:50", level: "info", message: "Player heartbeat OK — latency 12ms", source: "player-control" },
  { id: 5, time: "14:30:22", level: "warning", message: "YouTube API quota at 82% for key #3", source: "playlist-manager" },
  { id: 6, time: "14:28:11", level: "info", message: "Credit added: session a3f9b2 — balance: 2", source: "kiosk-handler" },
  { id: 7, time: "14:25:00", level: "info", message: "Playlist loaded: Obie Playlist — 35 songs into queue", source: "playlist-manager" },
  { id: 8, time: "14:24:58", level: "info", message: "Player initialised — now_playing_index: 0", source: "player-control" },
  { id: 9, time: "14:20:13", level: "error", message: "Edge Function timeout: playlist-manager (>10s)", source: "playlist-manager" },
  { id: 10, time: "14:18:30", level: "info", message: "Admin signed in: admin@example.com", source: "auth" },
];

const SCRIPTS = [
  { id: "setup", name: "setup.sh", icon: "⚡", category: "Setup", desc: "Interactive first-run configuration wizard", requiresInput: false },
  { id: "populate", name: "populate-playlist.sh", icon: "📥", category: "Playlists", desc: "Import a single YouTube playlist by ID", requiresInput: true, inputLabel: "YouTube Playlist ID", inputPlaceholder: "PLN9QqCogPsXJCgeL_iEgYnW6Rl_8nIUUH" },
  { id: "import-all", name: "import-all-playlists.sh", icon: "📦", category: "Playlists", desc: "Batch import all configured playlists", requiresInput: false },
  { id: "retry", name: "retry-failed-playlists.sh", icon: "🔄", category: "Playlists", desc: "Retry failed imports with API key rotation", requiresInput: false },
];

/* ─── Helpers ────────────────────────────────────────────────────────────── */
const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/* ─── Icons (inline SVG) ─────────────────────────────────────────────────── */
const Icon = ({ name, size = 18, className = "" }) => {
  const icons = {
    play: <polygon points="5,3 19,12 5,21" />,
    pause: <><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></>,
    skip: <><polygon points="5,4 15,12 5,20"/><line x1="19" y1="5" x2="19" y2="19" strokeWidth="2"/></>,
    prev: <><polygon points="19,4 9,12 19,20"/><line x1="5" y1="5" x2="5" y2="19" strokeWidth="2"/></>,
    vol: <><polygon points="11,5 6,9 2,9 2,15 6,15 11,19"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></>,
    queue: <><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="15" y2="18"/></>,
    playlist: <><path d="M21 15V6"/><path d="M18.5 18a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z"/><path d="M12 12H3"/><path d="M16 6H3"/><path d="M12 18H3"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></>,
    logs: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></>,
    chevron: <polyline points="9,18 15,12 9,6" />,
    kiosk: <><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></>,
    trash: <><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></>,
    drag: <><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></>,
    add: <><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></>,
    terminal: <><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></>,
    book: <><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></>,
    star: <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>,
    coin: <><circle cx="12" cy="12" r="10"/><path d="M12 6v12M9 9h4.5a1.5 1.5 0 0 1 0 3H9m0 3h4.5a1.5 1.5 0 0 0 0-3"/></>,
    check: <polyline points="20 6 9 17 4 12"/>,
    x: <><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>,
    search: <><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></>,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      {icons[name]}
    </svg>
  );
};

/* ─── Now Playing Stage ──────────────────────────────────────────────────── */
const NowPlayingStage = ({ playing, setPlaying, volume, setVolume, progress, setProgress }) => {
  const [showVol, setShowVol] = useState(false);

  return (
    <div className="relative overflow-hidden flex-shrink-0" style={{ height: "33vh", minHeight: 240, background: "#050505" }}>
      {/* Atmospheric blurred art backdrop */}
      <div className="absolute inset-0" style={{ overflow: "hidden" }}>
        <img
          src={MOCK_NOW_PLAYING.thumbnail}
          alt=""
          className="absolute w-full h-full"
          style={{ objectFit: "cover", filter: "blur(60px) saturate(1.4) brightness(0.35)", transform: "scale(1.3)", left: 0, top: 0 }}
        />
        <div className="absolute inset-0" style={{ background: "linear-gradient(135deg, rgba(5,5,5,0.7) 0%, rgba(5,5,5,0.3) 50%, rgba(5,5,5,0.85) 100%)" }} />
      </div>

      {/* Grain texture overlay */}
      <div className="absolute inset-0 opacity-20" style={{
        backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='0.4'/%3E%3C/svg%3E")`,
        backgroundSize: "128px 128px",
      }} />

      <div className="relative h-full flex flex-col justify-between px-6 pt-4 pb-0">
        {/* Top row: now playing info + kiosk requests */}
        <div className="flex items-start gap-5">

          {/* Thumbnail */}
          <div className="flex-shrink-0 relative" style={{ width: 80, height: 80 }}>
            <img
              src={MOCK_NOW_PLAYING.thumbnail}
              alt=""
              className="w-full h-full rounded-xl object-cover"
              style={{ boxShadow: "0 8px 32px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.06)" }}
            />
            {/* Live pulse indicator */}
            <div className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-green-400 border-2 border-black flex items-center justify-center">
              <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-ping absolute" />
              <div className="w-1.5 h-1.5 rounded-full bg-green-300" />
            </div>
          </div>

          {/* Song info */}
          <div className="flex-1 min-w-0 pt-1">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-xs font-mono tracking-widest uppercase" style={{ color: "#f59e0b", fontSize: 10 }}>● NOW PLAYING</span>
              <span className="text-xs" style={{ color: "rgba(255,255,255,0.3)" }}>·</span>
              <span className="text-xs" style={{ color: "rgba(255,255,255,0.4)", fontFamily: "'JetBrains Mono', monospace", fontSize: 10 }}>
                {MOCK_NOW_PLAYING.playlist}
              </span>
            </div>
            <h2 className="font-bold truncate" style={{ fontFamily: "'Outfit', sans-serif", fontSize: 22, color: "#fff", letterSpacing: "-0.02em", lineHeight: 1.2 }}>
              {MOCK_NOW_PLAYING.title}
            </h2>
            <p className="truncate" style={{ color: "rgba(255,255,255,0.55)", fontFamily: "'Outfit', sans-serif", fontSize: 13, marginTop: 2 }}>
              {MOCK_NOW_PLAYING.artist}
            </p>
          </div>

          {/* Up Next — compact strip */}
          <div className="hidden lg:flex flex-col gap-1.5 flex-shrink-0" style={{ width: 260 }}>
            <span className="text-xs font-mono tracking-widest uppercase mb-0.5" style={{ color: "rgba(255,255,255,0.3)", fontSize: 10 }}>Up Next</span>
            {MOCK_UP_NEXT.slice(0, 2).map((t, i) => (
              <div key={t.id} className="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5" style={{ background: "rgba(255,255,255,0.06)", backdropFilter: "blur(4px)" }}>
                <span className="text-xs font-mono flex-shrink-0" style={{ color: "rgba(255,255,255,0.25)", width: 14 }}>{i + 1}</span>
                <img src={t.thumbnail} alt="" className="w-8 h-8 rounded-md object-cover flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate" style={{ color: "rgba(255,255,255,0.85)", fontFamily: "'Outfit', sans-serif" }}>{t.title}</p>
                  <p className="text-xs truncate" style={{ color: "rgba(255,255,255,0.35)", fontSize: 11 }}>{t.artist}</p>
                </div>
                <span className="text-xs flex-shrink-0" style={{ color: "rgba(255,255,255,0.3)", fontFamily: "'JetBrains Mono', monospace", fontSize: 11 }}>{t.duration}</span>
              </div>
            ))}
          </div>

          {/* Kiosk Requests badge */}
          {MOCK_KIOSK_REQUESTS.length > 0 && (
            <div className="flex-shrink-0 hidden xl:block" style={{ width: 220 }}>
              <div className="flex items-center gap-1.5 mb-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                <span className="text-xs font-mono tracking-widest uppercase" style={{ color: "#60a5fa", fontSize: 10 }}>
                  {MOCK_KIOSK_REQUESTS.length} Kiosk Request{MOCK_KIOSK_REQUESTS.length > 1 ? "s" : ""}
                </span>
              </div>
              {MOCK_KIOSK_REQUESTS.slice(0, 2).map((r) => (
                <div key={r.id} className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 mb-1" style={{ background: "rgba(59,130,246,0.1)", border: "1px solid rgba(59,130,246,0.2)" }}>
                  <img src={r.thumbnail} alt="" className="w-7 h-7 rounded object-cover flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate" style={{ color: "rgba(255,255,255,0.85)", fontFamily: "'Outfit', sans-serif" }}>{r.title}</p>
                    <p className="text-xs" style={{ color: "#60a5fa", fontSize: 10 }}>{r.requester}</p>
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    <button className="w-5 h-5 rounded flex items-center justify-center text-green-400 hover:bg-green-400/20 transition-colors">
                      <Icon name="check" size={11} />
                    </button>
                    <button className="w-5 h-5 rounded flex items-center justify-center text-red-400 hover:bg-red-400/20 transition-colors">
                      <Icon name="x" size={11} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Controls + progress */}
        <div className="pb-0">
          {/* Progress bar */}
          <div className="flex items-center gap-3 mb-3">
            <span className="text-xs font-mono flex-shrink-0" style={{ color: "rgba(255,255,255,0.35)", fontFamily: "'JetBrains Mono', monospace", fontSize: 11 }}>
              {fmt(progress)}
            </span>
            <div
              className="flex-1 h-1 rounded-full cursor-pointer group relative"
              style={{ background: "rgba(255,255,255,0.12)" }}
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const pct = (e.clientX - rect.left) / rect.width;
                setProgress(Math.round(pct * MOCK_NOW_PLAYING.duration));
              }}
            >
              <div
                className="h-full rounded-full relative"
                style={{
                  width: `${(progress / MOCK_NOW_PLAYING.duration) * 100}%`,
                  background: "linear-gradient(90deg, #f59e0b, #fbbf24)",
                  transition: "width 0.3s linear",
                }}
              >
                <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-white opacity-0 group-hover:opacity-100 transition-opacity" style={{ transform: "translate(50%,-50%)", boxShadow: "0 0 8px rgba(245,158,11,0.8)" }} />
              </div>
            </div>
            <span className="text-xs font-mono flex-shrink-0" style={{ color: "rgba(255,255,255,0.35)", fontFamily: "'JetBrains Mono', monospace", fontSize: 11 }}>
              {fmt(MOCK_NOW_PLAYING.duration)}
            </span>
          </div>

          {/* Playback controls */}
          <div className="flex items-center gap-2 pb-4">
            <button className="w-8 h-8 rounded-lg flex items-center justify-center transition-all hover:bg-white/10" style={{ color: "rgba(255,255,255,0.5)" }}>
              <Icon name="prev" size={16} />
            </button>
            <button
              onClick={() => setPlaying(!playing)}
              className="w-10 h-10 rounded-full flex items-center justify-center transition-all hover:scale-105 active:scale-95 flex-shrink-0"
              style={{ background: "linear-gradient(135deg, #f59e0b, #d97706)", color: "#000", boxShadow: "0 4px 20px rgba(245,158,11,0.4)" }}
            >
              <Icon name={playing ? "pause" : "play"} size={18} />
            </button>
            <button className="w-8 h-8 rounded-lg flex items-center justify-center transition-all hover:bg-white/10" style={{ color: "rgba(255,255,255,0.5)" }}>
              <Icon name="skip" size={16} />
            </button>

            <div className="w-px h-5 mx-2" style={{ background: "rgba(255,255,255,0.1)" }} />

            {/* Volume */}
            <div className="flex items-center gap-2">
              <button onClick={() => setShowVol(!showVol)} className="w-7 h-7 flex items-center justify-center" style={{ color: "rgba(255,255,255,0.4)" }}>
                <Icon name="vol" size={15} />
              </button>
              <div className="h-0.5 rounded-full cursor-pointer relative group" style={{ width: 72, background: "rgba(255,255,255,0.15)" }}
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  setVolume(Math.round(((e.clientX - rect.left) / rect.width) * 100));
                }}>
                <div className="h-full rounded-full" style={{ width: `${volume}%`, background: "rgba(255,255,255,0.7)", transition: "width 0.1s" }} />
              </div>
              <span className="text-xs font-mono" style={{ color: "rgba(255,255,255,0.3)", fontFamily: "'JetBrains Mono', monospace", fontSize: 10, width: 24 }}>{volume}</span>
            </div>

            <div className="flex-1" />

            {/* Status pills */}
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full" style={{ background: "rgba(34,197,94,0.15)", border: "1px solid rgba(34,197,94,0.25)" }}>
                <div className="w-1.5 h-1.5 rounded-full bg-green-400" />
                <span className="text-xs font-mono" style={{ color: "#4ade80", fontSize: 10, fontFamily: "'JetBrains Mono', monospace" }}>PLAYER ONLINE</span>
              </div>
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full" style={{ background: "rgba(59,130,246,0.15)", border: "1px solid rgba(59,130,246,0.25)" }}>
                <Icon name="coin" size={11} className="text-blue-400" />
                <span className="text-xs font-mono" style={{ color: "#60a5fa", fontSize: 10, fontFamily: "'JetBrains Mono', monospace" }}>2 REQUESTS</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom edge fade */}
      <div className="absolute bottom-0 left-0 right-0 h-px" style={{ background: "linear-gradient(90deg, transparent, rgba(245,158,11,0.3), transparent)" }} />
    </div>
  );
};

/* ─── Sidebar ────────────────────────────────────────────────────────────── */
const NAV_ITEMS = [
  {
    id: "queue", label: "Queue", icon: "queue",
    children: [
      { id: "queue-now", label: "Now Playing" },
      { id: "queue-next", label: "Up Next" },
      { id: "queue-priority", label: "Priority Requests", badge: 2 },
    ],
  },
  {
    id: "playlists", label: "Playlists", icon: "playlist",
    children: [
      { id: "playlists-all", label: "All Playlists" },
      { id: "playlists-import", label: "Import Playlist" },
    ],
  },
  {
    id: "settings", label: "Settings", icon: "settings",
    children: [
      { id: "settings-playback", label: "Playback" },
      { id: "settings-kiosk", label: "Kiosk" },
      { id: "settings-branding", label: "Branding" },
      { id: "settings-scripts", label: "Functions & Scripts" },
    ],
  },
  { id: "logs", label: "Logs", icon: "logs", children: [] },
];

const Sidebar = ({ activeView, setActiveView, expanded, setExpanded }) => {
  const [openGroup, setOpenGroup] = useState("queue");

  const handleNav = (item) => {
    if (item.children && item.children.length > 0) {
      setOpenGroup(openGroup === item.id ? null : item.id);
      setActiveView(item.children[0].id);
    } else {
      setActiveView(item.id);
      setOpenGroup(null);
    }
  };

  const isGroupActive = (item) =>
    item.children?.some((c) => c.id === activeView) || activeView === item.id;

  return (
    <aside
      className="flex flex-col flex-shrink-0 h-full overflow-hidden transition-all duration-300"
      style={{
        width: expanded ? 220 : 60,
        background: "#0a0a0a",
        borderRight: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      {/* Wordmark */}
      <div className="flex items-center gap-3 px-3.5 py-4 flex-shrink-0" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)", height: 56 }}>
        <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "linear-gradient(135deg, #f59e0b, #d97706)", boxShadow: "0 0 16px rgba(245,158,11,0.4)" }}>
          <span style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 800, fontSize: 14, color: "#000" }}>O</span>
        </div>
        {expanded && (
          <div className="overflow-hidden">
            <p style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, fontSize: 15, color: "#fff", letterSpacing: "-0.02em", lineHeight: 1.1, whiteSpace: "nowrap" }}>Obie</p>
            <p style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: "rgba(255,255,255,0.3)", letterSpacing: "0.1em", whiteSpace: "nowrap" }}>ADMIN CONSOLE</p>
          </div>
        )}
        {expanded && (
          <button
            className="ml-auto w-6 h-6 flex items-center justify-center rounded flex-shrink-0 hover:bg-white/10 transition-colors"
            style={{ color: "rgba(255,255,255,0.3)" }}
            onClick={() => setExpanded(false)}
          >
            <Icon name="chevron" size={14} className="rotate-180" />
          </button>
        )}
      </div>

      {/* Nav items */}
      <nav className="flex-1 py-3 overflow-y-auto overflow-x-hidden">
        {NAV_ITEMS.map((item) => {
          const active = isGroupActive(item);
          const open = openGroup === item.id;
          return (
            <div key={item.id}>
              <button
                onClick={() => handleNav(item)}
                className="w-full flex items-center gap-3 transition-all duration-150 group relative"
                style={{
                  padding: expanded ? "9px 14px" : "9px 0",
                  justifyContent: expanded ? "flex-start" : "center",
                  color: active ? "#f59e0b" : "rgba(255,255,255,0.45)",
                  background: active && !expanded ? "rgba(245,158,11,0.08)" : "transparent",
                }}
              >
                {active && (
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-r-full" style={{ background: "#f59e0b" }} />
                )}
                <div className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-all"
                  style={{ background: active ? "rgba(245,158,11,0.15)" : "transparent", color: active ? "#f59e0b" : "inherit" }}>
                  <Icon name={item.icon} size={17} />
                </div>
                {expanded && (
                  <>
                    <span className="flex-1 text-left text-sm font-medium whitespace-nowrap" style={{ fontFamily: "'Outfit', sans-serif" }}>
                      {item.label}
                    </span>
                    {item.children?.length > 0 && (
                      <Icon name="chevron" size={13} className={`transition-transform duration-200 flex-shrink-0 ${open ? "rotate-90" : ""}`} />
                    )}
                  </>
                )}
                {!expanded && item.children?.some(c => c.badge) && (
                  <div className="absolute top-1 right-1 w-4 h-4 rounded-full bg-blue-500 flex items-center justify-center">
                    <span style={{ fontSize: 9, color: "#fff", fontFamily: "'JetBrains Mono', monospace" }}>
                      {item.children.reduce((a, c) => a + (c.badge || 0), 0)}
                    </span>
                  </div>
                )}
              </button>

              {/* Submenu */}
              {expanded && open && item.children?.length > 0 && (
                <div style={{ background: "rgba(255,255,255,0.02)", borderLeft: "1px solid rgba(255,255,255,0.06)", marginLeft: 22 }}>
                  {item.children.map((child) => (
                    <button
                      key={child.id}
                      onClick={() => setActiveView(child.id)}
                      className="w-full flex items-center gap-2 px-4 py-2 text-left transition-colors"
                      style={{ color: activeView === child.id ? "#f59e0b" : "rgba(255,255,255,0.4)" }}
                    >
                      <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: activeView === child.id ? "#f59e0b" : "rgba(255,255,255,0.15)" }} />
                      <span className="text-sm flex-1 whitespace-nowrap" style={{ fontFamily: "'Outfit', sans-serif", fontSize: 13 }}>
                        {child.label}
                      </span>
                      {child.badge && (
                        <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ background: "rgba(59,130,246,0.25)", color: "#60a5fa", fontFamily: "'JetBrains Mono', monospace", fontSize: 10 }}>
                          {child.badge}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Expand toggle (when collapsed) */}
      {!expanded && (
        <button
          className="flex items-center justify-center py-3 flex-shrink-0 hover:bg-white/5 transition-colors"
          style={{ color: "rgba(255,255,255,0.3)", borderTop: "1px solid rgba(255,255,255,0.05)" }}
          onClick={() => setExpanded(true)}
        >
          <Icon name="chevron" size={15} />
        </button>
      )}
    </aside>
  );
};

/* ─── Queue View ─────────────────────────────────────────────────────────── */
const QueueView = ({ subView }) => {
  const [queue, setQueue] = useState(MOCK_QUEUE);
  const showPriority = subView === "queue-priority";
  const showNow = subView === "queue-now";
  const items = showPriority ? MOCK_KIOSK_REQUESTS : queue;

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 flex-shrink-0" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <div>
          <h1 className="font-bold" style={{ fontFamily: "'Outfit', sans-serif", fontSize: 20, color: "#fff", letterSpacing: "-0.02em" }}>
            {showPriority ? "Priority Requests" : showNow ? "Now Playing" : "Up Next Queue"}
          </h1>
          <p className="text-sm mt-0.5" style={{ color: "rgba(255,255,255,0.35)", fontFamily: "'JetBrains Mono', monospace", fontSize: 11 }}>
            {showPriority ? `${MOCK_KIOSK_REQUESTS.length} kiosk requests` : `${queue.length} songs`}
          </p>
        </div>
        <div className="flex gap-2">
          {!showPriority && (
            <button className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all hover:opacity-90"
              style={{ background: "rgba(245,158,11,0.15)", color: "#f59e0b", border: "1px solid rgba(245,158,11,0.25)", fontFamily: "'Outfit', sans-serif" }}>
              <Icon name="add" size={15} />
              Add Song
            </button>
          )}
          <button className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all hover:bg-white/10"
            style={{ color: "rgba(255,255,255,0.5)", border: "1px solid rgba(255,255,255,0.1)", fontFamily: "'Outfit', sans-serif" }}>
            <Icon name="trash" size={15} />
            Clear
          </button>
        </div>
      </div>

      {/* Now playing highlight */}
      {showNow && (
        <div className="mx-6 mt-4 mb-2 rounded-xl p-4 flex items-center gap-4 flex-shrink-0" style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)" }}>
          <img src={MOCK_NOW_PLAYING.thumbnail} alt="" className="w-14 h-14 rounded-xl object-cover flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="font-semibold truncate" style={{ color: "#fff", fontFamily: "'Outfit', sans-serif" }}>{MOCK_NOW_PLAYING.title}</p>
            <p className="text-sm truncate" style={{ color: "rgba(255,255,255,0.5)" }}>{MOCK_NOW_PLAYING.artist}</p>
            <div className="flex items-center gap-2 mt-1">
              <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              <span className="text-xs" style={{ color: "#4ade80", fontFamily: "'JetBrains Mono', monospace", fontSize: 10 }}>PLAYING · {fmt(MOCK_NOW_PLAYING.progress)} / {fmt(MOCK_NOW_PLAYING.duration)}</span>
            </div>
          </div>
        </div>
      )}

      {/* Queue list */}
      <div className="flex-1 overflow-y-auto px-6 py-3">
        {(showPriority ? MOCK_KIOSK_REQUESTS : showNow ? MOCK_UP_NEXT : queue).map((item, idx) => (
          <div
            key={item.id}
            className="flex items-center gap-3 rounded-xl px-3 py-2.5 mb-1 group transition-all hover:bg-white/5 cursor-pointer"
          >
            {!showPriority && (
              <div className="w-6 text-center flex-shrink-0 group-hover:hidden">
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "rgba(255,255,255,0.25)" }}>{idx + 1}</span>
              </div>
            )}
            {!showPriority && (
              <div className="w-6 text-center flex-shrink-0 hidden group-hover:flex items-center justify-center" style={{ color: "rgba(255,255,255,0.3)" }}>
                <Icon name="drag" size={13} />
              </div>
            )}
            {item.thumbnail && (
              <img src={item.thumbnail} alt="" className="w-9 h-9 rounded-lg object-cover flex-shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate" style={{ color: "#fff", fontFamily: "'Outfit', sans-serif" }}>{item.title}</p>
              <p className="text-xs truncate" style={{ color: "rgba(255,255,255,0.4)" }}>{item.artist}</p>
            </div>
            {showPriority && (
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "rgba(59,130,246,0.2)", color: "#60a5fa", fontFamily: "'JetBrains Mono', monospace", fontSize: 10 }}>
                  {item.requester}
                </span>
                <button className="w-7 h-7 rounded-lg flex items-center justify-center text-green-400 hover:bg-green-400/15 transition-colors"><Icon name="check" size={13} /></button>
                <button className="w-7 h-7 rounded-lg flex items-center justify-center text-red-400 hover:bg-red-400/15 transition-colors"><Icon name="x" size={13} /></button>
              </div>
            )}
            {!showPriority && (
              <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "rgba(255,255,255,0.3)" }}>{item.duration}</span>
                <button className="w-7 h-7 rounded-lg flex items-center justify-center text-red-400 hover:bg-red-400/15 transition-colors"><Icon name="trash" size={13} /></button>
              </div>
            )}
            {!showPriority && (
              <span className="group-hover:hidden" style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "rgba(255,255,255,0.3)", flexShrink: 0 }}>{item.duration}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

/* ─── Playlists View ─────────────────────────────────────────────────────── */
const PlaylistsView = ({ subView }) => {
  const [playlists, setPlaylists] = useState(MOCK_PLAYLISTS);

  if (subView === "playlists-import") {
    return (
      <div className="h-full flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 flex-shrink-0" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <div>
            <h1 className="font-bold" style={{ fontFamily: "'Outfit', sans-serif", fontSize: 20, color: "#fff", letterSpacing: "-0.02em" }}>Import Playlist</h1>
            <p className="text-sm mt-0.5" style={{ color: "rgba(255,255,255,0.35)", fontFamily: "'JetBrains Mono', monospace", fontSize: 11 }}>Import from YouTube by Playlist ID</p>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-6 max-w-lg">
          <div className="rounded-2xl p-6" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>
            <label className="block text-sm font-medium mb-2" style={{ color: "rgba(255,255,255,0.7)", fontFamily: "'Outfit', sans-serif" }}>YouTube Playlist ID</label>
            <input className="w-full px-4 py-3 rounded-xl text-sm font-mono outline-none transition-all" style={{ background: "#111", border: "1px solid rgba(255,255,255,0.12)", color: "#fff", fontFamily: "'JetBrains Mono', monospace" }}
              placeholder="PLN9QqCogPsXJCgeL_iEgYnW6Rl_8nIUUH" />
            <p className="text-xs mt-2" style={{ color: "rgba(255,255,255,0.3)" }}>Find in the playlist URL after <code style={{ color: "#f59e0b" }}>?list=</code></p>
            <button className="mt-4 w-full py-3 rounded-xl font-semibold text-sm transition-all hover:opacity-90"
              style={{ background: "linear-gradient(135deg, #f59e0b, #d97706)", color: "#000", fontFamily: "'Outfit', sans-serif" }}>
              Import Playlist
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-6 py-4 flex-shrink-0" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <div>
          <h1 className="font-bold" style={{ fontFamily: "'Outfit', sans-serif", fontSize: 20, color: "#fff", letterSpacing: "-0.02em" }}>Playlists</h1>
          <p className="text-sm mt-0.5" style={{ color: "rgba(255,255,255,0.35)", fontFamily: "'JetBrains Mono', monospace", fontSize: 11 }}>
            {playlists.length} playlists · {playlists.reduce((a, p) => a + p.songs, 0).toLocaleString()} total songs
          </p>
        </div>
        <button className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all hover:opacity-90"
          style={{ background: "rgba(245,158,11,0.15)", color: "#f59e0b", border: "1px solid rgba(245,158,11,0.25)", fontFamily: "'Outfit', sans-serif" }}>
          <Icon name="add" size={15} />
          New Playlist
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div className="grid gap-2">
          {playlists.map((pl, i) => (
            <div key={pl.id} className="flex items-center gap-4 rounded-xl px-4 py-3 group transition-all cursor-pointer"
              style={{ background: pl.active ? "rgba(245,158,11,0.07)" : "rgba(255,255,255,0.02)", border: `1px solid ${pl.active ? "rgba(245,158,11,0.2)" : "rgba(255,255,255,0.05)"}` }}>
              <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: pl.active ? "rgba(245,158,11,0.2)" : "rgba(255,255,255,0.07)" }}>
                <Icon name="playlist" size={18} className={pl.active ? "text-amber-400" : ""} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-sm truncate" style={{ color: "#fff", fontFamily: "'Outfit', sans-serif" }}>{pl.name}</p>
                  {pl.active && (
                    <span className="text-xs px-2 py-0.5 rounded-full flex-shrink-0" style={{ background: "rgba(34,197,94,0.2)", color: "#4ade80", fontFamily: "'JetBrains Mono', monospace", fontSize: 9 }}>ACTIVE</span>
                  )}
                </div>
                <p className="text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>
                  {pl.songs.toLocaleString()} songs · Last played {pl.lastPlayed}
                </p>
              </div>
              <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                {!pl.active && (
                  <button className="text-xs px-3 py-1.5 rounded-lg transition-all hover:opacity-80"
                    style={{ background: "rgba(245,158,11,0.15)", color: "#f59e0b", fontFamily: "'Outfit', sans-serif" }}
                    onClick={() => setPlaylists(playlists.map(p => ({ ...p, active: p.id === pl.id })))}>
                    Set Active
                  </button>
                )}
                <button className="text-xs px-3 py-1.5 rounded-lg transition-all hover:opacity-80"
                  style={{ background: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.5)", fontFamily: "'Outfit', sans-serif" }}>
                  Load Queue
                </button>
                <button className="w-7 h-7 rounded-lg flex items-center justify-center text-red-400 hover:bg-red-400/15 transition-colors">
                  <Icon name="trash" size={13} />
                </button>
              </div>
              <div className="w-8 text-center flex-shrink-0" style={{ color: "rgba(255,255,255,0.2)", fontFamily: "'JetBrains Mono', monospace", fontSize: 11 }}>{i + 1}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

/* ─── Settings View ──────────────────────────────────────────────────────── */
const SettingsView = ({ subView, setActiveView }) => {
  const [settings, setSettings] = useState({ loop: false, shuffle: true, volume: 75, freeplay: false, coinPerSong: 1, searchEnabled: true, maxQueue: 50, priorityLimit: 10 });
  const [branding, setBranding] = useState({ name: "Obie Jukebox", logo: "", theme: "dark" });
  const [scriptInput, setScriptInput] = useState({});
  const [scriptState, setScriptState] = useState({});
  const [saved, setSaved] = useState(false);
  const [showGuide, setShowGuide] = useState(false);

  const set = (k) => (v) => setSettings(s => ({ ...s, [k]: v }));

  const Toggle = ({ label, desc, val, onToggle }) => (
    <div className="flex items-center justify-between py-3.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
      <div>
        <p className="text-sm font-medium" style={{ color: "#e5e5e5", fontFamily: "'Outfit', sans-serif" }}>{label}</p>
        {desc && <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.3)", fontFamily: "'JetBrains Mono', monospace", fontSize: 10 }}>{desc}</p>}
      </div>
      <button onClick={onToggle} className="relative flex-shrink-0" style={{ width: 44, height: 24, borderRadius: 999, background: val ? "#f59e0b" : "rgba(255,255,255,0.12)", transition: "background 0.2s" }}>
        <span style={{ position: "absolute", top: 3, left: val ? 23 : 3, width: 18, height: 18, borderRadius: "50%", background: "#fff", transition: "left 0.2s", boxShadow: "0 1px 4px rgba(0,0,0,0.4)" }} />
      </button>
    </div>
  );

  const runScript = (script) => {
    if (script.requiresInput && !scriptInput[script.id]?.trim()) return;
    setScriptState(s => ({ ...s, [script.id]: "running" }));
    const messages = ["Connecting…", "Authenticating…", `Running ${script.name}…`, "Processing…", "✓ Completed successfully."];
    let i = 0, log = `$ ${script.name}${script.requiresInput ? " " + scriptInput[script.id] : ""}\n`;
    const iv = setInterval(() => {
      if (i < messages.length) { log += messages[i++] + "\n"; setScriptState(s => ({ ...s, [`${script.id}_log`]: log })); }
      else { clearInterval(iv); setScriptState(s => ({ ...s, [script.id]: "done" })); }
    }, 500);
  };

  if (subView === "settings-scripts") {
    return (
      <div className="h-full flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 flex-shrink-0" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <div>
            <h1 className="font-bold" style={{ fontFamily: "'Outfit', sans-serif", fontSize: 20, color: "#fff", letterSpacing: "-0.02em" }}>Functions & Scripts</h1>
            <p className="text-sm mt-0.5" style={{ color: "rgba(255,255,255,0.35)", fontFamily: "'JetBrains Mono', monospace", fontSize: 11 }}>Run server-side operations from the console</p>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-3">
          {SCRIPTS.map(script => {
            const state = scriptState[script.id];
            const log = scriptState[`${script.id}_log`];
            return (
              <div key={script.id} className="rounded-2xl overflow-hidden" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)" }}>
                <div className="flex items-start gap-4 p-5">
                  <span className="text-2xl flex-shrink-0 mt-0.5">{script.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <code className="text-sm" style={{ color: "#e5e5e5", fontFamily: "'JetBrains Mono', monospace" }}>{script.name}</code>
                      <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "rgba(245,158,11,0.12)", color: "#f59e0b", fontSize: 10 }}>{script.category}</span>
                    </div>
                    <p className="text-sm" style={{ color: "rgba(255,255,255,0.45)", fontFamily: "'Outfit', sans-serif" }}>{script.desc}</p>
                    {script.requiresInput && state !== "done" && (
                      <input
                        value={scriptInput[script.id] || ""}
                        onChange={e => setScriptInput(s => ({ ...s, [script.id]: e.target.value }))}
                        placeholder={script.inputPlaceholder}
                        className="mt-3 w-full px-3 py-2 rounded-xl text-sm outline-none"
                        style={{ background: "#111", border: "1px solid rgba(255,255,255,0.1)", color: "#fff", fontFamily: "'JetBrains Mono', monospace" }}
                      />
                    )}
                  </div>
                  <div className="flex-shrink-0">
                    {state !== "running" && state !== "done" && (
                      <button
                        onClick={() => runScript(script)}
                        disabled={script.requiresInput && !scriptInput[script.id]?.trim()}
                        className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all hover:opacity-90 disabled:opacity-40"
                        style={{ background: "linear-gradient(135deg, #f59e0b, #d97706)", color: "#000", fontFamily: "'Outfit', sans-serif" }}>
                        <Icon name="terminal" size={14} />
                        Run
                      </button>
                    )}
                    {state === "done" && (
                      <button onClick={() => setScriptState(s => ({ ...s, [script.id]: null, [`${script.id}_log`]: null }))}
                        className="px-4 py-2 rounded-xl text-sm transition-all hover:bg-white/10"
                        style={{ color: "rgba(255,255,255,0.5)", border: "1px solid rgba(255,255,255,0.1)", fontFamily: "'Outfit', sans-serif" }}>Reset</button>
                    )}
                  </div>
                </div>
                {log && (
                  <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                    <div className="flex items-center gap-2 px-5 py-2" style={{ background: "rgba(0,0,0,0.4)" }}>
                      <div className={`w-2 h-2 rounded-full ${state === "running" ? "bg-amber-400 animate-pulse" : "bg-green-400"}`} />
                      <span className="text-xs" style={{ color: "rgba(255,255,255,0.4)", fontFamily: "'JetBrains Mono', monospace", fontSize: 10 }}>
                        {state === "running" ? "RUNNING" : "COMPLETED"}
                      </span>
                    </div>
                    <pre className="px-5 py-3 text-xs overflow-x-auto" style={{ fontFamily: "'JetBrains Mono', monospace", color: "#4ade80", background: "rgba(0,0,0,0.6)", maxHeight: 120 }}>{log}</pre>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // Settings forms
  const sections = {
    "settings-playback": (
      <div>
        <Toggle label="Loop Playlist" desc="Restart when queue ends" val={settings.loop} onToggle={() => set("loop")(!settings.loop)} />
        <Toggle label="Shuffle" desc="Randomise queue order on load" val={settings.shuffle} onToggle={() => set("shuffle")(!settings.shuffle)} />
        <div className="py-3.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-sm font-medium" style={{ color: "#e5e5e5", fontFamily: "'Outfit', sans-serif" }}>Default Volume</p>
              <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.3)", fontFamily: "'JetBrains Mono', monospace", fontSize: 10 }}>0–100</p>
            </div>
            <span className="text-sm font-mono" style={{ color: "#f59e0b", fontFamily: "'JetBrains Mono', monospace" }}>{settings.volume}</span>
          </div>
          <input type="range" min="0" max="100" value={settings.volume} onChange={e => set("volume")(+e.target.value)}
            className="w-full" style={{ accentColor: "#f59e0b", height: 4 }} />
        </div>
      </div>
    ),
    "settings-kiosk": (
      <div>
        <Toggle label="Free Play Mode" desc="Allow requests without credits" val={settings.freeplay} onToggle={() => set("freeplay")(!settings.freeplay)} />
        <Toggle label="Search Enabled" desc="Allow kiosk song search" val={settings.searchEnabled} onToggle={() => set("searchEnabled")(!settings.searchEnabled)} />
        {[
          { label: "Credits per Song", key: "coinPerSong", desc: "credits required per request" },
          { label: "Max Queue Size", key: "maxQueue", desc: "songs in normal queue" },
          { label: "Priority Queue Limit", key: "priorityLimit", desc: "max kiosk request slots" },
        ].map(({ label, key, desc }) => (
          <div key={key} className="flex items-center justify-between py-3.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
            <div>
              <p className="text-sm font-medium" style={{ color: "#e5e5e5", fontFamily: "'Outfit', sans-serif" }}>{label}</p>
              <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.3)", fontFamily: "'JetBrains Mono', monospace", fontSize: 10 }}>{desc}</p>
            </div>
            <input type="number" min="1" value={settings[key]} onChange={e => set(key)(+e.target.value)}
              className="w-20 text-center px-3 py-2 rounded-xl text-sm outline-none"
              style={{ background: "#111", border: "1px solid rgba(255,255,255,0.1)", color: "#fff", fontFamily: "'JetBrains Mono', monospace" }} />
          </div>
        ))}
      </div>
    ),
    "settings-branding": (
      <div className="space-y-4">
        {[
          { label: "Jukebox Name", key: "name", placeholder: "My Jukebox" },
          { label: "Logo URL", key: "logo", placeholder: "https://example.com/logo.png" },
        ].map(({ label, key, placeholder }) => (
          <div key={key}>
            <label className="block text-sm font-medium mb-2" style={{ color: "rgba(255,255,255,0.6)", fontFamily: "'Outfit', sans-serif" }}>{label}</label>
            <input value={branding[key]} onChange={e => setBranding(b => ({ ...b, [key]: e.target.value }))} placeholder={placeholder}
              className="w-full px-4 py-3 rounded-xl text-sm outline-none"
              style={{ background: "#111", border: "1px solid rgba(255,255,255,0.1)", color: "#fff", fontFamily: key === "logo" ? "'JetBrains Mono', monospace" : "'Outfit', sans-serif" }} />
          </div>
        ))}
        <div>
          <label className="block text-sm font-medium mb-2" style={{ color: "rgba(255,255,255,0.6)", fontFamily: "'Outfit', sans-serif" }}>Theme</label>
          <div className="flex gap-3">
            {["dark", "light"].map(t => (
              <button key={t} onClick={() => setBranding(b => ({ ...b, theme: t }))}
                className="flex-1 py-3 rounded-xl text-sm font-medium capitalize transition-all"
                style={{ background: branding.theme === t ? "rgba(245,158,11,0.15)" : "rgba(255,255,255,0.04)", border: `1px solid ${branding.theme === t ? "rgba(245,158,11,0.4)" : "rgba(255,255,255,0.08)"}`, color: branding.theme === t ? "#f59e0b" : "rgba(255,255,255,0.4)", fontFamily: "'Outfit', sans-serif" }}>
                {t === "dark" ? "🌙" : "☀️"} {t}
              </button>
            ))}
          </div>
        </div>
      </div>
    ),
  };

  const subTitles = { "settings-playback": "Playback", "settings-kiosk": "Kiosk", "settings-branding": "Branding" };

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-6 py-4 flex-shrink-0" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <div>
          <h1 className="font-bold" style={{ fontFamily: "'Outfit', sans-serif", fontSize: 20, color: "#fff", letterSpacing: "-0.02em" }}>
            Settings {subTitles[subView] ? `· ${subTitles[subView]}` : ""}
          </h1>
        </div>
        <button
          onClick={() => setShowGuide(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all hover:opacity-90"
          style={{ background: "rgba(245,158,11,0.1)", color: "#f59e0b", border: "1px solid rgba(245,158,11,0.2)", fontFamily: "'Outfit', sans-serif" }}>
          <Icon name="book" size={15} />
          User Guide
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="max-w-lg">
          {sections[subView] || sections["settings-playback"]}
          <button
            onClick={() => { setSaved(true); setTimeout(() => setSaved(false), 2500); }}
            className="mt-6 w-full py-3 rounded-xl font-semibold text-sm transition-all hover:opacity-90"
            style={{ background: saved ? "rgba(34,197,94,0.2)" : "linear-gradient(135deg, #f59e0b, #d97706)", color: saved ? "#4ade80" : "#000", border: saved ? "1px solid rgba(34,197,94,0.4)" : "none", fontFamily: "'Outfit', sans-serif" }}>
            {saved ? "✓ Saved" : "Save Settings"}
          </button>
        </div>
      </div>
    </div>
  );
};

/* ─── Logs View ──────────────────────────────────────────────────────────── */
const LogsView = () => {
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");

  const levelStyles = {
    info: { color: "#60a5fa", bg: "rgba(59,130,246,0.1)", border: "rgba(59,130,246,0.2)" },
    warning: { color: "#fbbf24", bg: "rgba(251,191,36,0.1)", border: "rgba(251,191,36,0.2)" },
    error: { color: "#f87171", bg: "rgba(248,113,113,0.1)", border: "rgba(248,113,113,0.2)" },
  };

  const filtered = MOCK_LOGS.filter(l => {
    if (filter !== "all" && l.level !== filter) return false;
    if (search && !l.message.toLowerCase().includes(search.toLowerCase()) && !l.source.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-6 py-4 flex-shrink-0" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <div>
          <h1 className="font-bold" style={{ fontFamily: "'Outfit', sans-serif", fontSize: 20, color: "#fff", letterSpacing: "-0.02em" }}>System Logs</h1>
          <p className="text-sm mt-0.5" style={{ color: "rgba(255,255,255,0.35)", fontFamily: "'JetBrains Mono', monospace", fontSize: 11 }}>Real-time event stream</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 px-3 py-1.5 rounded-xl" style={{ background: "#111", border: "1px solid rgba(255,255,255,0.08)" }}>
            <Icon name="search" size={13} className="flex-shrink-0" style={{ color: "rgba(255,255,255,0.3)" }} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search logs…"
              className="text-sm outline-none bg-transparent ml-1.5" style={{ color: "#fff", fontFamily: "'JetBrains Mono', monospace", fontSize: 12, width: 160 }} />
          </div>
          {["all", "info", "warning", "error"].map(lv => (
            <button key={lv} onClick={() => setFilter(lv)}
              className="px-3 py-1.5 rounded-xl text-xs font-medium capitalize transition-all"
              style={{
                background: filter === lv ? (lv === "all" ? "rgba(245,158,11,0.15)" : levelStyles[lv]?.bg || "rgba(245,158,11,0.15)") : "rgba(255,255,255,0.04)",
                color: filter === lv ? (lv === "all" ? "#f59e0b" : levelStyles[lv]?.color || "#f59e0b") : "rgba(255,255,255,0.35)",
                border: `1px solid ${filter === lv ? (lv === "all" ? "rgba(245,158,11,0.3)" : levelStyles[lv]?.border || "rgba(245,158,11,0.3)") : "rgba(255,255,255,0.06)"}`,
                fontFamily: "'JetBrains Mono', monospace",
              }}>
              {lv}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-3 space-y-1.5" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
        {filtered.map(log => {
          const s = levelStyles[log.level];
          return (
            <div key={log.id} className="flex items-start gap-3 rounded-xl px-4 py-3" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
              <span className="flex-shrink-0 text-xs" style={{ color: "rgba(255,255,255,0.25)", width: 60 }}>{log.time}</span>
              <span className="flex-shrink-0 text-xs px-2 py-0.5 rounded" style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}`, fontSize: 9, lineHeight: "16px" }}>
                {log.level.toUpperCase()}
              </span>
              <span className="text-xs flex-shrink-0" style={{ color: "#f59e0b", width: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{log.source}</span>
              <span className="text-xs flex-1" style={{ color: "rgba(255,255,255,0.6)", wordBreak: "break-word" }}>{log.message}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

/* ─── Root App ───────────────────────────────────────────────────────────── */
export default function ObieAdminConsole() {
  const [activeView, setActiveView] = useState("queue-next");
  const [sidebarExpanded, setSidebarExpanded] = useState(true);
  const [playing, setPlaying] = useState(true);
  const [volume, setVolume] = useState(72);
  const [progress, setProgress] = useState(94);

  // Tick progress
  useEffect(() => {
    if (!playing) return;
    const iv = setInterval(() => setProgress(p => p < MOCK_NOW_PLAYING.duration ? p + 1 : 0), 1000);
    return () => clearInterval(iv);
  }, [playing]);

  const renderMain = () => {
    if (activeView.startsWith("queue")) return <QueueView subView={activeView} />;
    if (activeView.startsWith("playlists")) return <PlaylistsView subView={activeView} />;
    if (activeView.startsWith("settings")) return <SettingsView subView={activeView} setActiveView={setActiveView} />;
    if (activeView === "logs") return <LogsView />;
    return null;
  };

  return (
    <>
      <FontInjector />
      <style>{`
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 999px; }
        ::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.2); }
        input[type=range] { -webkit-appearance: none; appearance: none; background: transparent; }
        input[type=range]::-webkit-slider-runnable-track { height: 3px; border-radius: 999px; background: rgba(255,255,255,0.15); }
        input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 14px; height: 14px; border-radius: 50%; background: #f59e0b; margin-top: -5.5px; box-shadow: 0 0 8px rgba(245,158,11,0.5); }
        @keyframes spin { to { transform: rotate(360deg); } }
        .animate-ping { animation: ping 1.5s cubic-bezier(0,0,0.2,1) infinite; }
        @keyframes ping { 75%,100% { transform: scale(2); opacity: 0; } }
        .animate-pulse { animation: pulse 2s ease-in-out infinite; }
        @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
      `}</style>

      <div style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100vh",
        background: "#050505",
        color: "#fff",
        fontFamily: "'Outfit', sans-serif",
        overflow: "hidden",
      }}>
        {/* ── Now Playing Stage (top 33vh) ── */}
        <NowPlayingStage
          playing={playing}
          setPlaying={setPlaying}
          volume={volume}
          setVolume={setVolume}
          progress={progress}
          setProgress={setProgress}
        />

        {/* ── Bottom: Sidebar + Content ── */}
        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
          <Sidebar
            activeView={activeView}
            setActiveView={setActiveView}
            expanded={sidebarExpanded}
            setExpanded={setSidebarExpanded}
          />
          <main style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
            {renderMain()}
          </main>
        </div>
      </div>
    </>
  );
}
