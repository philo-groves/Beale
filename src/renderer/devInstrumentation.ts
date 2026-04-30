import { useEffect, useRef } from 'react';
import type {
  ProfilingEventReportRow,
  ProfilingMetricDetail,
  ProfilingMetricValue,
  ProfilingReport,
  ProfilingRenderReportRow,
  ProfilingTimingReportRow
} from '@shared/types';

export type DevMetricValue = ProfilingMetricValue;
export type DevMetricDetail = ProfilingMetricDetail;

const DEV_INSTRUMENTATION_STORAGE_KEY = 'beale.devInstrumentation';
const DEV_INSTRUMENTATION_QUERY_KEY = 'bealePerf';
const DEV_INSTRUMENTATION_FLUSH_MS = 3_000;

interface RenderStat {
  count: number;
  lastRender: number;
  detail: DevMetricDetail;
}

interface TimingStat {
  count: number;
  totalMs: number;
  maxMs: number;
  lastMs: number;
  detail: DevMetricDetail;
}

interface EventStat {
  count: number;
  detail: DevMetricDetail;
}

export type DevPerformanceReport = ProfilingReport;

interface BealeDevPerformanceControls {
  enable(): void;
  disable(): void;
  report(): DevPerformanceReport;
  status(): { available: boolean; enabled: boolean; optIn: boolean };
}

type BealeDevPerformanceWindow = Window & {
  bealeDevPerformance?: BealeDevPerformanceControls;
};

class RendererDevInstrumentation {
  private enabled = false;
  private devConsoleEnabled = false;
  private profilingEnabled = false;
  private announced = false;
  private flushTimer: number | null = null;
  private reportSink: ((report: ProfilingReport) => void) | null = null;
  private readonly renderStats = new Map<string, RenderStat>();
  private readonly timingStats = new Map<string, TimingStat>();
  private readonly eventStats = new Map<string, EventStat>();
  private lastReport: ProfilingReport | null = null;

