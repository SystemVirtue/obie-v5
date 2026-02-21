import { useState, useEffect } from "react";
import { useAdminPrefs } from './hooks/useAdminPrefs';

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

/* ─── Now Playing Stage ──────────────────────────────────────────────────── */
const NowPlayingStage = ({ playing, setPlaying, volume, setVolume, progress, setProgress }: {
  playing: boolean;
  setPlaying: (playing: boolean) => void;
  volume: number;
  setVolume: (volume: number) => void;
  progress: number;
  setProgress: (progress: number) => void;
}) => {
  return (
    <div className="relative overflow-hidden flex-shrink-0" style={{ height: "33vh", minHeight: 240, background: "#050505" }}>
      {/* Atmospheric blurred art backdrop */}
      <div className="absolute inset-0" style={{ overflow: "hidden" }}>
        <img
          src="https://i.ytimg.com/vi/4UDNndFX94Y/mqdefault.jpg"
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
        {/* Top row: now playing info */}
        <div className="flex items-start gap-5">
          {/* Thumbnail */}
          <div className="flex-shrink-0 relative" style={{ width: 80, height: 80 }}>
            <img
              src="https://i.ytimg.com/vi/4UDNndFX94Y/mqdefault.jpg"
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
            </div>
            <h2 className="font-bold truncate" style={{ fontFamily: "'Outfit', sans-serif", fontSize: 22, color: "#fff", letterSpacing: "-0.02em", lineHeight: 1.2 }}>
              Sonnentanz (Sun Don't Shine)
            </h2>
            <p className="truncate" style={{ color: "rgba(255,255,255,0.55)", fontFamily: "'Outfit', sans-serif", fontSize: 13, marginTop: 2 }}>
              Klangkarussell ft. Will Heard
            </p>
          </div>
        </div>

        {/* Controls + progress */}
        <div className="pb-0">
          {/* Progress bar */}
          <div className="flex items-center gap-3 mb-3">
            <span className="text-xs font-mono flex-shrink-0" style={{ color: "rgba(255,255,255,0.35)", fontFamily: "'JetBrains Mono', monospace", fontSize: 11 }}>
              1:34
            </span>
            <div
              className="flex-1 h-1 rounded-full cursor-pointer group relative"
              style={{ background: "rgba(255,255,255,0.12)" }}
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const pct = (e.clientX - rect.left) / rect.width;
                setProgress(Math.round(pct * 272));
              }}
            >
              <div
                className="h-full rounded-full relative"
                style={{
                  width: `${(progress / 272) * 100}%`,
                  background: "linear-gradient(90deg, #f59e0b, #fbbf24)",
                  transition: "width 0.3s linear",
                }}
              >
                <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-white opacity-0 group-hover:opacity-100 transition-opacity" style={{ transform: "translate(50%,-50%)", boxShadow: "0 0 8px rgba(245,158,11,0.8)" }} />
              </div>
            </div>
            <span className="text-xs font-mono flex-shrink-0" style={{ color: "rgba(255,255,255,0.35)", fontFamily: "'JetBrains Mono', monospace", fontSize: 11 }}>
              4:32
            </span>
          </div>

          {/* Playback controls */}
          <div className="flex items-center gap-2 pb-4">
            <button className="w-8 h-8 rounded-lg flex items-center justify-center transition-all hover:bg-white/10" style={{ color: "rgba(255,255,255,0.5)" }}>
              ⏮
            </button>
            <button
              onClick={() => setPlaying(!playing)}
              className="w-10 h-10 rounded-full flex items-center justify-center transition-all hover:scale-105 active:scale-95 flex-shrink-0"
              style={{ background: "linear-gradient(135deg, #f59e0b, #d97706)", color: "#000", boxShadow: "0 4px 20px rgba(245,158,11,0.4)" }}
            >
              {playing ? '⏸' : '▶'}
            </button>
            <button className="w-8 h-8 rounded-lg flex items-center justify-center transition-all hover:bg-white/10" style={{ color: "rgba(255,255,255,0.5)" }}>
              ⏭
            </button>

            <div className="w-px h-5 mx-2" style={{ background: "rgba(255,255,255,0.1)" }} />

            {/* Volume */}
            <div className="flex items-center gap-2">
              <button className="w-7 h-7 flex items-center justify-center" style={{ color: "rgba(255,255,255,0.4)" }}>
                🔊
              </button>
              <div className="h-0.5 rounded-full cursor-pointer relative" style={{ width: 72, background: "rgba(255,255,255,0.15)" }}
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
                <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
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

const Sidebar = ({ activeView, setActiveView, expanded, setExpanded }: {
  activeView: string;
  setActiveView: (view: string) => void;
  expanded: boolean;
  setExpanded: (expanded: boolean) => void;
}) => {
  const [openGroup, setOpenGroup] = useState("queue");

  const handleNav = (item: any) => {
    if (item.children && item.children.length > 0) {
      setOpenGroup(openGroup === item.id ? null : item.id);
      setActiveView(item.children[0].id);
    } else {
      setActiveView(item.id);
      setOpenGroup("");
    }
  };

  const isGroupActive = (item: any) =>
    item.children?.some((c: any) => c.id === activeView) || activeView === item.id;

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
            ‹
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
                  🎵
                </div>
                {expanded && (
                  <>
                    <span className="flex-1 text-left text-sm font-medium whitespace-nowrap" style={{ fontFamily: "'Outfit', sans-serif" }}>
                      {item.label}
                    </span>
                    {item.children?.length > 0 && (
                      <span className={`transition-transform duration-200 flex-shrink-0 ${open ? "rotate-90" : ""}`}>›</span>
                    )}
                  </>
                )}
                {!expanded && item.children?.some((c: any) => c.badge) && (
                  <div className="absolute top-1 right-1 w-4 h-4 rounded-full bg-blue-500 flex items-center justify-center">
                    <span style={{ fontSize: 9, color: "#fff", fontFamily: "'JetBrains Mono', monospace" }}>
                      {item.children.reduce((a: number, c: any) => a + (c.badge || 0), 0)}
                    </span>
                  </div>
                )}
              </button>

              {/* Submenu */}
              {expanded && open && item.children?.length > 0 && (
                <div style={{ background: "rgba(255,255,255,0.02)", borderLeft: "1px solid rgba(255,255,255,0.06)", marginLeft: 22 }}>
                  {item.children.map((child: any) => (
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
          ›
        </button>
      )}
    </aside>
  );
};

/* ─── Main Content Views ─────────────────────────────────────────────────── */
const QueueView = ({ subView }: { subView: string }) => {
  const showNow = subView === "queue-now";

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 flex-shrink-0" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <div>
          <h1 className="font-bold" style={{ fontFamily: "'Outfit', sans-serif", fontSize: 20, color: "#fff", letterSpacing: "-0.02em" }}>
            {showNow ? "Now Playing" : "Up Next Queue"}
          </h1>
          <p className="text-sm mt-0.5" style={{ color: "rgba(255,255,255,0.35)", fontFamily: "'JetBrains Mono', monospace", fontSize: 11 }}>
            8 songs
          </p>
        </div>
        <div className="flex gap-2">
          <button className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all hover:opacity-90"
            style={{ background: "rgba(245,158,11,0.15)", color: "#f59e0b", border: "1px solid rgba(245,158,11,0.25)", fontFamily: "'Outfit', sans-serif" }}>
            ➕ Add Song
          </button>
          <button className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all hover:bg-white/10"
            style={{ color: "rgba(255,255,255,0.5)", border: "1px solid rgba(255,255,255,0.1)", fontFamily: "'Outfit', sans-serif" }}>
            🗑 Clear
          </button>
        </div>
      </div>

      {/* Now playing highlight */}
      {showNow && (
        <div className="mx-6 mt-4 mb-2 rounded-xl p-4 flex items-center gap-4 flex-shrink-0" style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)" }}>
          <img src="https://i.ytimg.com/vi/4UDNndFX94Y/mqdefault.jpg" alt="" className="w-14 h-14 rounded-xl object-cover flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="font-semibold truncate" style={{ color: "#fff", fontFamily: "'Outfit', sans-serif" }}>Sonnentanz (Sun Don't Shine)</p>
            <p className="text-sm truncate" style={{ color: "rgba(255,255,255,0.5)" }}>Klangkarussell ft. Will Heard</p>
            <div className="flex items-center gap-2 mt-1">
              <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              <span className="text-xs" style={{ color: "#4ade80", fontFamily: "'JetBrains Mono', monospace", fontSize: 10 }}>PLAYING · 1:34 / 4:32</span>
            </div>
          </div>
        </div>
      )}

      {/* Queue list */}
      <div className="flex-1 overflow-y-auto px-6 py-3">
        {/* Mock queue items */}
        <div className="space-y-1">
          <div className="flex items-center gap-3 rounded-xl px-3 py-2.5 group transition-all hover:bg-white/5 cursor-pointer">
            <span className="w-6 text-center flex-shrink-0"><span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "rgba(255,255,255,0.25)" }}>1</span></span>
            <img src="https://i.ytimg.com/vi/gGdGFtwCNBE/mqdefault.jpg" alt="" className="w-9 h-9 rounded-lg object-cover flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate" style={{ color: "#fff", fontFamily: "'Outfit', sans-serif" }}>Midnight City</p>
              <p className="text-xs truncate" style={{ color: "rgba(255,255,255,0.4)" }}>M83</p>
            </div>
            <span className="text-xs" style={{ color: "rgba(255,255,255,0.3)", fontFamily: "'JetBrains Mono', monospace", flexShrink: 0 }}>4:03</span>
          </div>
        </div>
      </div>
    </div>
  );
};

