import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
import type { IosDeviceCaptureFrame, IosDeviceCaptureState } from '@shared/types';

const DEVICE_DISCOVERY_INTERVAL_MS = 2_000;

const INITIAL_STATE: IosDeviceCaptureState = {
  supported: true,
  phase: 'idle',
  device: null,
  detail: 'Connect and unlock an iOS 27 iPhone over USB-C.'
};

export function connectedDeviceCaptureError(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : 'The connected iPhone capture could not start.';
}

export function shouldRenderConnectedDeviceCapture(
  capture: IosDeviceCaptureState,
  frameUrl: string | null
): boolean {
  return capture.phase === 'streaming' && capture.device !== null && frameUrl !== null;
}

export function ConnectedDeviceCaptureSurface({
  capture,
  frameUrl,
  expanded = false,
  onExpandedChange
}: {
  capture: IosDeviceCaptureState;
  frameUrl: string | null;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
}): JSX.Element | null {
  if (!shouldRenderConnectedDeviceCapture(capture, frameUrl)) return null;
  const ExpansionIcon = expanded ? Minimize2 : Maximize2;

  return (
    <section className={`connected-device-summary-capture${expanded ? ' is-expanded' : ''}`} aria-label="Connected iPhone screen">
      <div className="connected-device-summary-frame">
        <img src={frameUrl ?? undefined} alt="Live connected iPhone screen" />
      </div>
      <button
        type="button"
        className="connected-device-summary-expand"
        title={expanded ? 'Restore iPhone stream' : 'Expand iPhone stream'}
        aria-label={expanded ? 'Restore iPhone stream below session summary' : 'Expand iPhone stream to fill sidebar'}
        aria-pressed={expanded}
        onClick={() => onExpandedChange?.(!expanded)}
      >
        <ExpansionIcon size={14} aria-hidden="true" />
      </button>
    </section>
  );
}

export function ConnectedDeviceCapture({
  active,
  expanded = false,
  onExpandedChange,
  onVisibilityChange
}: {
  active: boolean;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  onVisibilityChange?: (visible: boolean) => void;
}): JSX.Element | null {
  const frameUrlRef = useRef<string | null>(null);
  const attemptedDeviceIdRef = useRef<string | null>(null);
  const streamingDeviceIdRef = useRef<string | null>(null);
  const [capture, setCapture] = useState<IosDeviceCaptureState>(INITIAL_STATE);
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const visibilityCallbackRef = useRef(onVisibilityChange);
  visibilityCallbackRef.current = onVisibilityChange;

  const releaseFrame = useCallback(() => {
    if (frameUrlRef.current) URL.revokeObjectURL(frameUrlRef.current);
    frameUrlRef.current = null;
    setFrameUrl(null);
  }, []);

  const receiveFrame = useCallback((frame: IosDeviceCaptureFrame) => {
    const bytes = new Uint8Array(frame.jpegData);
    const nextUrl = URL.createObjectURL(new Blob([bytes.buffer], { type: 'image/jpeg' }));
    const previous = frameUrlRef.current;
    frameUrlRef.current = nextUrl;
    setFrameUrl(nextUrl);
    if (previous) URL.revokeObjectURL(previous);
  }, []);

  const receiveState = useCallback((next: IosDeviceCaptureState) => {
    setCapture(next);
    if (next.phase === 'streaming' && next.device) streamingDeviceIdRef.current = next.device.id;
    if (next.phase === 'error' && next.device?.id === streamingDeviceIdRef.current) {
      attemptedDeviceIdRef.current = null;
      streamingDeviceIdRef.current = null;
    }
    if (!next.device) {
      attemptedDeviceIdRef.current = null;
      streamingDeviceIdRef.current = null;
    }
    if (next.phase !== 'streaming') releaseFrame();
  }, [releaseFrame]);

  useEffect(() => {
    if (!active) {
      attemptedDeviceIdRef.current = null;
      streamingDeviceIdRef.current = null;
      releaseFrame();
      setCapture(INITIAL_STATE);
      void window.beale.stopIosDeviceCapture();
      return;
    }

    let cancelled = false;
    let refreshInFlight = false;
    const removeStateListener = window.beale.onIosDeviceCaptureUpdate((next) => {
      if (!cancelled) receiveState(next);
    });
    const removeFrameListener = window.beale.onIosDeviceCaptureFrame((frame) => {
      if (!cancelled) receiveFrame(frame);
    });

    const refresh = async (): Promise<void> => {
      if (refreshInFlight) return;
      refreshInFlight = true;
      try {
        const current = await window.beale.getIosDeviceCaptureState();
        if (cancelled) return;
        receiveState(current);
        if (
          current.phase === 'ready'
          && current.device
          && attemptedDeviceIdRef.current !== current.device.id
        ) {
          attemptedDeviceIdRef.current = current.device.id;
          receiveState({ ...current, phase: 'starting', detail: 'Launching Beale Capture on the iPhone…' });
          const started = await window.beale.startIosDeviceCapture();
          if (!cancelled) receiveState(started);
        }
      } catch (error: unknown) {
        if (!cancelled) {
          receiveState({ ...INITIAL_STATE, phase: 'error', detail: connectedDeviceCaptureError(error) });
        }
      } finally {
        refreshInFlight = false;
      }
    };

    void refresh();
    const discoveryTimer = window.setInterval(() => void refresh(), DEVICE_DISCOVERY_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(discoveryTimer);
      removeStateListener();
      removeFrameListener();
      attemptedDeviceIdRef.current = null;
      streamingDeviceIdRef.current = null;
      releaseFrame();
      void window.beale.stopIosDeviceCapture();
    };
  }, [active, receiveFrame, receiveState, releaseFrame]);

  useEffect(() => () => {
    if (frameUrlRef.current) URL.revokeObjectURL(frameUrlRef.current);
  }, []);

  const visible = shouldRenderConnectedDeviceCapture(capture, frameUrl);
  useEffect(() => {
    visibilityCallbackRef.current?.(visible);
    return () => {
      if (visible) visibilityCallbackRef.current?.(false);
    };
  }, [visible]);

  return (
    <ConnectedDeviceCaptureSurface
      capture={capture}
      frameUrl={frameUrl}
      expanded={expanded}
      onExpandedChange={onExpandedChange}
    />
  );
}
