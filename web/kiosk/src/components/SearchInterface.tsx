import React, { useState, useEffect, useRef } from "react";
import { Dialog } from "./Dialog";
import { Button } from "./Button";
import { SearchInterfaceProps, SearchResult } from "../../../shared/types";
import { SearchKeyboard } from "./SearchKeyboard";
import { VideoResultCard } from "./VideoResultCard";
import { BackToSearchButton } from "./BackToSearchButton";

// Declare global YT for TypeScript
declare global {
  interface Window {
    YT: any;
    onYouTubeIframeAPIReady: () => void;
  }
}

export const SearchInterface: React.FC<SearchInterfaceProps> = ({
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
}) => {
  console.log('SearchInterface props:', {
    isOpen,
    searchResults: searchResults.length,
    showSearchResults,
    mode,
    credits,
    bypassCreditCheck
  });

  const [currentPage, setCurrentPage] = useState(1);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [validatingVideo, setValidatingVideo] = useState<string | null>(null);
  const playerRef = useRef<any>(null);

  const itemsPerPage = 8;
  const totalPages = Math.max(1, Math.ceil(searchResults.length / itemsPerPage));
  const paginatedResults = searchResults.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage,
  );

  // Reset page on new results
  useEffect(() => {
    setCurrentPage(1);
  }, [searchResults]);

  // Load YouTube IFrame API once
  useEffect(() => {
    if (typeof window !== "undefined" && !window.YT) {
      const tag = document.createElement("script");
      tag.src = "https://www.youtube.com/iframe_api";
      const firstScript = document.getElementsByTagName("script")[0];
      firstScript?.parentNode?.insertBefore(tag, firstScript);

      window.onYouTubeIframeAPIReady = () => {
        console.log("YouTube IFrame API ready");
      };
    }
  }, []);

  // Cleanup player on unmount
  useEffect(() => {
    return () => {
      if (playerRef.current) {
        playerRef.current.destroy?.();
      }
    };
  }, []);

  const handleValidationSuccess = (video: SearchResult) => {
    playerRef.current = null;
    setValidatingVideo(null);
    console.log('Video validated & playable:', video.id);
    onVideoSelect(video); // Your original flow continues
  };

  const handleValidationFailure = (video: SearchResult) => {
    playerRef.current?.destroy();
    playerRef.current = null;
    setValidatingVideo(null);

    setErrorMessage("Sorry, selection is unavailable - please select another video");

    // Remove the bad video from results
    // We trigger this via prop update — parent must filter it out
    // So we use a callback pattern (you'll need to wrap SearchInterface)
    // But for now: just show message and let user continue
    setTimeout(() => setErrorMessage(null), 5000);
  };

  const handleVideoSelect = (video: SearchResult) => {
    console.log('SearchInterface handleVideoSelect called with:', video);

    if (!bypassCreditCheck && mode === "PAID" && credits === 0) {
      console.log('Credit check failed');
      onInsufficientCredits?.();
      return;
    }

    // If YouTube API not loaded yet, skip validation (rare)
    if (!window.YT || !window.YT.Player) {
      console.warn("YouTube API not ready — skipping validation");
      onVideoSelect(video);
      return;
    }

    setValidatingVideo(video.id);

    // Destroy any previous player
    if (playerRef.current) {
      playerRef.current.destroy();
    }

    playerRef.current = new window.YT.Player("hidden-youtube-validator", {
      height: "0",
      width: "0",
      videoId: video.id,
      playerVars: {
        autoplay: 1,
        mute: 1,
        controls: 0,
        disablekb: 1,
        fs: 0,
        rel: 0,
        modestbranding: 1,
        origin: window.location.origin,
      },
      events: {
        onReady: (event: any) => {
          event.target.playVideo();
        },
        onStateChange: (event: any) => {
          if (event.data === window.YT.PlayerState.PLAYING) {
            handleValidationSuccess(video);
          }
          // Any other state after 1s = failure
        },
        onError: () => {
          handleValidationFailure(video);
        },
      },
    });

    // Fallback timeout: if not playing in 6s → reject
    setTimeout(() => {
      if (playerRef.current?.getPlayerState) {
        const state = playerRef.current.getPlayerState();
        if (state !== window.YT.PlayerState.PLAYING) {
          handleValidationFailure(video);
        }
      }
    }, 6000);
  };

  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      {/* Hidden player for validation */}
      <div
        id="hidden-youtube-validator"
        style={{
          position: "fixed",
          left: "-9999px",
          top: "-9999px",
          width: 1,
          height: 1,
          opacity: 0,
        }}
      />

      <div className="bg-slate-900/20 backdrop-blur-sm border-slate-600 max-w-[95vw] w-full sm:w-[1200px] h-[calc(100vh-50px)] sm:h-[calc(100vh-200px)] p-0 relative">
        {/* Close button */}
        <Button
          onClick={onClose}
          className="absolute top-2 right-2 sm:top-4 sm:right-4 z-50 w-8 h-8 sm:w-12 sm:h-12 bg-red-600/80 hover:bg-red-700/80 border-2 border-red-500 shadow-lg"
          style={{ filter: "drop-shadow(-5px -5px 10px rgba(0,0,0,0.8))" }}
        >
          X
        </Button>

        {/* Validation loading overlay */}
        {validatingVideo && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
            <div className="text-2xl text-amber-200">Checking video...</div>
          </div>
        )}

        {/* Error popover */}
        {errorMessage && (
          <div className="fixed inset-0 flex items-center justify-center z-50 pointer-events-none">
            <div className="bg-red-600 text-white px-8 py-6 rounded-2xl shadow-2xl max-w-md text-center animate-pulse pointer-events-auto">
              <p className="text-xl font-bold mb-4">{errorMessage}</p>
              <Button
                onClick={() => setErrorMessage(null)}
                className="bg-white text-red-600 px-8 py-3 text-lg font-bold rounded-lg hover:bg-gray-100"
              >
                OK
              </Button>
            </div>
          </div>
        )}

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
                <div className="text-2xl text-amber-200">Searching...</div>
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
                        disabled={validatingVideo === video.id}
                      />
                    ))}
                  </div>

                  {/* Pagination */}
                  <div className="flex justify-center items-center gap-4 mt-8">
                    <Button
                      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                      className="px-6 py-2 text-lg font-bold bg-black/60 text-white border-2 border-yellow-400 rounded shadow disabled:opacity-50"
                    >
                      Previous
                    </Button>
                    <span className="text-white text-lg font-bold">
                      Page {currentPage} of {totalPages}
                    </span>
                    <Button
                      onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                      disabled={currentPage === totalPages}
                      className="px-6 py-2 text-lg font-bold bg-black/60 text-white border-2 border-yellow-400 rounded shadow disabled:opacity-50"
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
