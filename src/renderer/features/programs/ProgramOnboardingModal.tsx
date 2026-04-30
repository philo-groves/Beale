import { useState } from 'react';
import type { JSX } from 'react';
import { Modal } from '../../app/Modal';
import { errorMessage } from '../../lib/errors';
import { emptyDateClass } from '../../lib/formatting';
import { templateLabel, type ProgramOnboardingFormState, type ProgramTemplateKind } from '../../view-models/programOnboarding';

export function ProgramOnboardingModal({
  form,
  busy,
  onChange,
  onCancel,
  onLookupHackerOne,
  onTemplate,
  onSubmit
}: {
  form: ProgramOnboardingFormState;
  busy: boolean;
  onChange: (next: ProgramOnboardingFormState) => void;
  onCancel: () => void;
  onLookupHackerOne: (identifier: string) => Promise<void>;
  onTemplate: (templateKind: ProgramTemplateKind) => void;
  onSubmit: () => void;
}): JSX.Element {
  const [hackerOneIdentifier, setHackerOneIdentifier] = useState('');
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const update = (key: keyof ProgramOnboardingFormState, value: string): void => {
    onChange({ ...form, [key]: value });
  };
  const canSubmit = form.programName.trim().length > 0;
  const lookupHackerOne = (): void => {
    if (!hackerOneIdentifier.trim()) return;
    setLookupBusy(true);
    setLookupError(null);
    onLookupHackerOne(hackerOneIdentifier)
      .catch((caught: unknown) => setLookupError(errorMessage(caught)))
      .finally(() => setLookupBusy(false));
  };

  return (
    <Modal
      title="New Program"
      onClose={onCancel}
      footer={
        <>
          <button type="button" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          <button className="primary-button" type="submit" form="program-onboarding-form" disabled={busy || lookupBusy || !canSubmit}>
            {lookupBusy ? 'Importing Program...' : 'Create Program'}
          </button>
        </>
      }
    >
      <form
        id="program-onboarding-form"
        className="modal-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit) onSubmit();
        }}
      >
        <label>
          Workspace directory
          <input value={form.workspacePath} readOnly />
        </label>
        <div className="template-toggle-row" role="group" aria-label="Program template">
          {(['manual', 'hackerone', 'apple', 'msrc'] as ProgramTemplateKind[]).map((templateKind) => (
            <button
              type="button"
              className={`template-toggle ${form.templateKind === templateKind ? 'active' : ''}`}
              key={templateKind}
              onClick={() => onTemplate(templateKind)}
            >
              {templateLabel(templateKind)}
            </button>
          ))}
        </div>
        {form.templateKind === 'hackerone' ? (
          <div className="hackerone-lookup">
            <label>
              Program Identifier
              <input value={hackerOneIdentifier} placeholder="github" onChange={(event) => setHackerOneIdentifier(event.target.value)} />
            </label>
            <button type="button" disabled={busy || lookupBusy || !hackerOneIdentifier.trim()} onClick={lookupHackerOne}>
              {lookupBusy ? 'Loading...' : 'Look Up'}
            </button>
            {lookupError ? <div className="error-box">{lookupError}</div> : null}
          </div>
        ) : null}
        <div className="form-grid">
          <label>
            Program name
            <input value={form.programName} onChange={(event) => update('programName', event.target.value)} autoFocus />
          </label>
          <label>
            Organization (optional)
            <input value={form.organizationName} onChange={(event) => update('organizationName', event.target.value)} />
          </label>
        </div>
        <label>
          Description
          <textarea rows={3} value={form.descriptionMarkdown} onChange={(event) => update('descriptionMarkdown', event.target.value)} />
        </label>
        <div className="form-grid">
          <label>
            Network
            <select value={form.networkProfile} onChange={(event) => update('networkProfile', event.target.value)}>
              <option value="offline">offline</option>
              <option value="scoped">scoped</option>
              <option value="elevated">elevated</option>
            </select>
          </label>
          <label>
            Authorization expires (empty = never)
            <input type="date" className={emptyDateClass(form.expiresAt)} value={form.expiresAt} onChange={(event) => update('expiresAt', event.target.value)} />
          </label>
        </div>
        <label>
          Scope and Rules
          <textarea rows={3} value={form.rulesMarkdown} onChange={(event) => update('rulesMarkdown', event.target.value)} />
        </label>
      </form>
    </Modal>
  );
}
