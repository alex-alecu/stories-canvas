import { useState, useEffect, useRef, useCallback } from 'react';
import { Swiper, SwiperSlide } from 'swiper/react';
import { Navigation, Keyboard } from 'swiper/modules';
import type { Swiper as SwiperType } from 'swiper';
import { Link } from 'react-router-dom';
import type { Scenario, GenerationProgress } from '../types';
import { useLanguage } from '../i18n/LanguageContext';
import { useFontSize, type FontSize } from '../contexts/FontSizeContext';
import FontSizeControl from './FontSizeControl';
import 'swiper/css';
import 'swiper/css/navigation';

interface StoryViewerProps {
  storyId: string;
  scenario: Scenario;
  isGenerating?: boolean;
  progress?: GenerationProgress | null;
}

const fontSizeClasses: Record<FontSize, string> = {
  small: 'text-base md:text-lg lg:text-xl',
  medium: 'text-lg md:text-xl lg:text-2xl',
  large: 'text-xl md:text-2xl lg:text-3xl',
};

export default function StoryViewer({ storyId, scenario, isGenerating, progress }: StoryViewerProps) {
  const { t } = useLanguage();
  const { fontSize } = useFontSize();
  const [showFontSize, setShowFontSize] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Audio playback state
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playingPage, setPlayingPage] = useState<number | null>(null);
  const [audioLoading, setAudioLoading] = useState<number | null>(null);

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

  // Stop audio on slide change
  const handleSlideChange = useCallback((_swiper: SwiperType) => {
    stopAudio();
  }, [stopAudio]);

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
    <div className="fixed inset-0 bg-black z-50">
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

      {/* Story title badge */}
      <div className="absolute top-4 right-4 z-50 bg-black/40 backdrop-blur-sm text-white px-4 py-2 rounded-full text-sm font-semibold max-w-[50%] truncate">
        {scenario.title}
      </div>

      {/* Progress pill — shown while images are still being generated */}
      {isGenerating && progress && progress.totalPages > 0 && (
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
                    {/* Audio play/pause button */}
                    {page.audioUrl && (
                      <button
                        onClick={() => playPageAudio(page.pageNumber, page.audioUrl!)}
                        className="bg-white/20 hover:bg-white/30 backdrop-blur-sm text-white w-8 h-8 rounded-full flex items-center justify-center transition-colors"
                        aria-label={playingPage === page.pageNumber ? t.pauseNarration : t.playNarration}
                      >
                        {audioLoading === page.pageNumber ? (
                          <div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                        ) : playingPage === page.pageNumber ? (
                          /* Pause icon */
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                            <rect x="6" y="4" width="4" height="16" rx="1" />
                            <rect x="14" y="4" width="4" height="16" rx="1" />
                          </svg>
                        ) : (
                          /* Play icon */
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M8 5v14l11-7z" />
                          </svg>
                        )}
                      </button>
                    )}
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