  public constructor() {
    if (typeof window === 'undefined') return;
    this.devConsoleEnabled = this.computeDevConsoleEnabled();
    this.syncEnabled();
    this.installControls();
    if (this.enabled) {
      this.announce();
      this.ensureFlushTimer();
    }
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public configureProfiling({
    enabled,
    onReport
  }: {
    enabled: boolean;
    onReport: ((report: ProfilingReport) => void) | null;
  }): void {
    this.profilingEnabled = enabled;
    this.reportSink = enabled ? onReport : null;
    this.syncEnabled();
  }

  public recordRender(surface: string, renderCount: number, detail: DevMetricDetail = {}): void {
    if (!this.enabled) return;
    const existing = this.renderStats.get(surface);
    if (existing) {
      existing.count += 1;
      existing.lastRender = renderCount;
      existing.detail = normalizeDetail(detail);
      return;
    }
    this.renderStats.set(surface, { count: 1, lastRender: renderCount, detail: normalizeDetail(detail) });
    this.ensureFlushTimer();
  }

  public recordTiming(name: string, durationMs: number, detail: DevMetricDetail = {}): void {
    if (!this.enabled) return;
    const existing = this.timingStats.get(name);
    if (existing) {
      existing.count += 1;
      existing.totalMs += durationMs;
      existing.maxMs = Math.max(existing.maxMs, durationMs);
      existing.lastMs = durationMs;
      existing.detail = normalizeDetail(detail);
      return;
    }
    this.timingStats.set(name, { count: 1, totalMs: durationMs, maxMs: durationMs, lastMs: durationMs, detail: normalizeDetail(detail) });
    this.ensureFlushTimer();
  }

  public recordEvent(name: string, detail: DevMetricDetail = {}): void {
    if (!this.enabled) return;
    const existing = this.eventStats.get(name);
    if (existing) {
      existing.count += 1;
      existing.detail = normalizeDetail(detail);
      return;
    }
    this.eventStats.set(name, { count: 1, detail: normalizeDetail(detail) });
    this.ensureFlushTimer();
  }

  public recordPayload(name: string, payload: unknown, detail: DevMetricDetail = {}): void {
    if (!this.enabled) return;
    const startedAt = performance.now();
    const bytes = approximateSerializedSizeBytes(payload);
    this.recordTiming(`${name}.serializeEstimate`, performance.now() - startedAt, detail);
    this.recordEvent(name, { ...detail, kb: Math.round(bytes / 1024) });
  }

  public time<T>(name: string, operation: () => T, detail: DevMetricDetail = {}): T {
    if (!this.enabled) return operation();
    const startedAt = performance.now();
    try {
      return operation();
    } finally {
      this.recordTiming(name, performance.now() - startedAt, detail);
    }
  }

  public async timeAsync<T>(name: string, operation: () => Promise<T>, detail: DevMetricDetail = {}): Promise<T> {
    if (!this.enabled) return operation();
    const startedAt = performance.now();
    try {
      return await operation();
    } finally {
      this.recordTiming(name, performance.now() - startedAt, detail);
    }
  }

  public report(): DevPerformanceReport {
    if (!this.enabled) return emptyPerformanceReport('disabled');
    if (this.hasStats()) return this.flush('manual');
    return this.lastReport ?? emptyPerformanceReport('manual');
  }

  private computeDevConsoleEnabled(): boolean {
    if (!isDevRendererRuntime()) return false;
    const queryValue = queryOptInValue();
    if (queryValue === '1' || queryValue === 'true') {
      writeOptIn(true);
      return true;
    }
    if (queryValue === '0' || queryValue === 'false') {
      writeOptIn(false);
      return false;
    }
    return readOptIn();
  }

  private installControls(): void {
    if (!isDevRendererRuntime()) return;
    const target = window as BealeDevPerformanceWindow;
    target.bealeDevPerformance = {
      enable: () => {
        writeOptIn(true);
        this.devConsoleEnabled = true;
        this.syncEnabled();
        this.announce();
        this.ensureFlushTimer();
        console.info('[Beale perf] Enabled. Reload to capture mount-time render probes.');
      },
      disable: () => {
        writeOptIn(false);
        this.devConsoleEnabled = false;
        this.syncEnabled();
        console.info('[Beale perf] Disabled.');
      },
      report: () => this.report(),
      status: () => ({ available: isDevRendererRuntime(), enabled: this.enabled, optIn: readOptIn() })
    };
  }

  private syncEnabled(): void {
    const nextEnabled = this.devConsoleEnabled || this.profilingEnabled;
    if (nextEnabled === this.enabled) {
      if (nextEnabled) this.ensureFlushTimer();
      return;
    }

    this.enabled = nextEnabled;
    if (this.enabled) {
      this.ensureFlushTimer();
      return;
    }

    this.clearFlushTimer();
    this.renderStats.clear();
    this.timingStats.clear();
    this.eventStats.clear();
    this.lastReport = null;
  }

  private announce(): void {
    if (this.announced) return;
    this.announced = true;
    console.info('[Beale perf] Developer instrumentation enabled. Use window.bealeDevPerformance.report() for a returned report object.');
  }

  private ensureFlushTimer(): void {
    if (!this.enabled || this.flushTimer !== null || typeof window === 'undefined') return;
    this.flushTimer = window.setInterval(() => this.flush('interval'), DEV_INSTRUMENTATION_FLUSH_MS);
  }

  private clearFlushTimer(): void {
    if (this.flushTimer === null || typeof window === 'undefined') return;
    window.clearInterval(this.flushTimer);
    this.flushTimer = null;
  }

  private hasStats(): boolean {
    return this.renderStats.size > 0 || this.timingStats.size > 0 || this.eventStats.size > 0;
  }

  private flush(reason: 'interval' | 'manual'): DevPerformanceReport {
    if (!this.enabled) return emptyPerformanceReport('disabled');
    if (!this.hasStats()) return this.lastReport ?? emptyPerformanceReport(reason);

    const report = this.buildReport(reason);
    if (this.devConsoleEnabled) {
      console.groupCollapsed(`[Beale perf] ${reason} ${new Date().toLocaleTimeString()}`);
      if (report.renders.length > 0) {
        console.table(
          report.renders.map((row) => ({
            ...row,
            detail: formatDetail(row.detail)
          }))
        );
      }
      if (report.timings.length > 0) {
        console.table(
          report.timings.map((row) => ({
            ...row,
            detail: formatDetail(row.detail)
          }))
        );
      }
      if (report.events.length > 0) {
        console.table(
          report.events.map((row) => ({
            ...row,
            detail: formatDetail(row.detail)
          }))
        );
      }
      console.groupEnd();
    }

    this.renderStats.clear();
    this.timingStats.clear();
    this.eventStats.clear();
    this.lastReport = report;
    this.reportSink?.(report);
    return report;
  }

  private buildReport(reason: 'interval' | 'manual'): ProfilingReport {
    const renders: ProfilingRenderReportRow[] = Array.from(this.renderStats.entries()).map(([surface, stat]) => ({
      surface,
      renders: stat.count,
      lastRender: stat.lastRender,
      detail: stat.detail
    }));
    const timings: ProfilingTimingReportRow[] = Array.from(this.timingStats.entries()).map(([name, stat]) => ({
      name,
      count: stat.count,
      avgMs: roundMs(stat.totalMs / stat.count),
      maxMs: roundMs(stat.maxMs),
      lastMs: roundMs(stat.lastMs),
      detail: stat.detail
    }));
    const events: ProfilingEventReportRow[] = Array.from(this.eventStats.entries()).map(([name, stat]) => ({
      name,
      count: stat.count,
      detail: stat.detail
    }));
    return {
      enabled: true,
      empty: renders.length === 0 && timings.length === 0 && events.length === 0,
      reason,
      generatedAt: new Date().toISOString(),
      renders,
      timings,
      events
    };
  }
}

export const devInstrumentation = new RendererDevInstrumentation();

export function useDevRenderProbe(surface: string, detail?: DevMetricDetail | (() => DevMetricDetail)): void {
  const renderCountRef = useRef(0);
  renderCountRef.current += 1;

  useEffect(() => {
    if (!devInstrumentation.isEnabled()) return;
    devInstrumentation.recordRender(surface, renderCountRef.current, typeof detail === 'function' ? detail() : detail);
  });
}

export function useDevInputLatencyProbe(): void {
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    let pending = false;

    const handleInputSignal = (event: Event): void => {
      if (!devInstrumentation.isEnabled()) return;
      if (pending) return;
      pending = true;
      const startedAt = performance.now();
      window.requestAnimationFrame(() => {
        pending = false;
        devInstrumentation.recordTiming('input.nextFrameLatency', performance.now() - startedAt, {
          event: event.type,
          target: eventTargetLabel(event.target)
        });
      });
    };

    window.addEventListener('beforeinput', handleInputSignal, true);
    window.addEventListener('keydown', handleInputSignal, true);
    window.addEventListener('pointerdown', handleInputSignal, true);
    return () => {
      window.removeEventListener('beforeinput', handleInputSignal, true);
      window.removeEventListener('keydown', handleInputSignal, true);
      window.removeEventListener('pointerdown', handleInputSignal, true);
    };
  }, []);
}

