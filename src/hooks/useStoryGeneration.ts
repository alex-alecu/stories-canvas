import { useState, useEffect, useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { GenerationProgress } from '../types';

export function useStoryGeneration(storyId: string | null) {
  const [progress, setProgress] = useState<GenerationProgress | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const progressRef = useRef<GenerationProgress | null>(null);
  const queryClient = useQueryClient();

  const connect = useCallback(() => {
    if (!storyId) return;

    // Close existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const es = new EventSource(`/api/stories/${storyId}/status`);
    eventSourceRef.current = es;

    es.onopen = () => {
      setIsConnected(true);
    };

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as GenerationProgress;
        progressRef.current = data;
        setProgress(data);

        // Invalidate story query when an individual page completes (for progressive loading)
        if (data.pageStatus === 'completed' && storyId) {
          queryClient.invalidateQueries({ queryKey: ['story', storyId] });
        }

        // Invalidate queries when generation completes, fails, or is cancelled
        if (data.status === 'completed' || data.status === 'failed' || data.status === 'cancelled') {
          queryClient.invalidateQueries({ queryKey: ['stories'] });
          queryClient.invalidateQueries({ queryKey: ['story', storyId] });
          // Close connection after final event
          setTimeout(() => {
            es.close();
            setIsConnected(false);
          }, 500);
        }
      } catch (e) {
        console.error('Failed to parse SSE data:', e);
      }
    };

    es.onerror = () => {
      setIsConnected(false);
      es.close();
      // Attempt reconnect after 3 seconds for non-terminal states
      const currentStatus = progressRef.current?.status;
      if (currentStatus !== 'completed' && currentStatus !== 'failed' && currentStatus !== 'cancelled') {
        setTimeout(connect, 3000);
      }
    };
  }, [storyId, queryClient]);

  useEffect(() => {
    connect();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        setIsConnected(false);
      }
    };
  }, [storyId]); // Only reconnect when storyId changes, not when connect changes

  return { progress, isConnected };
}
