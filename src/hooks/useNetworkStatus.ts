import { useEffect, useState } from 'react';

export function isBrowserOnline(): boolean {
  if (typeof navigator === 'undefined') {
    return true;
  }

  return navigator.onLine;
}

export function useNetworkStatus() {
  const [isOnline, setIsOnline] = useState(isBrowserOnline);

  useEffect(() => {
    const updateStatus = () => setIsOnline(isBrowserOnline());

    window.addEventListener('online', updateStatus);
    window.addEventListener('offline', updateStatus);
    updateStatus();

    return () => {
      window.removeEventListener('online', updateStatus);
      window.removeEventListener('offline', updateStatus);
    };
  }, []);

  return {
    isOnline,
    isOffline: !isOnline,
  };
}
