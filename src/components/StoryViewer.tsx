import { lazy, Suspense, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Swiper, SwiperSlide } from 'swiper/react';
import { Navigation, Keyboard } from 'swiper/modules';
import type { Swiper as SwiperType } from 'swiper';
import { Link, useNavigate } from 'react-router-dom';
import type { Scenario, GenerationProgress } from '../types';
import { useLanguage } from '../i18n/LanguageContext';
import { useFontSize, type FontSize } from '../contexts/FontSizeContext';
import FontSizeControl from './FontSizeControl';
import { readStoredBoolean, readStoredNumber, writeStorageItem } from '../lib/browserStorage';
import 'swiper/css';
import 'swiper/css/navigation';

const AUTOPLAY_STORAGE_KEY = 'stories-canvas:auto-play';
const PLAYBACK_RATE_KEY = 'stories-canvas:playback-rate';
const PLAYBACK_RATES = [0.8, 0.9, 1] as const;
const StoryToolsModal = lazy(() => import('./StoryToolsModal'));

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
  voice?: string;
}

const fontSizeClasses: Record<FontSize, string> = {
  small: 'text-base md:text-lg lg:text-xl',
  medium: 'text-lg md:text-xl lg:text-2xl',
  large: 'text-xl md:text-2xl lg:text-3xl',
};

export default function StoryViewer({ storyId, scenario, isGenerating, progress, voice }: StoryViewerProps) {
  const { t } = useLanguage();
  const { fontSize } = useFontSize();
  const [showFontSize, setShowFontSize] = useState(false);
  const [showTools, setShowTools] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
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
    if (activeSlideIndex !== scenario.pages.length - 1) {
      reachedEndRef.current = false;
    }
  }, [activeSlideIndex, scenario.pages.length]);

  // Only enable swipe/keyboard exit for multi-page stories on the last slide
  const isLastSlide = scenario.pages.length > 1 && activeSlideIndex === scenario.pages.length - 1;

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
  }, [stopAudio, scenario.pages, playPageAudio]);

  // Current page helper for the global play button
  const currentPage = scenario.pages[activeSlideIndex];
  const currentPageAudioUrl = currentPage?.audioUrl;
  const currentPageNumber = currentPage?.pageNumber;

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

  // Close popover on outside click
  useEffect(() => {
    if (!showFontSize) return;
    const handleClick = (e: MouseEvent) => {
      if (
        popoverRef.current && !popoverRef.current.contains(e.target as Node) &&
        buttonRef.current && !buttonRef.current.contains(e.target as Node)
      ) {
        setShowFontSize(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showFontSize]);

  // Close popover on Escape
  useEffect(() => {
    if (!showFontSize) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowFontSize(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [showFontSize]);

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

      {/* Font size button + popover */}
      <div className="absolute top-4 left-16 z-50">
        <button
          ref={buttonRef}
          onClick={() => setShowFontSize(prev => !prev)}
          className={`bg-black/40 hover:bg-black/60 backdrop-blur-sm text-white w-10 h-10 rounded-full flex items-center justify-center transition-colors text-sm font-bold ${
            showFontSize ? 'bg-black/60' : ''
          }`}
          aria-label={t.fontSize}
          aria-expanded={showFontSize}
        >
          Aa
        </button>
        {/* Popover */}
        <div
          ref={popoverRef}
          className={`absolute top-12 left-0 transition-all duration-200 ${
            showFontSize
              ? 'opacity-100 scale-100 translate-y-0'
              : 'opacity-0 scale-95 -translate-y-1 pointer-events-none'
          }`}
        >
          <FontSizeControl variant="overlay" />
        </div>
      </div>

      {/* Audio controls — only shown when the story has audio */}
      {hasAudio && (
        <div className="absolute top-4 left-[7.5rem] z-50 flex items-center gap-2">
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

      {/* Story title + tools button */}
      <div className="absolute top-4 right-4 z-50 flex items-center gap-2">
        <div className="hidden sm:block bg-black/40 backdrop-blur-sm text-white px-4 py-2 rounded-full text-sm font-semibold max-w-[40vw] truncate">
          {scenario.title}
        </div>
        <button
          onClick={() => setShowTools(true)}
          className="relative bg-black/40 hover:bg-black/60 backdrop-blur-sm text-white w-10 h-10 rounded-full flex items-center justify-center transition-colors"
          aria-label={t.storyTools}
        >
          {/* Grid/gallery icon */}
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
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
                      {page.pageNumber} / {scenario.pages.length}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </SwiperSlide>
        ))}
      </Swiper>

      {/* Story Tools modal */}
      {showTools && (
        <Suspense fallback={null}>
          <StoryToolsModal
            isOpen={showTools}
            onClose={() => setShowTools(false)}
            storyId={storyId}
            scenario={scenario}
            progress={progress}
            isGenerating={isGenerating}
            voice={voice}
          />
        </Suspense>
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
