import type { ExecutorBackendKind, ExecutorBackendStatus, ExecutorStatus, HostEnvironment, RunDetail, VmPreference } from '@shared/types';
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

export function vmTargetStatus(executor: ExecutorStatus | null, vmPreference: VmPreference): { configured: boolean; showConfigure: boolean; label: string; title: string } {
  if (!vmPreference.enabled || !vmPreference.backendKind) {
    return {
      configured: false,
      showConfigure: true,
      label: 'None',
      title: 'No local VM is enabled. Configure a VM to run target commands in a disposable guest.'
    };
  }

  const backend = findBackendByKind(executor, vmPreference.backendKind);
  if (backend) {
    const available = backend.available && executor?.available === true;
    return {
      configured: available,
      showConfigure: !available,
      label: backend.label,
      title: available ? `${backend.label} is enabled` : executor?.reason ?? backend.reason ?? `${backend.label} is enabled but unavailable`
    };
  }

  return {
    configured: false,
    showConfigure: true,
    label: 'Unavailable',
    title: 'The enabled local VM backend is no longer reported by this host.'
  };
}

export function findBackendByKind(executor: ExecutorStatus | null, backendKind: ExecutorBackendKind | null): ExecutorBackendStatus | null {
  if (!backendKind) return null;
  return executor?.backends.find((candidate) => candidate.kind === backendKind) ?? null;
}

export function environmentActivityForDetail(detail: RunDetail | null): EnvironmentActivity {
  if (!detail || detail.run.status !== 'active') return { host: false, guest: false };
  const latest = detail.traceEvents.at(-1);
  if (!latest) return { host: true, guest: false };
  const category = traceCategoryForEvent(latest);

  if (latest.source === 'executor' || latest.type === 'vm_event' || category === 'vm_execution' || category === 'tools' || category === 'verifier' || category === 'code_navigation') {
    return { host: false, guest: true };
  }

  if (latest.source === 'model' || latest.source === 'policy' || latest.source === 'system' || latest.source === 'user') {
    return { host: true, guest: false };
  }

  return { host: true, guest: false };
}
