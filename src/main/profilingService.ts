import { appendFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProfilingMetricDetail, ProfilingReport, ProfilingState } from '@shared/types';

const PROFILING_SCHEMA_VERSION = 1;

type ProfilingRecord =
  | {
      schemaVersion: number;
      type: 'profiling_session_started' | 'profiling_session_stopped';
      at: string;
      pid: number;
    }
  | {
      schemaVersion: number;
      type: 'renderer_report';
      receivedAt: string;
      pid: number;
      report: ProfilingReport;
    }
  | {
      schemaVersion: number;
      type: 'main_timing';
      receivedAt: string;
      pid: number;
      name: string;
      durationMs: number;
      detail: ProfilingMetricDetail;
    };

export class ProfilingService {
  private enabled = false;
  private outputPath: string | null = null;
  private startedAt: string | null = null;
  private updatedAt: string | null = null;
  private lastReportAt: string | null = null;
  private reportCount = 0;

  public constructor(private readonly outputDirectory = join(tmpdir(), 'beale-profiling')) {}

  public getState(): ProfilingState {
    return {
      enabled: this.enabled,
      outputPath: this.outputPath,
      startedAt: this.startedAt,
      updatedAt: this.updatedAt,
      lastReportAt: this.lastReportAt,
      reportCount: this.reportCount
    };
  }

  public applyPreference(enabled: boolean): ProfilingState {
    if (enabled === this.enabled) return this.getState();
    return this.setEnabled(enabled);
  }

  public setEnabled(enabled: boolean): ProfilingState {
    if (enabled === this.enabled) return this.getState();

    if (enabled) {
      this.enabled = true;
      this.startedAt = nowIso();
      this.updatedAt = this.startedAt;
      this.lastReportAt = null;
      this.reportCount = 0;
      this.outputPath = this.createOutputPath(this.startedAt);
      this.appendRecord({
        schemaVersion: PROFILING_SCHEMA_VERSION,
        type: 'profiling_session_started',
        at: this.startedAt,
        pid: process.pid
      });
      return this.getState();
    }

    const stoppedAt = nowIso();
    if (this.outputPath) {
      this.appendRecord({
        schemaVersion: PROFILING_SCHEMA_VERSION,
        type: 'profiling_session_stopped',
        at: stoppedAt,
        pid: process.pid
      });
    }
    this.enabled = false;
    this.updatedAt = stoppedAt;
    return this.getState();
  }

  public recordRendererReport(report: ProfilingReport): ProfilingState {
    if (!this.enabled || report.empty) return this.getState();

    const receivedAt = nowIso();
    this.appendRecord({
      schemaVersion: PROFILING_SCHEMA_VERSION,
      type: 'renderer_report',
      receivedAt,
      pid: process.pid,
      report
    });
    this.lastReportAt = receivedAt;
    this.updatedAt = receivedAt;
    this.reportCount += 1;
    return this.getState();
  }

  public recordMainTiming(name: string, durationMs: number, detail: ProfilingMetricDetail = {}): ProfilingState {
    if (!this.enabled) return this.getState();

    const receivedAt = nowIso();
    this.appendRecord({
      schemaVersion: PROFILING_SCHEMA_VERSION,
      type: 'main_timing',
      receivedAt,
      pid: process.pid,
      name,
      durationMs: roundMs(durationMs),
      detail
    });
    this.updatedAt = receivedAt;
    return this.getState();
  }

  public dispose(): void {
    if (this.enabled) {
      this.setEnabled(false);
    }
  }

  private createOutputPath(startedAt: string): string {
    mkdirSync(this.outputDirectory, { recursive: true });
    const safeTimestamp = startedAt.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z').toLowerCase();
    return join(this.outputDirectory, `beale-profile-${safeTimestamp}-${process.pid}.jsonl`);
  }

  private appendRecord(record: ProfilingRecord): void {
    if (!this.outputPath) return;
    appendFileSync(this.outputPath, `${JSON.stringify(record)}\n`, 'utf8');
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function roundMs(value: number): number {
  return Math.round(value * 10) / 10;
}
