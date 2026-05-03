import { memo } from 'react';
import type { JSX } from 'react';
import type { RunDetail } from '@shared/types';
import { displaySessionTitle } from '../../shared/sessionTitle';
import { useDevRenderProbe } from '../devInstrumentation';
import { displayProgramHeaderName } from '../view-models/appHeader';

export const AppHeaderTitle = memo(function AppHeaderTitle({
  programName,
  detail,
  onOpenResearchPrompt
}: {
  programName: string;
  detail: RunDetail | null;
  onOpenResearchPrompt: (detail: RunDetail) => void;
}): JSX.Element {
  const programLabel = displayProgramHeaderName(programName);
  const sessionTitle = detail ? displaySessionTitle(detail.run.title, detail.run.promptMarkdown) : null;
  useDevRenderProbe('appHeaderTitle', () => ({ program: programLabel, run: detail?.run.id ?? 'none' }));

  return (
    <div className="app-header-title" aria-label="Current program and session">
      <span className="app-header-program-title">{programLabel}</span>
      {detail && sessionTitle ? (
        <>
          <span className="app-header-title-separator" aria-hidden="true" />
          <button type="button" className="app-header-session-title" title="View original research prompt" onClick={() => onOpenResearchPrompt(detail)}>
            <span>{sessionTitle}</span>
          </button>
        </>
      ) : null}
    </div>
  );
});
