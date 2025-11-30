import React, { useState, useEffect, useRef } from "react";
import { Dialog } from "./Dialog";
import { Button } from "./Button";
import { SearchInterfaceProps, SearchResult } from "../../../shared/types";
import { SearchKeyboard } from "./SearchKeyboard";
import { VideoResultCard } from "./VideoResultCard";
import { BackToSearchButton } from "./BackToSearchButton";

declare global {
  interface Window {
    YT: any;
    onYouTubeIframeAPIReady: () => void;
  }
}

// Add this new optional prop to your shared/types.ts → SearchInterfaceProps
interface SearchInterfacePropsExtended extends SearchInterfaceProps {
  onVideoBlocked?: (videoId: string) => void;
}

export const SearchInterface: React.FC<SearchInterfacePropsExtended> = ({
  isOpen,
  onClose,
  searchQuery,
  onSearchQueryChange,
  searchResults,
  isSearching,
  showKeyboard,
  showSearchResults,
  onKeyboardInput,
  onVideoSelect,
  onBackToSearch,
  mode,
  credits,
  onInsufficientCredits,
  includeKaraoke,
  onIncludeKaraokeChange,
  bypassCreditCheck = false,
  onVideoBlocked, // ← NEW: parent removes bad video
}) => {
  const [currentPage, setCurrentPage] = useState(1);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [validatingVideoId, setValidatingVideoId] = useState<string | null>(null);
  const playerRef = useRef<any>(null);

  const itemsPerPage = 8;
  const totalPages = Math.max(1, Math.ceil(searchResults.length / itemsPerPage));
  const paginatedResults = searchResults.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage,
  );

  useEffect(() => setCurrentPage(1), [searchResults]);

  // Load YouTube IFrame API
  useEffect(() => {
    if (typeof window !== "undefined" && !window.YT) {
      const tag = document.createElement("script");
      tag.src = "https://www.youtube.com/iframe_api";
      const firstScript = document.getElementsByTagName("script")[0];
      firstScript?.parentNode?.insertBefore(tag, firstScript);
    }
  }, []);

  // Cleanup player
  useEffect(() => {
    return () => playerRef.current?.destroy?.();
  }, []);

  const handleValidationSuccess = (video: SearchResult) => {
    playerRef.current?.destroy();
    playerRef.current = null;
    setValidatingVideoId(null);
    onVideoSelect(video); // ← Triggers your normal "Add song" dialog
  };

  const handleValidationFailure = (video: SearchResult) => {
    playerRef.current?.destroy();
    playerRef.current = null;
    setValidatingVideoId(null);

    // Show error
    setErrorMessage("Sorry, selection is unavailable - please select another video");

    // Remove from parent's results
    onVideoBlocked?.(video.id);

    // Auto-dismiss after 6s or on OK
    const timeout = setTimeout(() => setErrorMessage(null), 6000);
    const dismiss = () => {
      clearTimeout(timeout);
      setErrorMessage(null);
    };

    // Attach dismiss to OK button
    (window as any).dismissUnavailable = dismiss;
  };

  const handleVideoSelect = (video: SearchResult) => {
    if (!bypassCreditCheck && mode === "PAID" && credits === 0) {
      onInsufficientCredits?.();
      return;
    }

    if (!window.YT || !window.YT.Player) {
      console.warn("YouTube API not ready — skipping validation");
      onVideoSelect(video);
      return;
    }

    setValidatingVideoId(video.id);
    playerRef.current?.destroy();

    playerRef.current = new window.YT.Player("hidden-youtube-validator", {
      height: "0",
      width: "0",
      videoId: video.id,
      playerVars: {
        autoplay: 1,
        mute: 1,
        controls: 0,
        disablekb: 1,
        rel: 0,
        modestbranding: 1,
        origin: window.location.origin,
      },
      events: {
        onReady: (e: any) => e.target.playVideo(),
        onStateChange: (e: any) => {
          if (e.data === window.YT.PlayerState.PLAYING) {
            handleValidationSuccess(video);
          }
        },
        onError: () => handleValidationFailure(video),
      },
    });

    // Fallback timeout
    setTimeout(() => {
      if (playerRef.current?.getPlayerState?.() !== window.YT.PlayerState.PLAYING) {
        handleValidationFailure(video);
      }
    }, 6000);
  };

  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      {/* Hidden player */}
      <div id="hidden-youtube-validator" style={{ position: "fixed", left: "-9999px", width: 1, height: 1 }} />

      <div className="bg-slate-900/20 backdrop-blur-sm border-slate-600 max-w-[95vw] w-full sm:w-[1200px] h-[calc(100vh-50px)] sm:h-[calc(100vh-200px)] p-0 relative">
        <Button onClick={onClose} className="absolute top-2 right-2 sm:top-4 sm:right-4 z-50 w-12 h-12 bg-red-600/80 hover:bg-red-700/80 border-2 border-red-500 shadow-lg">
          X
        </Button>

        {/* Checking overlay */}
        {validatingVideoId && (
          <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
            <div className="text-4xl font-bold text-amber-300 animate-pulse">Checking video...</div>
          </div>
        )}

        {/* Unavailable popup */}
        {errorMessage && (
          <div className="fixed inset-0 flex items-center justify-center z-50 bg-black/70">
            <div className="bg-red-600 text-white px-10 py-8 rounded-3xl shadow-2xl text-center max-w-lg">
              <h3 className="text-2xl font-bold mb-6">{errorMessage}</h3>
              <Button
                onClick={() => setErrorMessage(null)}
                className="bg-white text-red-600 px-12 py-4 text-xl font-bold rounded-xl hover:bg-gray-100"
              >
                OK
              </Button>
            </div>
          </div>
        )}

        {/* Rest of your UI (keyboard, results, pagination) */}
        {showKeyboard && (
          <SearchKeyboard
            searchQuery={searchQuery}
            onSearchQueryChange={onSearchQueryChange}
            onKeyPress={onKeyboardInput}
            includeKaraoke={includeKaraoke}
            onIncludeKaraokeChange={onIncludeKaraokeChange}
          />
        )}

        {showSearchResults && (
          <div className="h-full bg-slate-900/20 backdrop-blur-sm text-white flex flex-col">
            <div className="p-4 border-b border-slate-700 flex items-center justify-between bg-slate-800/60 backdrop-blur">
              <BackToSearchButton onClick={onBackToSearch} />
            </div>

            {isSearching ? (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-3xl text-amber-200">Searching...</div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col overflow-hidden">
                <div className="flex-1 overflow-y-auto p-6 search-results-scrollable">
                  <div className="grid grid-cols-4 gap-6">
                    {paginatedResults.map((video) => (
                      <VideoResultCard
                        key={video.id}
                        video={video}
                        onClick={() => handleVideoSelect(video)}
                        variant="grid"
                      />
                    ))}
                  </div>

                  <div className="flex justify-center items-center gap-6 mt-10">
                    <Button
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                      className="px-8 py-3 text-xl font-bold bg-black/70 border-2 border-yellow-400 rounded-lg disabled:opacity-50"
                    >
                      Previous
                    </Button>
                    <span className="text-2xl font-bold text-yellow-400">
                      Page {currentPage} / {totalPages}
                    </span>
                    <Button
                      onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                      disabled={currentPage === totalPages}
                      className="px-8 py-3 text-xl font-bold bg-black/70 border-2 border-yellow-400 rounded-lg disabled:opacity-50"
                    >
                      Next
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
};
