import { useCallback, useRef } from 'react';

export function useNotification() {
  const permissionRef = useRef<NotificationPermission>(
    typeof Notification !== 'undefined' ? Notification.permission : 'denied'
  );

  const requestPermission = useCallback(async () => {
    if (typeof Notification === 'undefined') return;
    if (permissionRef.current === 'granted') return;

    const result = await Notification.requestPermission();
    permissionRef.current = result;
  }, []);

  const notify = useCallback((title: string, body: string) => {
    if (typeof Notification === 'undefined') return;
    if (permissionRef.current !== 'granted') return;
    if (document.visibilityState !== 'hidden') return;

    const notification = new Notification(title, { body });
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
  }, []);

  return { requestPermission, notify };
}
