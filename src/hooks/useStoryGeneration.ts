import { useState, useEffect, useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { GenerationActivity, GenerationProgress } from '../../shared/types';

function isTerminalStatus(status?: GenerationProgress['status']): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

const MAX_ACTIVITY_LOG_ITEMS = 8;

function mergeActivityLog(
  current: GenerationActivity[] = [],
  activity?: GenerationActivity,
): GenerationActivity[] {
  if (!activity) return current;

  const next = current.filter(item => item.id !== activity.id);
  next.push(activity);
  return next.slice(-MAX_ACTIVITY_LOG_ITEMS);
}

export function useStoryGeneration(storyId: string | null) {
  const [progress, setProgress] = useState<GenerationProgress | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const progressRef = useRef<GenerationProgress | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queryClient = useQueryClient();

  const clearReconnectTimeout = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);

  const closeConnection = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setIsConnected(false);
  }, []);

  const connect = useCallback(() => {
    if (!storyId) return;

    clearReconnectTimeout();
    closeConnection();

    const es = new EventSource(`/api/stories/${storyId}/status`);
    eventSourceRef.current = es;

    es.onopen = () => {
      setIsConnected(true);
    };

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as Partial<GenerationProgress>;
        const previous = progressRef.current;
        const merged = {
          ...previous,
          ...data,
          activityLog: mergeActivityLog(previous?.activityLog, data.activity),
        } as GenerationProgress;
        progressRef.current = merged;
        setProgress(merged);

        // Invalidate story query when an individual page completes (for progressive loading)
        if (merged.pageStatus === 'completed' && storyId) {
          queryClient.invalidateQueries({ queryKey: ['story', storyId] });
        }

        // Invalidate queries when generation completes, fails, or is cancelled
        if (isTerminalStatus(merged.status)) {
          queryClient.invalidateQueries({ queryKey: ['stories'] });
          queryClient.invalidateQueries({ queryKey: ['story', storyId] });
          clearReconnectTimeout();
          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectTimeoutRef.current = null;
            if (eventSourceRef.current === es) {
              closeConnection();
            }
          }, 500);
        }
      } catch (e) {
        console.error('Failed to parse SSE data:', e);
      }
    };

    es.onerror = () => {
      setIsConnected(false);
      es.close();
      if (eventSourceRef.current === es) {
        eventSourceRef.current = null;
      }

      // Attempt reconnect after 3 seconds for non-terminal states
      const currentStatus = progressRef.current?.status;
      if (!isTerminalStatus(currentStatus)) {
        clearReconnectTimeout();
        reconnectTimeoutRef.current = setTimeout(() => {
          reconnectTimeoutRef.current = null;
          connect();
        }, 3000);
      }
    };
  }, [storyId, queryClient, clearReconnectTimeout, closeConnection]);

  useEffect(() => {
    if (!storyId) {
      clearReconnectTimeout();
      closeConnection();
      progressRef.current = null;
      setProgress(null);
      return;
    }

    progressRef.current = null;
    setProgress(null);
    connect();

    return () => {
      clearReconnectTimeout();
      closeConnection();
    };
  }, [storyId, connect, clearReconnectTimeout, closeConnection]);

  return { progress, isConnected };
}