const PlaylistsView = () => {
  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-6 py-4 flex-shrink-0" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <div>
          <h1 className="font-bold" style={{ fontFamily: "'Outfit', sans-serif", fontSize: 20, color: "#fff", letterSpacing: "-0.02em" }}>Playlists</h1>
          <p className="text-sm mt-0.5" style={{ color: "rgba(255,255,255,0.35)", fontFamily: "'JetBrains Mono', monospace", fontSize: 11 }}>8 playlists · 1,909 total songs</p>
        </div>
        <button className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all hover:opacity-90"
          style={{ background: "rgba(245,158,11,0.15)", color: "#f59e0b", border: "1px solid rgba(245,158,11,0.25)", fontFamily: "'Outfit', sans-serif" }}>
          ➕ New Playlist
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-3">
        <div className="text-center text-gray-400 py-8">Playlist content here...</div>
      </div>
    </div>
  );
};

const SettingsView = ({ setActiveView }: { setActiveView: (view: string) => void }) => {
  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-6 py-4 flex-shrink-0" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <div>
          <h1 className="font-bold" style={{ fontFamily: "'Outfit', sans-serif", fontSize: 20, color: "#fff", letterSpacing: "-0.02em" }}>
            Settings · Playback
          </h1>
        </div>
        <button
          onClick={() => setActiveView('guide')}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all hover:opacity-90"
          style={{ background: "rgba(245,158,11,0.15)", color: "#f59e0b", border: "1px solid rgba(245,158,11,0.25)", fontFamily: "'Outfit', sans-serif" }}>
          📖 User Guide
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-3">
        <div className="max-w-md">
          <div className="flex items-center justify-between gap-4 py-3 border-b border-zinc-800">
            <div><div className="text-sm font-medium text-zinc-200">Loop Playlist</div><div className="text-xs text-zinc-500 mt-0.5">Restart when queue ends</div></div>
            <button className="relative w-11 h-6 rounded-full bg-zinc-700 transition-colors">
              <span className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow" />
            </button>
          </div>
          <button className="w-full px-6 py-3 rounded-lg text-sm font-medium transition-all hover:opacity-90 mt-6"
            style={{ background: "linear-gradient(135deg, #f59e0b, #d97706)", color: "#000" }}>
            Save Settings
          </button>
        </div>
      </div>
    </div>
  );
};

