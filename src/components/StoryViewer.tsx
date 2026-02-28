import { useState, useEffect, useRef } from 'react';
import { Swiper, SwiperSlide } from 'swiper/react';
import { Navigation, Pagination, Keyboard } from 'swiper/modules';
import { Link } from 'react-router-dom';
import type { Scenario, GenerationProgress } from '../types';
import { useLanguage } from '../i18n/LanguageContext';
import { useFontSize, type FontSize } from '../contexts/FontSizeContext';
import FontSizeControl from './FontSizeControl';
import 'swiper/css';
import 'swiper/css/navigation';
import 'swiper/css/pagination';

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
        modules={[Navigation, Pagination, Keyboard]}
        navigation
        pagination={{ clickable: true }}
        keyboard={{ enabled: true }}
        className="w-full h-full story-swiper"
        spaceBetween={0}
        slidesPerView={1}
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

              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 via-black/50 to-transparent">
                <div className="px-6 pb-16 pt-20 md:px-12 md:pb-20 md:pt-24">
                  <p className={`text-white ${fontSizeClasses[fontSize]} leading-relaxed max-w-3xl mx-auto text-center drop-shadow-lg font-medium transition-[font-size] duration-200`}>
                    {page.text}
                  </p>
                  <p className="text-white/40 text-xs text-center mt-3">
                    {page.pageNumber} / {scenario.pages.length}
                  </p>
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
        .story-swiper .swiper-pagination-bullet {
          background: white;
          opacity: 0.5;
        }
        .story-swiper .swiper-pagination-bullet-active {
          opacity: 1;
          background: white;
        }
      `}</style>
    </div>
  );
}
