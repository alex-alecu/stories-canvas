import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Swiper, SwiperSlide } from 'swiper/react';
import { Navigation, Keyboard } from 'swiper/modules';
import type { Swiper as SwiperType } from 'swiper';
import { Link, useNavigate } from 'react-router-dom';
import type { Scenario, GenerationProgress, StoryReaction, StoryMode, StoryStatus } from '../types';
import { useLanguage } from '../i18n/LanguageContext';
import { useFontSize, type FontSize } from '../contexts/FontSizeContext';
import { readStoredBoolean, readStoredNumber, writeStorageItem } from '../lib/browserStorage';
import { formatStoryStatusMessage } from '../i18n/storyStatusCopy';
import StoryToolsModal from './StoryToolsModal';
import 'swiper/css';
import 'swiper/css/navigation';

const AUTOPLAY_STORAGE_KEY = 'stories-canvas:auto-play';
const PLAYBACK_RATE_KEY = 'stories-canvas:playback-rate';
const PLAYBACK_RATES = [0.8, 0.9, 1, 1.1] as const;

function getStoredAutoPlay(): boolean {
  return readStoredBoolean(AUTOPLAY_STORAGE_KEY);
}

function getStoredPlaybackRate(): number {
  return readStoredNumber(
    PLAYBACK_RATE_KEY,
    1,
    value => (PLAYBACK_RATES as readonly number[]).includes(value),
  );
}

interface StoryViewerProps {
  storyId: string;
  scenario: Scenario;
  isGenerating?: boolean;
  progress?: GenerationProgress | null;
  storyMessage?: string;
  voice?: string;
  storyStatus: StoryStatus;
  likeCount?: number;
  dislikeCount?: number;
  myReaction?: StoryReaction | null;
  storyMode?: StoryMode;
  canManageStory?: boolean;
  canUseOnlineActions?: boolean;
  publicPreviewGate?: {
    pageLimit: number;
    totalPages: number;
    loginPath: string;
  };
}

const fontSizeClasses: Record<FontSize, string> = {
  small: 'text-base md:text-lg lg:text-xl',
  medium: 'text-lg md:text-xl lg:text-2xl',
  large: 'text-xl md:text-2xl lg:text-3xl',
};

function formatTemplate(template: string, values: Record<string, number | string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? `{${key}}`));
}