export function approximateSerializedSizeBytes(value: unknown): number {
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return 0;
  }
}

function isDevRendererRuntime(): boolean {
  if (typeof window === 'undefined') return false;
  const { hostname, protocol } = window.location;
  return protocol === 'http:' && (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]');
}

function queryOptInValue(): string | null {
  try {
    return new URLSearchParams(window.location.search).get(DEV_INSTRUMENTATION_QUERY_KEY);
  } catch {
    return null;
  }
}

function readOptIn(): boolean {
  try {
    return window.localStorage.getItem(DEV_INSTRUMENTATION_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeOptIn(enabled: boolean): void {
  try {
    if (enabled) {
      window.localStorage.setItem(DEV_INSTRUMENTATION_STORAGE_KEY, '1');
    } else {
      window.localStorage.removeItem(DEV_INSTRUMENTATION_STORAGE_KEY);
    }
  } catch {
    // Ignore storage failures in dev-only instrumentation.
  }
}

function emptyPerformanceReport(reason: 'manual' | 'interval' | 'disabled'): DevPerformanceReport {
  return {
    enabled: reason !== 'disabled',
    empty: true,
    reason,
    generatedAt: new Date().toISOString(),
    renders: [],
    timings: [],
    events: []
  };
}

function normalizeDetail(detail: DevMetricDetail | undefined): DevMetricDetail {
  if (!detail) return {};
  return Object.fromEntries(Object.entries(detail).filter(([, value]) => value !== undefined));
}

function formatDetail(detail: DevMetricDetail): string {
  const entries = Object.entries(detail).filter(([, value]) => value !== undefined);
  if (entries.length === 0) return '';
  return entries.map(([key, value]) => `${key}=${String(value)}`).join(' ');
}

function roundMs(value: number): number {
  return Math.round(value * 10) / 10;
}

function eventTargetLabel(target: EventTarget | null): string {
  if (!(target instanceof Element)) return 'unknown';
  const role = target.getAttribute('role');
  const type = target instanceof HTMLInputElement || target instanceof HTMLButtonElement ? target.type : null;
  return [target.tagName.toLowerCase(), type, role].filter(Boolean).join(':');
}
