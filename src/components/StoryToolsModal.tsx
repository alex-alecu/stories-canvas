import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { GenerationProgress, Page, Scenario, StoryMode, StoryReaction, StoryStatus } from '../types';
import {
  DEFAULT_VOICE_KEY,
  VOICE_OPTIONS,
  getStoryAudioCreditCost,
  getStoryImagePageCreditCost,
  normalizeVoiceKey,
  type VoiceKey,
} from '../../shared/types';
import {
  useGenerateStoryAudio,
  useRegeneratePageAudio,
  useRegeneratePageImage,
  useRetryStory,
  useStoryAssets,
  useStoryReaction,
} from '../hooks/useStories';
import { useBillingOverview } from '../hooks/useBilling';
import { useStoryGeneration } from '../hooks/useStoryGeneration';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../i18n/LanguageContext';
import { formatCredits } from '../i18n/billingCopy';
import { formatStoryStatusMessage, getVoiceOptionText } from '../i18n/storyStatusCopy';
import FontSizeControl from './FontSizeControl';

const PAGE_FEEDBACK_MAX_CHARS = 800;
const PAGE_TEXT_OVERLAY_MAX_CHARS = 320;

type ToolsView = 'settings' | 'image' | 'audio';
type OperationResult = 'success' | 'failed' | null;
type PageImageMode = Extract<StoryMode, 'fast' | 'pro'>;

interface StoryToolsModalProps {
  isOpen: boolean;
  onClose: () => void;
  storyId: string;
  scenario: Scenario;
  progress?: GenerationProgress | null;
  isGenerating?: boolean;
  storyMessage?: string;
  voice?: string;
  storyStatus: StoryStatus;
  currentPage?: Page;
  storyMode?: StoryMode;
  likeCount?: number;
  dislikeCount?: number;
  myReaction?: StoryReaction | null;
  canManageStory?: boolean;
}

