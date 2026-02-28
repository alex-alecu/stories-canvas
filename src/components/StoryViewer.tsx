import { Swiper, SwiperSlide } from 'swiper/react';
import { Navigation, Pagination, Keyboard } from 'swiper/modules';
import { Link } from 'react-router-dom';
import type { Scenario } from '../types';
import { useLanguage } from '../i18n/LanguageContext';
import 'swiper/css';
import 'swiper/css/navigation';
import 'swiper/css/pagination';

interface StoryViewerProps {
  storyId: string;
  scenario: Scenario;
}

export default function StoryViewer({ storyId, scenario }: StoryViewerProps) {
  const { t } = useLanguage();

  return (
    <div className="fixed inset-0 bg-black z-50">
      <Link
        to="/"
        className="absolute top-4 left-4 z-50 bg-black/40 hover:bg-black/60 backdrop-blur-sm text-white w-10 h-10 rounded-full flex items-center justify-center transition-colors"
        aria-label={t.backHome}
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
      </Link>

      <div className="absolute top-4 right-4 z-50 bg-black/40 backdrop-blur-sm text-white px-4 py-2 rounded-full text-sm font-semibold">
        {scenario.title}
      </div>

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
                <div className="w-full h-full bg-gradient-to-br from-primary-900/60 to-surface-dark-accent flex items-center justify-center">
                  <p className="text-primary-300 text-lg">
                    {page.status === 'failed' ? t.imageCouldNotGenerate : t.imageNotAvailable}
                  </p>
                </div>
              )}

              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 via-black/50 to-transparent">
                <div className="px-6 pb-16 pt-20 md:px-12 md:pb-20 md:pt-24">
                  <p className="text-white text-lg md:text-xl lg:text-2xl leading-relaxed max-w-3xl mx-auto text-center drop-shadow-lg font-medium">
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
