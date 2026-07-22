import { memo } from 'react';
import type { JSX } from 'react';
import { Settings } from 'lucide-react';

export const StatusBar = memo(function StatusBar({
  onOpenSettings
}: {
  onOpenSettings: () => void;
}): JSX.Element {
  return (
    <footer className="status-bar" aria-label="Application settings">
      <button type="button" className="sidebar-utility-button status-settings-button" title="Settings" aria-label="Settings" onClick={onOpenSettings}>
        <Settings size={15} />
        <span>Settings</span>
      </button>
    </footer>
  );
});