const LogsView = () => {
  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-6 py-4 flex-shrink-0" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <div>
          <h1 className="font-bold" style={{ fontFamily: "'Outfit', sans-serif", fontSize: 20, color: "#fff", letterSpacing: "-0.02em" }}>System Logs</h1>
          <p className="text-sm mt-0.5" style={{ color: "rgba(255,255,255,0.35)", fontFamily: "'JetBrains Mono', monospace", fontSize: 11 }}>Real-time event stream</p>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-3 space-y-1" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
        <div className="text-center text-gray-400 py-8">Log entries would appear here...</div>
      </div>
    </div>
  );
};

/* ─── Root App ───────────────────────────────────────────────────────────── */
export default function App() {
  const [activeView, setActiveView] = useState("queue-next");
  const [sidebarExpanded, setSidebarExpanded] = useState(true);
  const [playing, setPlaying] = useState(true);
  const [volume, setVolume] = useState(72);
  const [progress, setProgress] = useState(94);

  // Initialize admin preferences hook
  useAdminPrefs();

  // Tick progress
  useEffect(() => {
    if (!playing) return;
    const iv = setInterval(() => setProgress(p => p < 272 ? p + 1 : 0), 1000);
    return () => clearInterval(iv);
  }, [playing]);

  const renderMain = () => {
    if (activeView.startsWith("queue")) return <QueueView subView={activeView} />;
    if (activeView.startsWith("playlists")) return <PlaylistsView />;
    if (activeView.startsWith("settings")) return <SettingsView setActiveView={setActiveView} />;
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