export default function StoryViewer({
  storyId,
  scenario,
  isGenerating,
  progress,
  storyMessage,
  voice,
  storyStatus,
  likeCount = 0,
  dislikeCount = 0,
  myReaction = null,
  storyMode,
  canManageStory = false,
  canUseOnlineActions = true,
  publicPreviewGate,
}: StoryViewerProps) {
  const { t } = useLanguage();
  const { fontSize } = useFontSize();
  const [showTools, setShowTools] = useState(false);
  const autoOpenedToolsRef = useRef(false);
  const swiperRef = useRef<SwiperType | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Exit animation state — swipe/navigate past last page returns to story list
  const [isExiting, setIsExiting] = useState(false);
  const isExitingRef = useRef(false);
  const navigate = useNavigate();

  // Detect errors for the tools button indicator
  const hasErrors = useMemo(() => {
    const hasFailedImages = scenario.pages.some(p => p.status === 'failed');
    const shouldHaveAudio = !!voice || scenario.pages.some(p => !!p.audioUrl);
    const hasMissingAudio = shouldHaveAudio && scenario.pages.some(p => !p.audioUrl);
    return hasFailedImages || hasMissingAudio;
  }, [scenario.pages, voice]);

  const issueMessage = useMemo(() => {
    if (!hasErrors) return null;
    if (!isGenerating && storyMessage) return formatStoryStatusMessage(storyMessage, t);
    return null;
  }, [hasErrors, isGenerating, storyMessage, t]);

  useEffect(() => {
    autoOpenedToolsRef.current = false;
  }, [storyId]);

  useEffect(() => {
    if (hasErrors && canManageStory && !autoOpenedToolsRef.current) {
      autoOpenedToolsRef.current = true;
      setShowTools(true);
    }
  }, [canManageStory, hasErrors]);

  // Auto-play state (persisted to localStorage)
  const [autoPlay, setAutoPlay] = useState(getStoredAutoPlay);
  const autoPlayRef = useRef(autoPlay);
  useEffect(() => { autoPlayRef.current = autoPlay; }, [autoPlay]);

  const toggleAutoPlay = useCallback(() => {
    setAutoPlay(prev => {
      const next = !prev;
      writeStorageItem(AUTOPLAY_STORAGE_KEY, String(next));
      return next;
    });
  }, []);

  // Playback rate state (persisted to localStorage)
  const [playbackRate, setPlaybackRate] = useState(getStoredPlaybackRate);
  const playbackRateRef = useRef(playbackRate);
  useEffect(() => { playbackRateRef.current = playbackRate; }, [playbackRate]);

  // Apply playback rate when it changes
  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = playbackRate;
  }, [playbackRate]);

  const cyclePlaybackRate = useCallback(() => {
    setPlaybackRate(prev => {
      const idx = (PLAYBACK_RATES as readonly number[]).indexOf(prev);
      const next = PLAYBACK_RATES[(idx + 1) % PLAYBACK_RATES.length];
      writeStorageItem(PLAYBACK_RATE_KEY, String(next));
      return next;
    });
  }, []);

  // Check if any page in the story has audio
  const hasAudio = useMemo(
    () => scenario.pages.some(p => !!p.audioUrl),
    [scenario.pages],
  );

  // Audio failure notification (auto-dismiss after 5s)
  const [showAudioFailed, setShowAudioFailed] = useState(false);
  useEffect(() => {
    if (progress?.audioFailed) {
      setShowAudioFailed(true);
      const timer = setTimeout(() => setShowAudioFailed(false), 5000);
      return () => clearTimeout(timer);
    }
  }, [progress?.audioFailed]);

  // Audio playback state
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playingPage, setPlayingPage] = useState<number | null>(null);
  const [audioLoading, setAudioLoading] = useState<number | null>(null);
  const [activeSlideIndex, setActiveSlideIndex] = useState(0);
  const visiblePageCount = scenario.pages.length;
  const slideCount = visiblePageCount + (publicPreviewGate ? 1 : 0);
  const isPublicPreviewGateSlide = !!publicPreviewGate && activeSlideIndex >= visiblePageCount;
  const previewLastPage = scenario.pages[visiblePageCount - 1];
  const displayTotalPages = publicPreviewGate?.totalPages ?? scenario.pages.length;

  // Stop audio playback
  const stopAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current.src = '';
    }
    setPlayingPage(null);
    setAudioLoading(null);
  }, []);

  // Animate exit: swipe/navigate past last page returns to story list
  const exitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleExitAnimation = useCallback(() => {
    if (isExitingRef.current) return;
    isExitingRef.current = true;
    setIsExiting(true);
    stopAudio();
    exitTimeoutRef.current = setTimeout(() => navigate('/'), 500);
  }, [navigate, stopAudio]);

  // Clean up exit timeout on unmount
  useEffect(() => {
    return () => {
      if (exitTimeoutRef.current) clearTimeout(exitTimeoutRef.current);
    };
  }, []);

  // Track whether user already attempted to navigate past the end (for keyboard double-press)
  const reachedEndRef = useRef(false);
  useEffect(() => {
    if (activeSlideIndex !== slideCount - 1) {
      reachedEndRef.current = false;
    }
  }, [activeSlideIndex, slideCount]);

  // Only enable swipe/keyboard exit for multi-page stories on the last slide
  const isLastSlide = slideCount > 1 && activeSlideIndex === slideCount - 1;

  // Detect swipe past end on last slide (touch)
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !isLastSlide) return;

    let startX = 0;
    let startY = 0;

    const onTouchStart = (e: TouchEvent) => {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
    };

    const onTouchEnd = (e: TouchEvent) => {
      const diffX = startX - e.changedTouches[0].clientX;
      const diffY = Math.abs(startY - e.changedTouches[0].clientY);
      // Horizontal swipe left (forward) by >80px and more horizontal than vertical
      if (diffX > 80 && diffX > diffY) {
        handleExitAnimation();
      }
    };

    container.addEventListener('touchstart', onTouchStart, { passive: true });
    container.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      container.removeEventListener('touchstart', onTouchStart);
      container.removeEventListener('touchend', onTouchEnd);
    };
  }, [isLastSlide, handleExitAnimation]);

  // Detect ArrowRight on last slide (keyboard — requires double-press)
  useEffect(() => {
    if (!isLastSlide) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') {
        if (reachedEndRef.current) {
          handleExitAnimation();
        } else {
          reachedEndRef.current = true;
        }
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isLastSlide, handleExitAnimation]);

  // Play audio for a specific page
  const playPageAudio = useCallback((pageNumber: number, audioUrl: string) => {
    // If already playing this page, stop it
    if (playingPage === pageNumber) {
      stopAudio();
      return;
    }

    // Stop any current playback
    stopAudio();

    // Create new audio element if needed
    if (!audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.addEventListener('ended', () => {
        setPlayingPage(null);
      });
      audioRef.current.addEventListener('error', () => {
        setPlayingPage(null);
        setAudioLoading(null);
      });
    }

    setAudioLoading(pageNumber);
    audioRef.current.src = audioUrl;
    audioRef.current.playbackRate = playbackRateRef.current;
    audioRef.current.play()
      .then(() => {
        setPlayingPage(pageNumber);
        setAudioLoading(null);
      })
      .catch(() => {
        setPlayingPage(null);
        setAudioLoading(null);
      });
  }, [playingPage, stopAudio]);

  // Auto-play the first slide's audio when autoplay is already enabled on mount
  const firstSlideAutoPlayed = useRef(false);
  useEffect(() => {
    if (
      !firstSlideAutoPlayed.current &&
      autoPlay &&
      activeSlideIndex === 0 &&
      scenario.pages[0]?.audioUrl
    ) {
      const timer = setTimeout(() => {
        if (autoPlayRef.current && scenario.pages[0]?.audioUrl) {
          firstSlideAutoPlayed.current = true;
          playPageAudio(scenario.pages[0].pageNumber, scenario.pages[0].audioUrl);
        }
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [autoPlay, activeSlideIndex, scenario.pages, playPageAudio]);

  // Handle slide change — stop current audio, and auto-play next if enabled
  const handleSlideChange = useCallback((swiper: SwiperType) => {
    stopAudio();
    setActiveSlideIndex(swiper.activeIndex);
    if (publicPreviewGate && swiper.activeIndex >= scenario.pages.length) {
      return;
    }
    if (autoPlayRef.current) {
      const currentPage = scenario.pages[swiper.activeIndex];
      if (currentPage?.audioUrl) {
        // Small delay to let the slide transition settle
        setTimeout(() => {
          if (autoPlayRef.current && currentPage.audioUrl) {
            playPageAudio(currentPage.pageNumber, currentPage.audioUrl);
          }
        }, 300);
      }
    }
  }, [stopAudio, publicPreviewGate, scenario.pages, playPageAudio]);

  // Current page helper for the global play button
  const currentPage = isPublicPreviewGateSlide ? undefined : scenario.pages[activeSlideIndex];
  const currentPageAudioUrl = currentPage?.audioUrl;
  const currentPageNumber = currentPage?.pageNumber;
  const showAudioControls = hasAudio && !isPublicPreviewGateSlide;

  // Global play/pause handler for autoplay mode
  const handleGlobalPlayPause = useCallback(() => {
    if (!currentPageNumber || !currentPageAudioUrl) return;
    playPageAudio(currentPageNumber, currentPageAudioUrl);
  }, [currentPageNumber, currentPageAudioUrl, playPageAudio]);

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
        audioRef.current = null;
      }
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className={`fixed inset-0 bg-black z-50 transition-all duration-500 ease-out ${
        isExiting ? 'opacity-0 scale-95' : 'opacity-100 scale-100'
      }`}
    >
      {/* Back button */}
      <Link
        to="/"
        className="absolute top-4 left-4 z-50 bg-black/40 hover:bg-black/60 backdrop-blur-sm text-white w-10 h-10 rounded-full flex items-center justify-center transition-colors"
        aria-label={t.backHome}
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
      </Link>

      {/* Audio controls — only shown when the story has audio */}
      {showAudioControls && (
        <div className="absolute top-4 left-16 z-50 flex items-center gap-2">
          {/* Auto-play toggle */}
          <button
            onClick={toggleAutoPlay}
            className="bg-black/40 hover:bg-black/60 backdrop-blur-sm text-white h-10 rounded-full flex items-center gap-2 px-3 transition-colors text-sm font-medium"
            aria-label={t.autoPlay}
            aria-pressed={autoPlay}
          >
            {/* Toggle track */}
            <span
              className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200 ${
                autoPlay ? 'bg-primary-500' : 'bg-white/30'
              }`}
            >
              <span
                className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform duration-200 ${
                  autoPlay ? 'translate-x-[1.125rem]' : 'translate-x-[0.1875rem]'
                }`}
              />
            </span>
            <span className="hidden sm:inline">{t.autoPlay}</span>
          </button>

          {/* Global play/pause button */}
          {currentPageAudioUrl && (
            <button
              onClick={handleGlobalPlayPause}
              className="bg-black/40 hover:bg-black/60 backdrop-blur-sm text-white w-10 h-10 rounded-full flex items-center justify-center transition-colors"
              aria-label={playingPage === currentPageNumber ? t.pauseNarration : t.playNarration}
            >
              {audioLoading === currentPageNumber ? (
                <div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
              ) : playingPage === currentPageNumber ? (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                  <rect x="6" y="4" width="4" height="16" rx="1" />
                  <rect x="14" y="4" width="4" height="16" rx="1" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
              )}
            </button>
          )}

          {/* Playback speed */}
          <button
            onClick={cyclePlaybackRate}
            className="bg-black/40 hover:bg-black/60 backdrop-blur-sm text-white h-10 px-3 rounded-full flex items-center justify-center transition-colors text-sm font-medium"
            aria-label={t.narrationSpeed}
          >
            {playbackRate}x
          </button>
        </div>
      )}

      {/* Story tools button */}
      <div className="absolute top-4 right-4 z-50 flex items-center gap-2">
        <button
          onClick={() => setShowTools(true)}
          className="relative bg-black/40 hover:bg-black/60 backdrop-blur-sm text-white w-10 h-10 rounded-full flex items-center justify-center transition-colors"
          aria-label={t.storyTools}
        >
          {/* Settings icon */}
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          {/* Error indicator dot */}
          {hasErrors && (
            <span className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-red-500 rounded-full border-2 border-black" />
          )}
        </button>
      </div>

      {/* Audio failure notification */}
      {showAudioFailed && (
        <div className="absolute bottom-20 right-4 z-50 bg-red-500/80 backdrop-blur-sm text-white px-3 py-1.5 rounded-full text-xs font-medium flex items-center gap-2">
          <span>{t.narrationFailed}</span>
        </div>
      )}

      {issueMessage && !showAudioFailed && (
        <div className="absolute bottom-32 right-4 z-50 max-w-sm bg-amber-500/90 backdrop-blur-sm text-black px-3 py-2 rounded-2xl text-xs font-medium shadow-lg">
          {issueMessage}
        </div>
      )}

      {/* Progress pill — shown while images are still being generated */}
      {!showAudioFailed && isGenerating && progress && progress.totalPages > 0 && !progress.audioFailed && (
        <div className="absolute bottom-20 right-4 z-50 bg-black/50 backdrop-blur-sm text-white px-3 py-1.5 rounded-full text-xs font-medium flex items-center gap-2 animate-pulse">
          <div className="w-3 h-3 rounded-full border-2 border-white/30 border-t-white animate-spin" />
          <span>{progress.completedPages} / {progress.totalPages}</span>
        </div>
      )}

      <Swiper
        modules={[Navigation, Keyboard]}
        navigation
        keyboard={{ enabled: true }}
        className="w-full h-full story-swiper"
        spaceBetween={0}
        slidesPerView={1}
        onSwiper={(swiper) => { swiperRef.current = swiper; }}
        onSlideChange={handleSlideChange}
      >
        {scenario.pages.map(page => (
          <SwiperSlide key={page.pageNumber}>
            <div className="relative w-full h-full">
              {page.status === 'completed' ? (
                <img
                  src={page.imageUrl || `/api/stories/${storyId}/images/page-${String(page.pageNumber).padStart(2, '0')}.png`}
                  alt={`Page ${page.pageNumber}`}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full bg-gradient-to-br from-primary-900/60 to-surface-dark-accent flex flex-col items-center justify-center gap-4">
                  {page.status === 'failed' ? (
                    <p className="text-primary-300 text-lg">{t.imageCouldNotGenerate}</p>
                  ) : isGenerating ? (
                    <>
                      <div className="w-10 h-10 rounded-full border-3 border-primary-400/30 border-t-primary-400 animate-spin" />
                      <p className="text-primary-300/70 text-sm">{t.illustratingPages}...</p>
                    </>
                  ) : (
                    <p className="text-primary-300 text-lg">{t.imageNotAvailable}</p>
                  )}
                </div>
              )}

              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/85 via-black/60 via-[25%] to-transparent">
                <div className="px-6 pb-4 pt-10 md:px-12 md:pb-3 md:pt-14">
                  <p className={`text-white ${fontSizeClasses[fontSize]} leading-relaxed max-w-3xl mx-auto text-center drop-shadow-lg font-medium transition-[font-size] duration-200`}>
                    {page.text}
                  </p>
                  <div className="flex items-center justify-center gap-3 mt-3">
                    <p className="text-white/40 text-xs">
                      {page.pageNumber} / {displayTotalPages}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </SwiperSlide>
        ))}

        {publicPreviewGate && (
          <SwiperSlide key="public-preview-gate">
            <div className="relative h-full w-full overflow-hidden bg-black">
              {previewLastPage?.status === 'completed' && (
                <img
                  src={previewLastPage.imageUrl || `/api/stories/${storyId}/images/page-${String(previewLastPage.pageNumber).padStart(2, '0')}.png`}
                  alt=""
                  aria-hidden="true"
                  className="absolute inset-0 h-full w-full scale-105 object-cover opacity-40 blur-sm"
                />
              )}
              <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-black/80 to-black" />
              <div className="relative z-10 flex h-full items-center justify-center px-6 py-20">
                <div className="w-full max-w-md rounded-lg border border-white/15 bg-black/60 p-6 text-center text-white shadow-2xl backdrop-blur-md md:p-8">
                  <p className="text-sm font-semibold text-primary-200/90">
                    {formatTemplate(t.publicPreviewGateProgress, {
                      pageLimit: publicPreviewGate.pageLimit,
                      totalPages: publicPreviewGate.totalPages,
                    })}
                  </p>
                  <h2 className="mt-3 text-2xl font-extrabold leading-tight md:text-3xl">
                    {t.publicPreviewGateTitle}
                  </h2>
                  <p className="mt-3 text-sm leading-6 text-white/75 md:text-base">
                    {t.publicPreviewGateDescription}
                  </p>
                  <div className="mt-6 flex justify-center">
                    <Link
                      to={publicPreviewGate.loginPath}
                      onClick={stopAudio}
                      className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-primary-500 px-6 py-3 text-sm font-bold text-white transition-colors hover:bg-primary-600 focus:outline-none focus:ring-2 focus:ring-primary-200 focus:ring-offset-2 focus:ring-offset-black"
                    >
                      <span>{t.publicPreviewGateLogin}</span>
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M5 12h14" />
                        <path d="m12 5 7 7-7 7" />
                      </svg>
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          </SwiperSlide>
        )}
      </Swiper>

      {/* Story Tools modal */}
      {showTools && (
        <StoryToolsModal
          isOpen={showTools}
          onClose={() => setShowTools(false)}
          storyId={storyId}
          scenario={scenario}
          progress={progress}
          isGenerating={isGenerating}
          storyMessage={storyMessage}
          voice={voice}
          storyStatus={storyStatus}
          currentPage={currentPage}
          storyMode={storyMode}
          likeCount={likeCount}
          dislikeCount={dislikeCount}
          myReaction={myReaction}
          canManageStory={canManageStory}
          canUseOnlineActions={canUseOnlineActions}
        />
      )}

      <style>{`
        .story-swiper .swiper-button-next,
        .story-swiper .swiper-button-prev {
          color: white;
          background: rgba(0,0,0,0.3);
          width: 44px;
          height: 44px;
          border-radius: 50%;
          backdrop-filter: blur(4px);
        }
        .story-swiper .swiper-button-next::after,
        .story-swiper .swiper-button-prev::after {
          font-size: 18px;
          font-weight: bold;
        }
      `}</style>
    </div>
  );
}