function formatReactionCount(count: number): string {
  const safeCount = Math.max(0, Math.trunc(count));
  if (safeCount >= 1_000_000) {
    return `${(safeCount / 1_000_000).toFixed(safeCount >= 10_000_000 ? 0 : 1).replace(/\.0$/, '')}M`;
  }
  if (safeCount >= 10_000) {
    return `${Math.round(safeCount / 1_000)}K`;
  }
  if (safeCount >= 1_000) {
    return `${(safeCount / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  }
  return safeCount.toLocaleString();
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function getPageTextMaxChars(targetAge: number): number {
  if (targetAge <= 3) return 160;
  if (targetAge <= 6) return 200;
  if (targetAge <= 9) return 280;
  return PAGE_TEXT_OVERLAY_MAX_CHARS;
}

function formatTemplate(template: string, values: Record<string, number | string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? `{${key}}`));
}

function getDefaultPageImageMode(storyMode?: StoryMode): PageImageMode {
  return storyMode === 'pro' || storyMode === 'pro_audio' ? 'pro' : 'fast';
}

export default function StoryToolsModal({
  isOpen,
  onClose,
  storyId,
  scenario,
  progress,
  isGenerating,
  storyMessage,
  voice,
  storyStatus,
  currentPage,
  storyMode,
  likeCount = 0,
  dislikeCount = 0,
  myReaction = null,
  canManageStory = false,
}: StoryToolsModalProps) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [view, setView] = useState<ToolsView>('settings');
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [retryTriggered, setRetryTriggered] = useState(false);
  const [audioTriggered, setAudioTriggered] = useState(false);
  const [imageTriggered, setImageTriggered] = useState(false);
  const [pageAudioTriggered, setPageAudioTriggered] = useState(false);
  const [retryResult, setRetryResult] = useState<OperationResult>(null);
  const [audioResult, setAudioResult] = useState<OperationResult>(null);
  const [imageResult, setImageResult] = useState<OperationResult>(null);
  const [pageAudioResult, setPageAudioResult] = useState<OperationResult>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [pageAudioError, setPageAudioError] = useState<string | null>(null);
  const [reactionError, setReactionError] = useState(false);
  const [selectedVoice, setSelectedVoice] = useState<VoiceKey>(DEFAULT_VOICE_KEY);
  const [imageMode, setImageMode] = useState<PageImageMode>(() => getDefaultPageImageMode(storyMode));
  const [imageFeedback, setImageFeedback] = useState('');
  const [pageText, setPageText] = useState(currentPage?.text ?? '');
  const [operationStarting, setOperationStarting] = useState(false);
  const operationStartingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const retryStory = useRetryStory();
  const generateAudio = useGenerateStoryAudio();
  const regenerateImage = useRegeneratePageImage();
  const regeneratePageAudio = useRegeneratePageAudio();
  const { mutate: mutateReaction, isPending: reactionPending } = useStoryReaction(storyId);
  const { data: billingOverview } = useBillingOverview(!!user);
  const { data: assets, isLoading: assetsLoading } = useStoryAssets(storyId, isOpen);

  const isTrackingGeneration = retryTriggered || audioTriggered || imageTriggered || pageAudioTriggered;
  const { progress: sseProgress } = useStoryGeneration(isTrackingGeneration && !operationStarting ? storyId : null);
  const activeProgress = isTrackingGeneration ? sseProgress : progress;
  const storyVoice = normalizeVoiceKey(voice);
  const availableCredits = billingOverview?.balance.availableCredits ?? 0;
  const imageCost = getStoryImagePageCreditCost(imageMode);
  const pageAudioCost = getStoryAudioCreditCost(1);
  const pageTextMaxChars = getPageTextMaxChars(scenario.targetAge);
  const addNarrationCost = getStoryAudioCreditCost(scenario.pages.filter(page => !page.audioUrl).length || scenario.pages.length);
  const characterSheets = assets?.characterSheets ?? [];
  const currentImageUrl = currentPage?.imageUrl || `/api/stories/${storyId}/images/page-${String(currentPage?.pageNumber ?? 1).padStart(2, '0')}.png`;
  const currentVoiceLabel = storyVoice
    ? getVoiceOptionText(VOICE_OPTIONS.find(option => option.key === storyVoice) ?? VOICE_OPTIONS[0], t).label
    : t.currentVoice;

  const canReact = !!user && storyStatus === 'completed';
  const canUsePageActions = canManageStory && storyStatus === 'completed' && !isGenerating && !!currentPage;
  const imageFeedbackTrimmed = imageFeedback.trim();
  const pageTextTrimmed = pageText.replace(/\s+/g, ' ').trim();
  const pageTextChanged = pageTextTrimmed !== (currentPage?.text ?? '').replace(/\s+/g, ' ').trim();
  const pageTextInvalid = !pageTextTrimmed || pageTextTrimmed.length > pageTextMaxChars;

  const isCreditShort = useCallback((cost: number) => (
    !!user && !!billingOverview && availableCredits < cost
  ), [availableCredits, billingOverview, user]);

  const goToBilling = useCallback(() => {
    const returnTo = `${location.pathname}${location.search}`;
    navigate(`/profile?reason=insufficient-credits&returnTo=${encodeURIComponent(returnTo)}`);
  }, [location.pathname, location.search, navigate]);

  const startOperationGracePeriod = useCallback(() => {
    setOperationStarting(true);
    if (operationStartingTimerRef.current) clearTimeout(operationStartingTimerRef.current);
    operationStartingTimerRef.current = setTimeout(() => setOperationStarting(false), 5000);
  }, []);

  const clearOperationGracePeriod = useCallback(() => {
    setOperationStarting(false);
    if (operationStartingTimerRef.current) {
      clearTimeout(operationStartingTimerRef.current);
      operationStartingTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      if (operationStartingTimerRef.current) clearTimeout(operationStartingTimerRef.current);
    };
  }, []);

  useEffect(() => {
    setPageText(currentPage?.text ?? '');
    setImageFeedback('');
    setImageError(null);
    setPageAudioError(null);
    setImageResult(null);
    setPageAudioResult(null);
  }, [currentPage?.pageNumber, currentPage?.text]);

  useEffect(() => {
    setImageMode(getDefaultPageImageMode(storyMode));
  }, [storyId, storyMode]);

  useEffect(() => {
    if (!isOpen) return;
    setView('settings');
  }, [isOpen]);

  useEffect(() => {
    if (!retryTriggered || operationStarting) return;
    if (sseProgress?.status === 'completed' || sseProgress?.status === 'failed') {
      setRetryResult(sseProgress.status === 'completed' ? 'success' : 'failed');
      setRetryTriggered(false);
    }
  }, [retryTriggered, operationStarting, sseProgress?.status]);

  useEffect(() => {
    if (!audioTriggered || operationStarting) return;
    if (sseProgress?.status === 'completed' || sseProgress?.status === 'failed') {
      setAudioResult(sseProgress.status === 'completed' && !sseProgress.audioFailed ? 'success' : 'failed');
      setAudioTriggered(false);
    }
  }, [audioTriggered, operationStarting, sseProgress?.audioFailed, sseProgress?.status]);

  useEffect(() => {
    if (!imageTriggered || operationStarting || !currentPage) return;
    if (sseProgress?.pageNumber !== currentPage.pageNumber) return;
    if (sseProgress?.pageStatus === 'completed' || sseProgress?.pageStatus === 'failed') {
      setImageResult(sseProgress.pageStatus === 'completed' ? 'success' : 'failed');
      setImageTriggered(false);
    }
  }, [currentPage, imageTriggered, operationStarting, sseProgress?.pageNumber, sseProgress?.pageStatus]);

  useEffect(() => {
    if (!pageAudioTriggered || operationStarting || !currentPage) return;
    if (sseProgress?.pageNumber !== currentPage.pageNumber) return;
    if (sseProgress?.pageStatus === 'completed' || sseProgress?.pageStatus === 'failed') {
      setPageAudioResult(sseProgress.pageStatus === 'completed' ? 'success' : 'failed');
      setPageAudioTriggered(false);
    }
  }, [currentPage, operationStarting, pageAudioTriggered, sseProgress?.pageNumber, sseProgress?.pageStatus]);

  useEffect(() => {
    if (!retryResult) return;
    const timer = setTimeout(() => setRetryResult(null), 5000);
    return () => clearTimeout(timer);
  }, [retryResult]);

  useEffect(() => {
    if (!audioResult) return;
    const timer = setTimeout(() => setAudioResult(null), 5000);
    return () => clearTimeout(timer);
  }, [audioResult]);

  useEffect(() => {
    if (!reactionError) return;
    const timer = setTimeout(() => setReactionError(false), 4000);
    return () => clearTimeout(timer);
  }, [reactionError]);

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

  const storyHasAudio = useMemo(
    () => scenario.pages.some(p => !!p.audioUrl),
    [scenario.pages],
  );

  const hasErrors = failedImageCount > 0 || missingAudioCount > 0;
  const canStartAddNarration = storyStatus === 'completed'
    && canManageStory
    && !isGenerating
    && !voice
    && !storyHasAudio
    && scenario.pages.length > 0;
  const showAddNarration = canStartAddNarration || audioTriggered || audioResult !== null;
  const isRetrying = retryTriggered && (
    operationStarting ||
    activeProgress?.status === 'generating_images' ||
    activeProgress?.status === 'generating_audio'
  );
  const isAddingNarration = audioTriggered && (
    operationStarting ||
    activeProgress?.status === 'generating_audio'
  );
  const isRegeneratingImage = imageTriggered && (
    operationStarting ||
    activeProgress?.status === 'generating_images'
  );
  const isRegeneratingPageAudio = pageAudioTriggered && (
    operationStarting ||
    activeProgress?.status === 'generating_audio'
  );
  const isBusy = isRetrying || isAddingNarration || isRegeneratingImage || isRegeneratingPageAudio;

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (lightboxUrl) {
        setLightboxUrl(null);
      } else {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, lightboxUrl, onClose]);

  const handleRetry = useCallback(async () => {
    setRetryTriggered(true);
    startOperationGracePeriod();
    try {
      await retryStory.mutateAsync(storyId);
    } catch {
      setRetryTriggered(false);
      clearOperationGracePeriod();
    }
  }, [clearOperationGracePeriod, retryStory, startOperationGracePeriod, storyId]);

  const handleGenerateAudio = useCallback(async () => {
    if (!canStartAddNarration) return;
    if (isCreditShort(addNarrationCost)) {
      goToBilling();
      return;
    }
    setAudioTriggered(true);
    setAudioResult(null);
    startOperationGracePeriod();
    try {
      await generateAudio.mutateAsync({ id: storyId, voice: selectedVoice });
    } catch {
      setAudioTriggered(false);
      setAudioResult('failed');
      clearOperationGracePeriod();
    }
  }, [
    addNarrationCost,
    canStartAddNarration,
    clearOperationGracePeriod,
    generateAudio,
    goToBilling,
    isCreditShort,
    selectedVoice,
    startOperationGracePeriod,
    storyId,
  ]);

  const handleReaction = useCallback((reaction: StoryReaction) => {
    if (!canReact || reactionPending) return;
    mutateReaction(
      { id: storyId, reaction: myReaction === reaction ? null : reaction },
      { onError: () => setReactionError(true) },
    );
  }, [canReact, myReaction, mutateReaction, reactionPending, storyId]);

  const handleImageSubmit = useCallback(async () => {
    if (!currentPage || !canUsePageActions) return;
    if (isCreditShort(imageCost)) {
      goToBilling();
      return;
    }
    if (!imageFeedbackTrimmed) {
      setImageError(t.pageImageFeedbackRequired);
      return;
    }
    if (imageFeedbackTrimmed.length > PAGE_FEEDBACK_MAX_CHARS) {
      setImageError(formatTemplate(t.pageImageFeedbackTooLong, { maxChars: PAGE_FEEDBACK_MAX_CHARS }));
      return;
    }

    setImageTriggered(true);
    setImageResult(null);
    setImageError(null);
    startOperationGracePeriod();
    try {
      await regenerateImage.mutateAsync({
        id: storyId,
        pageNumber: currentPage.pageNumber,
        feedback: imageFeedbackTrimmed,
        mode: imageMode,
      });
    } catch (error) {
      setImageTriggered(false);
      setImageResult('failed');
      setImageError(errorMessage(error, t.pageImageRegenerationError));
      clearOperationGracePeriod();
    }
  }, [
    canUsePageActions,
    clearOperationGracePeriod,
    currentPage,
    goToBilling,
    imageCost,
    imageFeedbackTrimmed,
    imageMode,
    isCreditShort,
    regenerateImage,
    startOperationGracePeriod,
    storyId,
    t,
  ]);

  const handlePageAudioSubmit = useCallback(async () => {
    if (!currentPage || !canUsePageActions || !storyVoice) return;
    if (isCreditShort(pageAudioCost)) {
      goToBilling();
      return;
    }
    if (pageTextInvalid) {
      setPageAudioError(formatTemplate(t.pageTextValidationError, { maxChars: pageTextMaxChars }));
      return;
    }

    setPageAudioTriggered(true);
    setPageAudioResult(null);
    setPageAudioError(null);
    startOperationGracePeriod();
    try {
      await regeneratePageAudio.mutateAsync({
        id: storyId,
        pageNumber: currentPage.pageNumber,
        text: pageTextTrimmed,
      });
    } catch (error) {
      setPageAudioTriggered(false);
      setPageAudioResult('failed');
      setPageAudioError(errorMessage(error, t.pageAudioUpdateError));
      clearOperationGracePeriod();
    }
  }, [
    canUsePageActions,
    clearOperationGracePeriod,
    currentPage,
    goToBilling,
    isCreditShort,
    pageAudioCost,
    pageTextInvalid,
    pageTextMaxChars,
    pageTextTrimmed,
    regeneratePageAudio,
    startOperationGracePeriod,
    storyId,
    storyVoice,
    t,
  ]);

  if (!isOpen) return null;

  const renderProgress = (label: string) => (
    <div className="mt-4 rounded-lg border border-white/10 bg-white/[0.04] p-3">
      <div className="flex items-center gap-2">
        <div className="h-4 w-4 rounded-full border-2 border-primary-400/30 border-t-primary-400 animate-spin" />
        <span className="text-sm text-white/75">{label}</span>
      </div>
      {activeProgress?.totalPages ? (
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-primary-500 transition-all duration-300"
            style={{ width: `${Math.round((activeProgress.completedPages / activeProgress.totalPages) * 100)}%` }}
          />
        </div>
      ) : null}
      {activeProgress?.message && (
        <p className="mt-2 text-xs text-white/45">{formatStoryStatusMessage(activeProgress.message, t)}</p>
      )}
    </div>
  );

  const renderResult = (result: OperationResult, success: string, failed: string) => {
    if (!result) return null;
    return (
      <div className={`mt-4 rounded-lg px-3 py-2 text-sm ${
        result === 'success'
          ? 'bg-green-500/15 text-green-300'
          : 'bg-red-500/15 text-red-300'
      }`}>
        {result === 'success' ? success : failed}
      </div>
    );
  };

  const renderImageModeToggle = (disabled = false) => (
    <div
      className="inline-flex h-8 overflow-hidden rounded-lg border border-white/10 bg-black/25 p-0.5"
      role="group"
      aria-label={t.imageQualityMode}
    >
      {(['fast', 'pro'] as const).map(mode => (
        <button
          key={mode}
          type="button"
          onClick={() => setImageMode(mode)}
          disabled={disabled}
          className={`min-w-14 rounded-md px-2.5 text-xs font-semibold transition-colors ${
            imageMode === mode
              ? 'bg-primary-500 text-white'
              : 'text-white/60 hover:bg-white/10 hover:text-white'
          } disabled:cursor-not-allowed disabled:opacity-50`}
          aria-pressed={imageMode === mode}
        >
          {mode === 'fast' ? t.storyModeFast : t.storyModePro}
        </button>
      ))}
    </div>
  );

  const renderActionRow = ({
    title,
    description,
    disabled,
    disabledMessage,
    onOpen,
  }: {
    title: string;
    description: string;
    disabled?: boolean;
    disabledMessage?: string;
    onOpen: () => void;
  }) => (
    <div className="flex flex-col gap-3 rounded-lg border border-white/10 bg-white/[0.04] p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <h4 className="text-sm font-semibold text-white">{title}</h4>
        <p className="mt-1 text-sm text-white/55">{disabled ? disabledMessage : description}</p>
      </div>
      <button
        type="button"
        onClick={onOpen}
        disabled={isBusy || disabled}
        className="inline-flex h-10 shrink-0 items-center justify-center rounded-lg bg-primary-500 px-4 text-sm font-bold text-white transition-colors hover:bg-primary-600 disabled:cursor-not-allowed disabled:bg-primary-500/45"
      >
        {t.openAction}
      </button>
    </div>
  );

  const renderSettingsView = () => (
    <div className="space-y-5">
      <section className="rounded-lg border border-white/10 bg-white/[0.04] p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/35">{t.storyToolsSectionStory}</p>
        <h3 className="mt-2 text-lg font-bold leading-snug text-white">{scenario.title}</h3>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <div className="flex h-10 items-center overflow-hidden rounded-lg border border-white/10 bg-black/25 text-white">
            <button
              type="button"
              onClick={() => handleReaction('like')}
              className={`flex h-10 items-center gap-1.5 px-3 text-xs font-semibold transition-colors ${
                myReaction === 'like'
                  ? 'bg-primary-500 text-white'
                  : canReact
                    ? 'hover:bg-white/10 text-white/90'
                    : 'text-white/45 cursor-not-allowed'
              }`}
              aria-label={canReact ? t.likeStory : t.signInToReact}
              aria-pressed={myReaction === 'like'}
              disabled={reactionPending}
              title={canReact ? t.likeStory : t.signInToReact}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M7 10v12" />
                <path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2h0a3.13 3.13 0 0 1 3 3.88Z" />
              </svg>
              <span>{formatReactionCount(likeCount)}</span>
            </button>
            <div className="h-5 w-px bg-white/15" />
            <button
              type="button"
              onClick={() => handleReaction('dislike')}
              className={`flex h-10 items-center gap-1.5 px-3 text-xs font-semibold transition-colors ${
                myReaction === 'dislike'
                  ? 'bg-white/20 text-white'
                  : canReact
                    ? 'hover:bg-white/10 text-white/90'
                    : 'text-white/45 cursor-not-allowed'
              }`}
              aria-label={canReact ? t.dislikeStory : t.signInToReact}
              aria-pressed={myReaction === 'dislike'}
              disabled={reactionPending}
              title={canReact ? t.dislikeStory : t.signInToReact}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M17 14V2" />
                <path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22h0a3.13 3.13 0 0 1-3-3.88Z" />
              </svg>
              <span>{formatReactionCount(dislikeCount)}</span>
            </button>
          </div>
          {reactionError && (
            <span className="text-xs text-red-300">{t.reactionUpdateFailed}</span>
          )}
        </div>
      </section>

      <section className="rounded-lg border border-white/10 bg-white/[0.04] p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/35">{t.storyToolsSectionReading}</p>
            <h3 className="mt-1 text-sm font-semibold text-white">{t.fontSize}</h3>
          </div>
          <FontSizeControl variant="overlay" />
        </div>
      </section>

      <section className="rounded-lg border border-white/10 bg-white/[0.04] p-4">
        <div className="flex items-start gap-3">
          <button
            type="button"
            onClick={() => currentPage?.imageUrl && setLightboxUrl(currentPage.imageUrl)}
            className="h-20 w-16 shrink-0 overflow-hidden rounded-lg bg-black/30"
            aria-label={t.openCurrentPageImage}
          >
            {currentPage ? (
              <img src={currentImageUrl} alt={formatTemplate(t.pageImageAlt, { pageNumber: currentPage.pageNumber })} className="h-full w-full object-cover" />
            ) : null}
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/35">{t.storyToolsSectionCurrentPage}</p>
            <h3 className="mt-1 text-sm font-semibold text-white">
              {formatTemplate(t.storyToolsCurrentPageCount, {
                pageNumber: currentPage?.pageNumber ?? '-',
                totalPages: scenario.pages.length,
              })}
            </h3>
            <p className="mt-1 line-clamp-2 text-sm text-white/55">{currentPage?.text}</p>
          </div>
        </div>

        <div className="mt-4 space-y-3">
          {renderActionRow({
            title: t.regeneratePageImageTitle,
            description: t.regeneratePageImageDescription,
            disabled: !canUsePageActions,
            disabledMessage: canManageStory
              ? t.pageActionsAvailableAfterGeneration
              : t.signInAsOwnerToRecreatePage,
            onOpen: () => setView('image'),
          })}
          {renderActionRow({
            title: t.audioAndScriptTitle,
            description: t.audioAndScriptDescription,
            disabled: !storyVoice || !canUsePageActions,
            disabledMessage: !canManageStory
              ? t.signInAsOwnerToRecreatePage
              : storyVoice
                ? t.pageActionsAvailableAfterGeneration
                : t.addNarrationFirst,
            onOpen: () => setView('audio'),
          })}
        </div>
      </section>

      {showAddNarration && (
        <section className="rounded-lg border border-white/10 bg-white/[0.04] p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-white">{t.addNarration}</h3>
              <p className="mt-1 text-sm text-white/55">{t.creditsRequiredLabel}: {formatCredits(addNarrationCost, t)}</p>
            </div>
            {isCreditShort(addNarrationCost) && (
              <span className="rounded-full bg-amber-500/15 px-2 py-1 text-xs text-amber-200">{t.notEnoughCredits}</span>
            )}
          </div>

          <label htmlFor="story-tools-voice-select" className="mt-4 block text-sm text-white/70">
            {t.selectVoice}
          </label>
          <select
            id="story-tools-voice-select"
            value={selectedVoice}
            onChange={(event) => setSelectedVoice(event.target.value as VoiceKey)}
            disabled={isBusy || !canStartAddNarration}
            className="mt-2 w-full rounded-lg border border-white/10 bg-white/10 px-3 py-2 text-sm text-white focus:border-primary-300 focus:outline-none disabled:opacity-50"
          >
            {VOICE_OPTIONS.map((option) => {
              const { label, description } = getVoiceOptionText(option, t);
              return (
                <option key={option.key} value={option.key} className="bg-[#1a1a2e] text-white">
                  {label} - {description}
                </option>
              );
            })}
          </select>

          {isAddingNarration && renderProgress(t.generatingNarration)}
          {renderResult(audioResult, t.narrationSuccess, t.narrationGenerationFailed)}

          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={handleGenerateAudio}
              disabled={isBusy || !canStartAddNarration}
              className="rounded-lg bg-primary-500 px-5 py-2 text-sm font-bold text-white transition-colors hover:bg-primary-600 disabled:cursor-not-allowed disabled:bg-primary-500/45"
            >
              {isCreditShort(addNarrationCost) ? t.getCredits : isAddingNarration ? t.generatingNarration : t.generateNarration}
            </button>
          </div>
        </section>
      )}

      {hasErrors && canManageStory && (
        <section className="rounded-lg border border-amber-400/20 bg-amber-500/[0.08] p-4">
          <h3 className="text-sm font-semibold text-white">{t.storyStatus}</h3>
          <p className="mt-1 text-sm text-white/60">{t.retryDescription}</p>
          {storyMessage && (
            <p className="mt-2 text-sm text-amber-300">{storyMessage}</p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {failedImageCount > 0 && (
              <span className="rounded-full bg-red-500/15 px-3 py-1 text-xs font-medium text-red-300">
                {failedImageCount} {t.failedImages}
              </span>
            )}
            {missingAudioCount > 0 && (
              <span className="rounded-full bg-orange-500/15 px-3 py-1 text-xs font-medium text-orange-300">
                {missingAudioCount} {t.missingAudio}
              </span>
            )}
          </div>
          {isRetrying && activeProgress && renderProgress(t.retrying)}
          {renderResult(retryResult, t.retrySuccess, t.retryFailed)}
          <button
            type="button"
            onClick={handleRetry}
            disabled={isBusy}
            className="mt-4 rounded-lg bg-primary-500 px-5 py-2 text-sm font-bold text-white transition-colors hover:bg-primary-600 disabled:cursor-not-allowed disabled:bg-primary-500/45"
          >
            {isRetrying ? t.retrying : t.retry}
          </button>
        </section>
      )}

      <section>
        <h3 className="mb-3 text-sm font-semibold text-white">{t.referenceImages}</h3>
        {assetsLoading ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="aspect-square rounded-lg bg-white/5 animate-pulse" />
            ))}
          </div>
        ) : characterSheets.length > 0 ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {characterSheets.map((sheet) => (
              <button
                key={sheet.url}
                type="button"
                onClick={() => setLightboxUrl(sheet.url)}
                className="group relative aspect-square cursor-pointer overflow-hidden rounded-lg bg-white/5 transition-all hover:ring-2 hover:ring-primary-400"
              >
                <img src={sheet.url} alt={sheet.name} className="h-full w-full object-cover" loading="lazy" />
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-2">
                  <p className="truncate text-xs font-medium text-white">{sheet.name}</p>
                  <p className="text-[10px] text-white/50">{t.characterSheet}</p>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <p className="rounded-lg bg-white/[0.04] p-4 text-center text-sm text-white/45">{t.noReferenceImages}</p>
        )}
      </section>
    </div>
  );

  const renderImageView = () => (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-lg border border-white/10 bg-black/30">
        <img src={currentImageUrl} alt={formatTemplate(t.pageImageAlt, { pageNumber: currentPage?.pageNumber ?? '' })} className="max-h-72 w-full object-contain" />
      </div>
      <div>
        <div className="mb-2 flex items-center justify-between gap-3">
          <label htmlFor="page-image-feedback" className="text-sm font-semibold text-white">{t.feedbackLabel}</label>
          <span className="text-xs text-white/45">{imageFeedback.length} / {PAGE_FEEDBACK_MAX_CHARS}</span>
        </div>
        <textarea
          id="page-image-feedback"
          value={imageFeedback}
          onChange={(event) => setImageFeedback(event.target.value)}
          maxLength={PAGE_FEEDBACK_MAX_CHARS}
          rows={5}
          placeholder={t.pageImageFeedbackPlaceholder}
          className="w-full resize-none rounded-lg border border-white/10 bg-white/10 px-3 py-2 text-sm text-white placeholder:text-white/35 focus:border-primary-300 focus:outline-none"
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-white/[0.04] px-3 py-2 text-sm text-white/60">
        <span>{t.costLabel}: <span className="font-semibold text-white">{formatCredits(imageCost, t)}</span></span>
        {renderImageModeToggle(isBusy)}
      </div>
      {imageError && <p className="rounded-lg bg-red-500/15 px-3 py-2 text-sm text-red-300">{imageError}</p>}
      {isRegeneratingImage && renderProgress(t.regeneratingPageImage)}
      {renderResult(imageResult, t.pageImageRegenerationSuccess, t.pageImageRegenerationFailed)}
      <button
        type="button"
        onClick={handleImageSubmit}
        disabled={!canUsePageActions || isBusy || regenerateImage.isPending || !imageFeedbackTrimmed}
        className="w-full rounded-lg bg-primary-500 px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-primary-600 disabled:cursor-not-allowed disabled:bg-primary-500/45"
      >
        {isCreditShort(imageCost) ? t.getCredits : isRegeneratingImage ? t.regenerating : t.regeneratePageImageTitle}
      </button>
    </div>
  );

  const renderAudioView = () => (
    <div className="space-y-4">
      <div className="rounded-lg border border-white/10 bg-white/[0.04] p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/35">{t.voiceLabel}</p>
            <p className="mt-1 text-sm font-semibold text-white">{currentVoiceLabel}</p>
          </div>
          <span className="rounded-full bg-white/10 px-2 py-1 text-xs text-white/65">{t.sameVoice}</span>
        </div>
        {currentPage?.audioUrl && (
          <audio controls src={currentPage.audioUrl} className="mt-4 w-full" />
        )}
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between gap-3">
          <label htmlFor="page-script-text" className="text-sm font-semibold text-white">{t.pageTextLabel}</label>
          <span className={`text-xs ${pageText.length > pageTextMaxChars ? 'text-red-300' : 'text-white/45'}`}>
            {pageText.length} / {pageTextMaxChars}
          </span>
        </div>
        <textarea
          id="page-script-text"
          value={pageText}
          onChange={(event) => setPageText(event.target.value)}
          rows={7}
          maxLength={pageTextMaxChars + 80}
          className="w-full resize-none rounded-lg border border-white/10 bg-white/10 px-3 py-2 text-sm leading-relaxed text-white placeholder:text-white/35 focus:border-primary-300 focus:outline-none"
        />
      </div>
      <div className="rounded-lg bg-white/[0.04] px-3 py-2 text-sm text-white/60">
        {t.costLabel}: <span className="font-semibold text-white">{formatCredits(pageAudioCost, t)}</span>
      </div>
      {!storyVoice && (
        <p className="rounded-lg bg-amber-500/15 px-3 py-2 text-sm text-amber-200">{t.addNarrationFirst}</p>
      )}
      {pageAudioError && <p className="rounded-lg bg-red-500/15 px-3 py-2 text-sm text-red-300">{pageAudioError}</p>}
      {isRegeneratingPageAudio && renderProgress(t.updatingScriptAndAudio)}
      {renderResult(pageAudioResult, t.scriptAndAudioUpdateSuccess, t.scriptAndAudioUpdateFailed)}
      <button
        type="button"
        onClick={handlePageAudioSubmit}
        disabled={!storyVoice || !canUsePageActions || isBusy || regeneratePageAudio.isPending || pageTextInvalid || !pageTextChanged}
        className="w-full rounded-lg bg-primary-500 px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-primary-600 disabled:cursor-not-allowed disabled:bg-primary-500/45"
      >
        {isCreditShort(pageAudioCost) ? t.getCredits : isRegeneratingPageAudio ? t.updating : t.updateScriptAndAudio}
      </button>
    </div>
  );

  const title = view === 'settings'
    ? t.storyTools
    : view === 'image'
      ? t.regeneratePageImageTitle
      : t.audioAndScriptTitle;

  return (
    <>
      <div
        className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
        onClick={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#1a1a2e] shadow-2xl">
          <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
            <div className="flex min-w-0 items-center gap-3">
              {view !== 'settings' && (
                <button
                  type="button"
                  onClick={() => setView('settings')}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white/60 transition-colors hover:bg-white/10 hover:text-white"
                  aria-label={t.back}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
              )}
              <h2 className="truncate text-lg font-bold text-white">{title}</h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white/50 transition-colors hover:bg-white/10 hover:text-white"
              aria-label={t.close}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-5">
            {view === 'settings' ? renderSettingsView() : view === 'image' ? renderImageView() : renderAudioView()}
          </div>
        </div>
      </div>

      {lightboxUrl && (
        <div
          className="fixed inset-0 z-[70] flex cursor-pointer items-center justify-center bg-black/90 p-4"
          onClick={() => setLightboxUrl(null)}
        >
          <button
            type="button"
            onClick={() => setLightboxUrl(null)}
            className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-black/40 text-white/70 transition-colors hover:bg-black/60 hover:text-white"
            aria-label={t.close}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <img
            src={lightboxUrl}
            alt={t.fullSizePreview}
            className="max-h-full max-w-full rounded-lg object-contain"
            onClick={(event) => event.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}
