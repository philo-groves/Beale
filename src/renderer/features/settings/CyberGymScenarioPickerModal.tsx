import { useMemo, useState, type JSX } from 'react';
import { Search } from 'lucide-react';
import type { CyberGymScenarioList, CyberGymScenarioSummary } from '@shared/types';
import { Modal } from '../../app/Modal';

const CYBERGYM_RESULT_LIMIT = 80;
type CyberGymSortField = 'id' | 'projectName' | 'source' | 'description';
type CyberGymSortDirection = 'asc' | 'desc';

const CYBERGYM_COLUMNS: Array<{ field: CyberGymSortField; label: string; className: string }> = [
  { field: 'id', label: 'Task ID', className: 'task' },
  { field: 'projectName', label: 'Project', className: 'project' },
  { field: 'source', label: 'Source', className: 'source' },
  { field: 'description', label: 'Description', className: 'description' }
];

const CYBERGYM_SCENARIO_WARNINGS: Array<{ projectName: string; message: string }> = [
  {
    projectName: 'ffmpeg',
    message: 'Warning: ffmpeg benchmark runs have been reported to trigger cyber abuse violations. Review provider policy and run conditions before benchmarking this scenario.'
  }
];

export function CyberGymScenarioPickerModal({
  activeScenarioId,
  busy,
  scenarioList,
  onClose,
  onSelect
}: {
  activeScenarioId: string;
  busy: boolean;
  scenarioList: CyberGymScenarioList | null;
  onClose: () => void;
  onSelect: (scenario: CyberGymScenarioSummary) => void;
}): JSX.Element {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<{ field: CyberGymSortField; direction: CyberGymSortDirection }>({ field: 'id', direction: 'asc' });
  const scenarios = scenarioList?.scenarios ?? [];
  const filtered = useMemo(() => filterCyberGymScenarios(scenarios, query), [query, scenarios]);
  const sorted = useMemo(() => sortCyberGymScenarios(filtered, sort.field, sort.direction), [filtered, sort.direction, sort.field]);
  const visible = sorted.slice(0, CYBERGYM_RESULT_LIMIT);

  const changeSort = (field: CyberGymSortField): void => {
    setSort((current) => ({
      field,
      direction: current.field === field && current.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  return (
    <Modal
      title="CyberGym Scenarios"
      wide
      onClose={onClose}
      footer={
        <button type="button" onClick={onClose}>
          Done
        </button>
      }
    >
      <div className="cybergym-picker">
        <label className="cybergym-search-field">
          <Search size={15} />
          <input
            autoFocus
            type="search"
            value={query}
            placeholder="Search task id, project, source, tags, or description"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className="cybergym-picker-summary">
          <span>{scenarioSourceLabel(scenarioList)}</span>
          <strong>
            {filtered.length.toLocaleString()} of {scenarios.length.toLocaleString()} scenario{scenarios.length === 1 ? '' : 's'}
          </strong>
        </div>
        <div className="cybergym-picker-refresh">
          <span>Last Refreshed</span>
          <strong>{lastRefreshedLabel(scenarioList)}</strong>
        </div>
        <div className="cybergym-scenario-table-wrap">
          {!scenarioList ? (
            <div className="cybergym-empty-state">Loading CyberGym scenarios...</div>
          ) : visible.length > 0 ? (
            <table className="cybergym-scenario-table">
              <thead>
                <tr>
                  {CYBERGYM_COLUMNS.map((column) => (
                    <th className={`col-${column.className}`} key={column.field} scope="col" aria-sort={sort.field === column.field ? ariaSortValue(sort.direction) : 'none'}>
                      <button type="button" onClick={() => changeSort(column.field)}>
                        <span>{column.label}</span>
                        <span className="cybergym-sort-indicator">{sort.field === column.field ? sortIndicator(sort.direction) : 'Sort'}</span>
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((scenario) => (
                  <tr className={activeScenarioId === scenario.id ? 'selected' : ''} key={scenario.id}>
                    <td className="col-task">
                      <button type="button" disabled={busy} onClick={() => onSelect(scenario)}>
                        {scenario.id}
                      </button>
                    </td>
                    <td className="col-project">{scenario.projectName}</td>
                    <td className="col-source">{scenario.source}</td>
                    <td className="col-description">
                      <strong>{scenario.title}</strong>
                      {scenario.description ? <span>{scenario.description}</span> : null}
                      {scenarioWarning(scenario) ? <span className="cybergym-scenario-warning">{scenarioWarning(scenario)}</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="cybergym-empty-state">No matching CyberGym scenarios.</div>
          )}
        </div>
        {filtered.length > visible.length ? (
          <p className="cybergym-picker-truncation">
            Showing first {visible.length.toLocaleString()} matches. Narrow the search to choose from the rest.
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

function sortIndicator(direction: CyberGymSortDirection): string {
  return direction === 'asc' ? 'Ascending' : 'Descending';
}

function ariaSortValue(direction: CyberGymSortDirection): 'ascending' | 'descending' {
  return direction === 'asc' ? 'ascending' : 'descending';
}

function sortCyberGymScenarios(
  scenarios: CyberGymScenarioSummary[],
  field: CyberGymSortField,
  direction: CyberGymSortDirection
): CyberGymScenarioSummary[] {
  const multiplier = direction === 'asc' ? 1 : -1;
  return scenarios.slice().sort((left, right) => {
    const compared = sortValue(left, field).localeCompare(sortValue(right, field), undefined, { numeric: true, sensitivity: 'base' });
    if (compared !== 0) return compared * multiplier;
    return left.id.localeCompare(right.id, undefined, { numeric: true, sensitivity: 'base' });
  });
}

function sortValue(scenario: CyberGymScenarioSummary, field: CyberGymSortField): string {
  return String(scenario[field] ?? '');
}

function scenarioWarning(scenario: CyberGymScenarioSummary): string | null {
  const warning = CYBERGYM_SCENARIO_WARNINGS.find((item) => item.projectName.toLowerCase() === scenario.projectName.toLowerCase());
  return warning?.message ?? null;
}

function filterCyberGymScenarios(scenarios: CyberGymScenarioSummary[], query: string): CyberGymScenarioSummary[] {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean);
  if (terms.length === 0) return scenarios;
  return scenarios.filter((scenario) => {
    const haystack = [
      scenario.id,
      scenario.title,
      scenario.projectName,
      scenario.source,
      scenario.difficulty,
      scenario.description,
      scenario.searchText,
      ...scenario.tags
    ]
      .join(' ')
      .toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

function scenarioSourceLabel(list: CyberGymScenarioList | null): string {
  if (!list) return 'Loading scenarios';
  if (list.source === 'project_tasks_json') return list.sourcePath ? `Loaded from ${list.sourcePath}` : 'Loaded from Beale benchmark catalog';
  return 'Using documented CyberGym subset until benchmarks/tasks_YYYYMMDD.json is available';
}

function lastRefreshedLabel(list: CyberGymScenarioList | null): string {
  if (!list) return 'Loading';
  if (!list.lastRefreshedAt) return 'Unknown';
  const date = new Date(`${list.lastRefreshedAt}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return list.lastRefreshedAt;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' }).format(date);
}
