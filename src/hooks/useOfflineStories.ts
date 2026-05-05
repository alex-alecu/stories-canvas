import { useCallback, useEffect, useMemo, useState } from 'react';
import type { StorySummary } from '../types';
import {
  clearOfflineStories,
  downloadStoryForOffline,
  getOfflineDownloadsSummary,
  getOfflineStory,
  promoteOfflineStory,
  removeOfflineStory,
  subscribeOfflineStories,
  type OfflineDownloadsSummary,
  type OfflineStoryRecord,
} from '../lib/offlineStories';

export type OfflineDownloadStatus = 'idle' | 'downloaded' | 'downloading' | 'failed';

const EMPTY_SUMMARY: OfflineDownloadsSummary = {
  totalCount: 0,
  manualCount: 0,
  recentCount: 0,
  totalBytes: 0,
};

export function useOfflineStoryDownload(story: StorySummary) {
  const [record, setRecord] = useState<OfflineStoryRecord | null>(null);
  const [status, setStatus] = useState<OfflineDownloadStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const canDownload = story.status === 'completed' && !story.assetsStale;

  const refreshRecord = useCallback(async () => {
    const nextRecord = await getOfflineStory(story.id).catch(() => null);
    setRecord(nextRecord);
    setStatus(current => {
      if (current === 'downloading') return current;
      return nextRecord ? 'downloaded' : 'idle';
    });
  }, [story.id]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const nextRecord = await getOfflineStory(story.id).catch(() => null);
      if (cancelled) return;
      setRecord(nextRecord);
      setStatus(current => {
        if (current === 'downloading') return current;
        return nextRecord ? 'downloaded' : 'idle';
      });
    };

    void load();
    const unsubscribe = subscribeOfflineStories(() => {
      void load();
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [story.id]);

  const download = useCallback(async () => {
    if (!canDownload || status === 'downloading') return;

    setStatus('downloading');
    setError(null);

    try {
      const nextRecord = await downloadStoryForOffline(story.id, 'manual');
      setRecord(nextRecord);
      setStatus('downloaded');
    } catch (downloadError) {
      setStatus('failed');
      setError(downloadError instanceof Error ? downloadError.message : 'Download failed');
    }
  }, [canDownload, status, story.id]);

  const remove = useCallback(async () => {
    setError(null);
    try {
      await removeOfflineStory(story.id);
      setRecord(null);
      setStatus('idle');
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : 'Could not remove download');
    }
  }, [story.id]);

  const keepOffline = useCallback(async () => {
    setError(null);
    try {
      const nextRecord = await promoteOfflineStory(story.id);
      setRecord(nextRecord);
      await refreshRecord();
    } catch (promoteError) {
      setError(promoteError instanceof Error ? promoteError.message : 'Could not update download');
    }
  }, [refreshRecord, story.id]);

  return useMemo(() => ({
    canDownload,
    error,
    isDownloaded: !!record,
    keepOffline,
    record,
    remove,
    startDownload: download,
    status,
  }), [canDownload, download, error, keepOffline, record, remove, status]);
}

export function useOfflineDownloadsSummary() {
  const [summary, setSummary] = useState<OfflineDownloadsSummary>(EMPTY_SUMMARY);
  const [isLoading, setIsLoading] = useState(true);
  const [isClearing, setIsClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshSummary = useCallback(async () => {
    try {
      const nextSummary = await getOfflineDownloadsSummary();
      setSummary(nextSummary);
      setError(null);
    } catch (summaryError) {
      setSummary(EMPTY_SUMMARY);
      setError(summaryError instanceof Error ? summaryError.message : 'Could not load downloads');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshSummary();
    return subscribeOfflineStories(() => {
      void refreshSummary();
    });
  }, [refreshSummary]);

  const clearAll = useCallback(async () => {
    setIsClearing(true);
    setError(null);
    try {
      await clearOfflineStories();
      await refreshSummary();
      return true;
    } catch (clearError) {
      setError(clearError instanceof Error ? clearError.message : 'Could not clear downloads');
      return false;
    } finally {
      setIsClearing(false);
    }
  }, [refreshSummary]);

  return useMemo(() => ({
    clearAll,
    error,
    isClearing,
    isLoading,
    refreshSummary,
    summary,
  }), [clearAll, error, isClearing, isLoading, refreshSummary, summary]);
}
