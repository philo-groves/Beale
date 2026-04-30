import type { ExecutorBackendKind, ExecutorBackendStatus, ExecutorStatus, HostEnvironment, VmPreference } from '@shared/types';

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
