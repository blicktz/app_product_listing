import { useCallback, useEffect, useRef } from 'react';
import { useFocusEffect } from 'expo-router';
import { getRemoteTriggerSocketUrl } from './uploadApi';

const RECONNECT_DELAY_MS = 2000;

type RemoteTriggerHandlers = {
  onCapture?: () => void;
  onDone?: () => void;
};

/**
 * Holds the remote-trigger WebSocket open while the calling screen is focused
 * and invokes the latest handler for each broadcast action. Because it is
 * scoped to focus, multiple screens (Home, Camera) can use it without both
 * reacting to the same click — only the screen on top runs its handler.
 */
export function useRemoteTrigger({ onCapture, onDone }: RemoteTriggerHandlers) {
  // Refs so the focus effect (set up once per focus) always calls the latest
  // closure rather than a stale one captured at connect time. Kept current in
  // an effect rather than during render so render stays pure.
  const onCaptureRef = useRef(onCapture);
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onCaptureRef.current = onCapture;
    onDoneRef.current = onDone;
  });

  useFocusEffect(
    useCallback(() => {
      let socket: WebSocket | null = null;
      let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
      let stopped = false;

      const connect = () => {
        let url: string;
        try {
          url = getRemoteTriggerSocketUrl();
        } catch (error) {
          console.warn('Remote trigger disabled:', error);
          return;
        }

        socket = new WebSocket(url);

        socket.onmessage = (event) => {
          try {
            const { action } = JSON.parse(String(event.data));
            if (action === 'capture') {
              onCaptureRef.current?.();
            } else if (action === 'done') {
              onDoneRef.current?.();
            }
          } catch {
            // Ignore malformed messages.
          }
        };

        socket.onclose = () => {
          if (!stopped) {
            reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
          }
        };

        socket.onerror = () => {
          socket?.close();
        };
      };

      connect();

      return () => {
        stopped = true;
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
        }
        socket?.close();
      };
    }, [])
  );
}
