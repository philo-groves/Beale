import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { IosDeviceCaptureState } from '../src/shared/types';
import {
  ConnectedDeviceCaptureSurface,
  connectedDeviceCaptureError,
  shouldRenderConnectedDeviceCapture
} from '../src/renderer/features/deviceCapture/ConnectedDeviceCapture';

const STREAMING_CAPTURE: IosDeviceCaptureState = {
  supported: true,
  phase: 'streaming',
  device: {
    id: 'physical-iphone',
    name: "Phillip's iPhone",
    udid: '00008130-001A10E918EB8D3A',
    osVersion: '27.0',
    model: 'iPhone 15 Pro Max'
  },
  detail: 'Live iPhone screen over USB-C.'
};

describe('connected device capture', () => {
  it('renders live iPhone pixels below the session summary', () => {
    const html = renderToStaticMarkup(createElement(ConnectedDeviceCaptureSurface, {
      capture: STREAMING_CAPTURE,
      frameUrl: 'blob:connected-iphone-frame'
    }));

    expect(html).toContain('aria-label="Connected iPhone screen"');
    expect(html).toContain('Live connected iPhone screen');
    expect(html).toContain('blob:connected-iphone-frame');
    expect(html).toContain('aria-label="Expand iPhone stream to fill sidebar"');
    expect(html).not.toContain("Phillip&#x27;s iPhone");
    expect(html).not.toContain('>Live<');
  });

  it('offers a restore control when the stream fills the detailed sidebar', () => {
    const html = renderToStaticMarkup(createElement(ConnectedDeviceCaptureSurface, {
      capture: STREAMING_CAPTURE,
      frameUrl: 'blob:connected-iphone-frame',
      expanded: true
    }));

    expect(html).toContain('connected-device-summary-capture is-expanded');
    expect(html).toContain('aria-label="Restore iPhone stream below session summary"');
    expect(html).toContain('aria-pressed="true"');
  });

  it('constrains tall device pixels to the measured space below the summary', () => {
    const styles = readFileSync(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');
    const frameRule = styles.match(/\.connected-device-summary-frame \{(?<rule>[^}]*)\}/u)?.groups?.rule ?? '';

    expect(frameRule).toContain('position: absolute');
    expect(frameRule).toContain('inset: 0');
    expect(styles).toMatch(/\.connected-device-summary-frame img \{[^}]*width: auto/su);
    expect(styles).toMatch(/\.connected-device-summary-frame img \{[^}]*height: auto/su);
    expect(styles).toMatch(/\.connected-device-summary-frame img \{[^}]*max-width: 100%/su);
    expect(styles).toMatch(/\.connected-device-summary-frame img \{[^}]*max-height: 100%/su);
    expect(styles).toMatch(/\.connected-device-summary-expand \{[^}]*right: 8px/su);
    expect(styles).toMatch(/\.connected-device-summary-expand \{[^}]*bottom: 8px/su);
  });

  it('renders nothing before both the authenticated stream and first frame exist', () => {
    expect(shouldRenderConnectedDeviceCapture(STREAMING_CAPTURE, null)).toBe(false);
    expect(renderToStaticMarkup(createElement(ConnectedDeviceCaptureSurface, {
      capture: { ...STREAMING_CAPTURE, phase: 'waiting_for_consent' },
      frameUrl: 'blob:stale-frame'
    }))).toBe('');
  });

  it('turns transport failures into an actionable message', () => {
    expect(connectedDeviceCaptureError(new Error('USB tunnel closed'))).toBe('USB tunnel closed');
    expect(connectedDeviceCaptureError(null)).toContain('could not start');
  });
});
