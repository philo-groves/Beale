import type { HostEnvironment, RunDetail } from '@shared/types';
import { traceCategoryForEvent } from '../traceClassification';

export interface EnvironmentActivity {
  host: boolean;
  guest: boolean;
}

export function hostEnvironmentLabel(hostEnvironment: HostEnvironment | null): string {
  if (!hostEnvironment) return 'Host OS';
  if (hostEnvironment.osLabel) return hostEnvironment.osLabel;
  if (hostEnvironment.isWsl) return `WSL: ${hostEnvironment.remoteName ?? 'Linux'}`;
  if (hostEnvironment.platform === 'win32') return 'Windows';
  if (hostEnvironment.platform === 'darwin') return 'macOS';
  if (hostEnvironment.platform === 'linux') return 'Linux';
  return 'Host OS';
}

export function environmentActivityForDetail(detail: RunDetail | null): EnvironmentActivity {
  if (!detail || detail.run.status !== 'active') return { host: false, guest: false };
  const latest = detail.traceEvents.at(-1);
  if (!latest) return { host: true, guest: false };
  const category = traceCategoryForEvent(latest);

  if (latest.source === 'executor' || latest.type === 'vm_event' || category === 'vm_execution' || category === 'tools' || category === 'verifier' || category === 'code_navigation') {
    return { host: true, guest: false };
  }

  if (latest.source === 'model' || latest.source === 'policy' || latest.source === 'system' || latest.source === 'user') {
    return { host: true, guest: false };
  }

  return { host: true, guest: false };
}
