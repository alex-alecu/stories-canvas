import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { Scenario, GenerationProgress } from '../types';
import { useRetryStory, useStoryAssets, useGenerateAudio } from '../hooks/useStories';
import { useStoryGeneration } from '../hooks/useStoryGeneration';
import { useLanguage } from '../i18n/LanguageContext';
import { VOICE_OPTIONS, type VoiceKey } from '../../shared/types';

interface StoryToolsModalProps {
  isOpen: boolean;
  onClose: () => void;
  storyId: string;
  scenario: Scenario;
  progress?: GenerationProgress | null;
  isGenerating?: boolean;
  voice?: string;
}

export default function StoryToolsModal({
  isOpen,
  onClose,
  storyId,
  scenario,
  progress,
  isGenerating,
  voice,
}: StoryToolsModalProps) {
  const { t } = useLanguage();
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [retryTriggered, setRetryTriggered] = useState(false);
  const [retryResult, setRetryResult] = useState<'success' | 'failed' | null>(null);
  // Grace period: when true, ignores stale terminal statuses from the SSE's initial DB read
  const [retryStarting, setRetryStarting] = useState(false);
  const retryStartingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const retryStory = useRetryStory();
  const generateAudio = useGenerateAudio();
  const { data: assets, isLoading: assetsLoading } = useStoryAssets(storyId, isOpen);

  // --- Audio generation state ---
  const [selectedVoice, setSelectedVoice] = useState<VoiceKey>('grandma');
  const [audioGenTriggered, setAudioGenTriggered] = useState(false);
  const [audioGenResult, setAudioGenResult] = useState<'success' | 'failed' | null>(null);
  const [audioGenStarting, setAudioGenStarting] = useState(false);
  const audioGenStartingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Connect to SSE for retry progress — delay until grace period ends to avoid
  // the stale 'completed' status that the SSE endpoint reads from DB before the
  // retry pipeline has a chance to update it.
  const sseActive = (retryTriggered && !retryStarting) || (audioGenTriggered && !audioGenStarting);
  const { progress: sseProgress } = useStoryGeneration(sseActive ? storyId : null);
  const activeProgress = (retryTriggered || audioGenTriggered) ? sseProgress : progress;

  // Clear the grace period timers on unmount
  useEffect(() => {
    return () => {
      if (retryStartingTimerRef.current) clearTimeout(retryStartingTimerRef.current);
      if (audioGenStartingTimerRef.current) clearTimeout(audioGenStartingTimerRef.current);
    };
  }, []);

  // Detect when retry completes or fails
  // During the retryStarting grace period, ignore stale terminal statuses
  // (the SSE may read the old 'completed' from DB before the pipeline updates it)
  useEffect(() => {
    if (!retryTriggered || retryStarting) return;
    if (sseProgress?.status === 'completed' || sseProgress?.status === 'failed') {
      setRetryResult(sseProgress.status === 'completed' ? 'success' : 'failed');
      setRetryTriggered(false);
    }
  }, [retryTriggered, retryStarting, sseProgress?.status]);

  // Detect when audio generation completes or fails
  useEffect(() => {
    if (!audioGenTriggered || audioGenStarting) return;
    if (sseProgress?.status === 'completed' || sseProgress?.status === 'failed') {
      setAudioGenResult(sseProgress.status === 'completed' ? 'success' : 'failed');
      setAudioGenTriggered(false);
    }
  }, [audioGenTriggered, audioGenStarting, sseProgress?.status]);

  // Auto-dismiss retry result after 5 seconds
  useEffect(() => {
    if (!retryResult) return;
    const timer = setTimeout(() => setRetryResult(null), 5000);
    return () => clearTimeout(timer);
  }, [retryResult]);

  // Auto-dismiss audio gen result after 5 seconds
  useEffect(() => {
    if (!audioGenResult) return;
    const timer = setTimeout(() => setAudioGenResult(null), 5000);
    return () => clearTimeout(timer);
  }, [audioGenResult]);

  // Error detection
  const failedImageCount = useMemo(
    () => scenario.pages.filter(p => p.status === 'failed').length,
    [scenario.pages],
  );

  const shouldHaveAudio = useMemo(
    () => !!voice || scenario.pages.some(p => !!p.audioUrl),
    [scenario.pages, voice],
  );

  const missingAudioCount = useMemo(
    () => shouldHaveAudio ? scenario.pages.filter(p => !p.audioUrl).length : 0,
    [scenario.pages, shouldHaveAudio],
  );

  const hasErrors = failedImageCount > 0 || missingAudioCount > 0;

  // Can the user generate audio for this story? Only if no voice was set and no audio exists
  const canGenerateAudio = useMemo(
    () => !voice && !isGenerating && scenario.pages.every(p => !p.audioUrl),
    [voice, isGenerating, scenario.pages],
  );

  // Is the retry currently running?
  // During the grace period (retryStarting), we show retrying state even though the SSE
  // may not yet reflect the pipeline's in-progress status.
  const isRetrying = retryTriggered && (
    retryStarting ||
    activeProgress?.status === 'generating_images' ||
    activeProgress?.status === 'generating_audio'
  );

  // Is audio generation currently running?
  const isGeneratingAudio = audioGenTriggered && (
    audioGenStarting ||
    activeProgress?.status === 'generating_audio'
  );

  // Any background operation running?
  const isBusy = isRetrying || isGeneratingAudio;

  // Character sheets that are NOT page images (the "intermediate" images)
  const characterSheets = assets?.characterSheets ?? [];

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (lightboxUrl) {
          setLightboxUrl(null);
        } else {
          onClose();
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, lightboxUrl, onClose]);

  const handleRetry = useCallback(async () => {
    setRetryTriggered(true);
    setRetryStarting(true);
    // Grace period: ignore stale terminal statuses from the SSE's initial DB read.
    // The retry pipeline typically updates the story status within 1-2 seconds,
    // but we allow 5 seconds for network latency and DB round-trips.
    if (retryStartingTimerRef.current) clearTimeout(retryStartingTimerRef.current);
    retryStartingTimerRef.current = setTimeout(() => setRetryStarting(false), 5000);
    try {
      await retryStory.mutateAsync(storyId);
    } catch {
      setRetryTriggered(false);
      setRetryStarting(false);
      if (retryStartingTimerRef.current) clearTimeout(retryStartingTimerRef.current);
    }
  }, [retryStory, storyId]);

  const handleGenerateAudio = useCallback(async () => {
    setAudioGenTriggered(true);
    setAudioGenStarting(true);
    if (audioGenStartingTimerRef.current) clearTimeout(audioGenStartingTimerRef.current);
    audioGenStartingTimerRef.current = setTimeout(() => setAudioGenStarting(false), 5000);
    try {
      await generateAudio.mutateAsync({ id: storyId, voice: selectedVoice });
    } catch {
      setAudioGenTriggered(false);
      setAudioGenStarting(false);
      if (audioGenStartingTimerRef.current) clearTimeout(audioGenStartingTimerRef.current);
    }
  }, [generateAudio, storyId, selectedVoice]);

  if (!isOpen) return null;

  return (
    <>
      {/* Modal backdrop */}
      <div
        className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
        onClick={(e) => {
          if (e.target === e.currentTarget && !isBusy) onClose();
        }}
      >
        {/* Modal card */}
        <div className="bg-[#1a1a2e] border border-white/10 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
            <h2 className="text-white text-lg font-bold">{t.storyTools}</h2>
            <button
              onClick={onClose}
              disabled={isBusy}
              className="text-white/50 hover:text-white w-8 h-8 rounded-full flex items-center justify-center hover:bg-white/10 transition-colors disabled:opacity-30"
              aria-label="Close"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Scrollable content */}
          <div className="overflow-y-auto flex-1 px-6 py-5 space-y-6">
            {/* Retry section — only shown when errors exist */}
            {hasErrors && (
              <div className="bg-white/5 border border-white/10 rounded-xl p-5">
                <div className="flex items-start gap-3 mb-4">
                  {/* Warning icon */}
                  <div className="w-8 h-8 rounded-full bg-amber-500/20 flex items-center justify-center shrink-0 mt-0.5">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <h3 className="text-white font-semibold text-sm mb-1">{t.storyStatus}</h3>
                    <p className="text-white/60 text-sm">{t.retryDescription}</p>
                  </div>
                </div>

                {/* Error summary */}
                <div className="flex flex-wrap gap-2 mb-4">
                  {failedImageCount > 0 && (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-500/15 text-red-300 text-xs font-medium">
                      <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
                      {failedImageCount} {t.failedImages}
                    </span>
                  )}
                  {missingAudioCount > 0 && (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-orange-500/15 text-orange-300 text-xs font-medium">
                      <span className="w-1.5 h-1.5 rounded-full bg-orange-400" />
                      {missingAudioCount} {t.missingAudio}
                    </span>
                  )}
                </div>

                {/* Progress indicator during retry */}
                {isRetrying && activeProgress && (
                  <div className="mb-4">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-4 h-4 rounded-full border-2 border-primary-400/30 border-t-primary-400 animate-spin" />
                      <span className="text-white/70 text-sm">{t.retrying}</span>
                    </div>
                    {activeProgress.totalPages > 0 && (
                      <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary-500 rounded-full transition-all duration-300"
                          style={{ width: `${Math.round((activeProgress.completedPages / activeProgress.totalPages) * 100)}%` }}
                        />
                      </div>
                    )}
                    {activeProgress.message && (
                      <p className="text-white/40 text-xs mt-1.5">{activeProgress.message}</p>
                    )}
                  </div>
                )}

                {/* Retry result message */}
                {retryResult && (
                  <div className={`flex items-center gap-2 mb-4 px-3 py-2 rounded-lg text-sm ${
                    retryResult === 'success'
                      ? 'bg-green-500/15 text-green-300'
                      : 'bg-red-500/15 text-red-300'
                  }`}>
                    {retryResult === 'success' ? (
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    )}
                    <span>{retryResult === 'success' ? t.retrySuccess : t.retryFailed}</span>
                  </div>
                )}

                {/* Buttons */}
                <div className="flex gap-3">
                  <button
                    onClick={handleRetry}
                    disabled={isBusy}
                    className="bg-primary-500 hover:bg-primary-600 disabled:bg-primary-500/50 disabled:cursor-not-allowed text-white font-bold py-2 px-6 rounded-xl transition-colors text-sm"
                  >
                    {isRetrying ? t.retrying : t.retry}
                  </button>
                  <button
                    onClick={onClose}
                    disabled={isBusy}
                    className="bg-white/10 hover:bg-white/20 disabled:opacity-50 text-white py-2 px-6 rounded-xl transition-colors text-sm"
                  >
                    {t.back}
                  </button>
                </div>
              </div>
            )}

            {/* Generate narration section — only shown for stories without audio */}
            {canGenerateAudio && (
              <div className="bg-white/5 border border-white/10 rounded-xl p-5">
                <div className="flex items-start gap-3 mb-4">
                  {/* Speaker icon */}
                  <div className="w-8 h-8 rounded-full bg-primary-500/20 flex items-center justify-center shrink-0 mt-0.5">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-primary-400" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M13.5 4.06c0-1.336-1.616-2.005-2.56-1.06l-4.5 4.5H4.508c-1.141 0-2.318.664-2.66 1.905A9.76 9.76 0 001.5 12c0 .898.121 1.768.35 2.595.341 1.24 1.518 1.905 2.659 1.905h1.93l4.5 4.5c.945.945 2.561.276 2.561-1.06V4.06zM18.584 5.106a.75.75 0 011.06 0c3.808 3.807 3.808 9.98 0 13.788a.75.75 0 01-1.06-1.06 8.25 8.25 0 000-11.668.75.75 0 010-1.06z" />
                      <path d="M15.932 7.757a.75.75 0 011.061 0 6 6 0 010 8.486.75.75 0 01-1.06-1.061 4.5 4.5 0 000-6.364.75.75 0 010-1.06z" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <h3 className="text-white font-semibold text-sm mb-1">{t.narratorVoice}</h3>
                    <p className="text-white/60 text-sm">{t.addNarration}</p>
                  </div>
                </div>

                {/* Voice selector */}
                <div className="mb-4">
                  <label className="text-white/50 text-xs font-medium block mb-1.5">{t.selectVoice}</label>
                  <select
                    value={selectedVoice}
                    onChange={(e) => setSelectedVoice(e.target.value as VoiceKey)}
                    disabled={isGeneratingAudio}
                    className="w-full bg-white/10 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-400/50 disabled:opacity-50"
                  >
                    {VOICE_OPTIONS.map((opt) => (
                      <option key={opt.key} value={opt.key} className="bg-[#1a1a2e] text-white">
                        {t[opt.labelKey as keyof typeof t]} — {t[opt.descKey as keyof typeof t]}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Progress indicator during audio generation */}
                {isGeneratingAudio && activeProgress && (
                  <div className="mb-4">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-4 h-4 rounded-full border-2 border-primary-400/30 border-t-primary-400 animate-spin" />
                      <span className="text-white/70 text-sm">{t.generatingNarration}</span>
                    </div>
                    {activeProgress.totalPages > 0 && (
                      <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary-500 rounded-full transition-all duration-300"
                          style={{ width: `${Math.round((activeProgress.completedPages / activeProgress.totalPages) * 100)}%` }}
                        />
                      </div>
                    )}
                    {activeProgress.message && (
                      <p className="text-white/40 text-xs mt-1.5">{activeProgress.message}</p>
                    )}
                  </div>
                )}

                {/* Audio generation result message */}
                {audioGenResult && (
                  <div className={`flex items-center gap-2 mb-4 px-3 py-2 rounded-lg text-sm ${
                    audioGenResult === 'success'
                      ? 'bg-green-500/15 text-green-300'
                      : 'bg-red-500/15 text-red-300'
                  }`}>
                    {audioGenResult === 'success' ? (
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    )}
                    <span>{audioGenResult === 'success' ? t.narrationSuccess : t.narrationGenerationFailed}</span>
                  </div>
                )}

                {/* Button */}
                <button
                  onClick={handleGenerateAudio}
                  disabled={isBusy}
                  className="bg-primary-500 hover:bg-primary-600 disabled:bg-primary-500/50 disabled:cursor-not-allowed text-white font-bold py-2 px-6 rounded-xl transition-colors text-sm"
                >
                  {isGeneratingAudio ? t.generatingNarration : t.generateNarration}
                </button>
              </div>
            )}

            {/* Reference Images section */}
            <div>
              <h3 className="text-white font-semibold text-sm mb-3">{t.referenceImages}</h3>

              {assetsLoading ? (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {[1, 2, 3].map(i => (
                    <div key={i} className="aspect-square rounded-xl bg-white/5 animate-pulse" />
                  ))}
                </div>
              ) : characterSheets.length > 0 ? (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {characterSheets.map((sheet) => (
                    <button
                      key={sheet.url}
                      onClick={() => setLightboxUrl(sheet.url)}
                      className="group relative aspect-square rounded-xl overflow-hidden bg-white/5 hover:ring-2 ring-primary-400 transition-all cursor-pointer"
                    >
                      <img
                        src={sheet.url}
                        alt={sheet.name}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-2">
                        <p className="text-white text-xs font-medium truncate">
                          {sheet.name}
                        </p>
                        <p className="text-white/50 text-[10px]">{t.characterSheet}</p>
                      </div>
                      {/* Hover overlay */}
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow-lg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
                        </svg>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center mx-auto mb-3">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-white/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <p className="text-white/40 text-sm">{t.noReferenceImages}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Lightbox overlay */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-[70] bg-black/90 flex items-center justify-center p-4 cursor-pointer"
          onClick={() => setLightboxUrl(null)}
        >
          <button
            onClick={() => setLightboxUrl(null)}
            className="absolute top-4 right-4 text-white/70 hover:text-white w-10 h-10 rounded-full bg-black/40 hover:bg-black/60 flex items-center justify-center transition-colors"
            aria-label="Close"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <img
            src={lightboxUrl}
            alt="Full size preview"
            className="max-w-full max-h-full object-contain rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}
