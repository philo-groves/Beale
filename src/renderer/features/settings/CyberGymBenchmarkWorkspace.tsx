import { useEffect, useMemo, useState, type JSX } from 'react';
import { Play, Search, ShieldAlert } from 'lucide-react';
import type {
  BenchmarkComparison,
  BenchmarkOverview,
  BenchmarkRunRecord,
  BenchmarkTaskResultRecord,
  CyberGymLevel,
  CyberGymScenarioList,
  CyberGymScenarioRunStartResult,
  CyberGymScenarioSummary,
  ExecutorStatus,
  OpenAiAccountStatus,
  StartRunInput,
  VmPreference,
  WorkspaceSnapshot
} from '@shared/types';
import { CYBERGYM_LEVELS } from '@shared/cybergymPrompt';
import { Modal } from '../../app/Modal';
import { formatSessionDateTime } from '../../lib/formatting';
import { defaultRunInput, optionalPositiveInteger, UNBOUNDED_MINUTES } from '../../view-models/runSettings';
import { preferredSandboxProfile, SessionSettingsFields } from '../sessions/StartRunForm';
import type { CyberGymMainView } from './cyberGymViews';

const CYBERGYM_RESULT_LIMIT = 120;

const CYBERGYM_SCENARIO_WARNINGS: Array<{ projectName: string; message: string }> = [
  {
    projectName: 'ffmpeg',
    message: 'Warning: ffmpeg benchmark runs have been reported to trigger cyber abuse violations. Review provider policy and run conditions before benchmarking this scenario.'
  }
];

interface CyberGymRunSummary {
  id: string;
  label: string;
  shortLabel: string;
  harnessName: string;
  model: string;
  createdAt: string;
  passCount: number;
  failCount: number;
  inconclusiveCount: number;
  totalCount: number;
  passRate: number;
  tokenCount: number | null;
  wallTimeMs: number | null;
  timeToFindingMs: number | null;
  warning: string | null;
}

interface CyberGymAnalysisOverview {
  totalTasks: number;
  latestPassRate: number | null;
  latestRunLabel: string;
  bestPassRate: number | null;
  bestRunLabel: string;
  averageTimeToFindingMs: number | null;
  averageTokens: number | null;
  warning: string | null;
}

interface ScenarioMetricPoint {
  id: string;
  label: string;
  value: number;
}

interface ScenarioMetricSeries {
  id: string;
  title: string;
  points: ScenarioMetricPoint[];
  formatValue: (value: number | null) => string;
}

export function CyberGymBenchmarkWorkspace({
  benchmark,
  busy,
  executor,
  scenarioList,
  selectedScenarioId,
  openAiStatus,
  snapshot,
  vmPreference,
  view,
  onRefreshScenarios,
  onOpenStartedRun,
  onSelectScenario,
  runAction
}: {
  benchmark: BenchmarkOverview | null;
  busy: boolean;
  executor: ExecutorStatus | null;
  scenarioList: CyberGymScenarioList | null;
  selectedScenarioId: string;
  openAiStatus: OpenAiAccountStatus | null;
  snapshot: WorkspaceSnapshot | null;
  vmPreference: VmPreference;
  view: CyberGymMainView;
  onRefreshScenarios: () => void;
  onOpenStartedRun: (result: CyberGymScenarioRunStartResult) => void;
  onSelectScenario: (scenario: CyberGymScenarioSummary) => void;
  runAction: (action: () => Promise<WorkspaceSnapshot | null | void>) => Promise<void>;
}): JSX.Element {
  if (view === 'analysis') {
    return <CyberGymBenchmarkAnalysis benchmark={benchmark} />;
  }

  return (
    <CyberGymScenarioRunList
      benchmark={benchmark}
      busy={busy}
      executor={executor}
      scenarioList={scenarioList}
      selectedScenarioId={selectedScenarioId}
      openAiStatus={openAiStatus}
      snapshot={snapshot}
      vmPreference={vmPreference}
      onRefreshScenarios={onRefreshScenarios}
      onOpenStartedRun={onOpenStartedRun}
      onSelectScenario={onSelectScenario}
      runAction={runAction}
    />
  );
}

function CyberGymScenarioRunList({
  benchmark,
  busy,
  executor,
  scenarioList,
  selectedScenarioId,
  openAiStatus,
  snapshot,
  vmPreference,
  onRefreshScenarios,
  onOpenStartedRun,
  onSelectScenario,
  runAction
}: {
  benchmark: BenchmarkOverview | null;
  busy: boolean;
  executor: ExecutorStatus | null;
  scenarioList: CyberGymScenarioList | null;
  selectedScenarioId: string;
  openAiStatus: OpenAiAccountStatus | null;
  snapshot: WorkspaceSnapshot | null;
  vmPreference: VmPreference;
  onRefreshScenarios: () => void;
  onOpenStartedRun: (result: CyberGymScenarioRunStartResult) => void;
  onSelectScenario: (scenario: CyberGymScenarioSummary) => void;
  runAction: (action: () => Promise<WorkspaceSnapshot | null | void>) => Promise<void>;
}): JSX.Element {
  const [query, setQuery] = useState('');
  const [scenarioToRun, setScenarioToRun] = useState<CyberGymScenarioSummary | null>(null);
  const scenarios = scenarioList?.scenarios ?? [];
  const filtered = useMemo(() => filterCyberGymScenarios(scenarios, query), [query, scenarios]);
  const visible = filtered.slice(0, CYBERGYM_RESULT_LIMIT);
  const selectedScenario = useMemo(
    () => scenarios.find((scenario) => scenario.id === selectedScenarioId) ?? null,
    [scenarios, selectedScenarioId]
  );

  return (
    <div className="cybergym-workspace cybergym-scenario-workspace">
      <section className="cybergym-scenarios-panel" aria-label="CyberGym scenarios">
        <div className="cybergym-workspace-heading">
          <div>
            <h3>CyberGym Scenarios</h3>
            <p>{scenarioSourceLabel(scenarioList)}</p>
          </div>
          <button type="button" disabled={busy} onClick={onRefreshScenarios}>
            Refresh
          </button>
        </div>
        <div className="cybergym-picker-summary">
          <span>Last Refreshed: {lastRefreshedLabel(scenarioList)}</span>
          <strong>
            {filtered.length.toLocaleString()} of {scenarios.length.toLocaleString()} scenario{scenarios.length === 1 ? '' : 's'}
          </strong>
        </div>
        <label className="cybergym-search-field">
          <Search size={15} />
          <input
            type="search"
            value={query}
            placeholder="Search task id, project, source, tags, or description"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className="cybergym-scenario-list-wrap">
          {!scenarioList ? (
            <div className="cybergym-empty-state">Loading CyberGym scenarios...</div>
          ) : visible.length > 0 ? (
            <div className="cybergym-scenario-list">
              {visible.map((scenario) => (
                <button
                  type="button"
                  className={`cybergym-scenario-row ${selectedScenarioId === scenario.id ? 'selected' : ''}`}
                  disabled={busy}
                  aria-pressed={selectedScenarioId === scenario.id}
                  key={scenario.id}
                  onClick={() => onSelectScenario(scenario)}
                >
                  <span className="cybergym-scenario-row-heading">
                    <strong>{scenario.projectName}</strong>
                    <span>{scenario.id}</span>
                    <span>{scenario.source}</span>
                  </span>
                  <span className="cybergym-scenario-row-description">{scenario.description || scenario.title}</span>
                  {scenarioWarning(scenario) ? <span className="cybergym-scenario-warning">{scenarioWarning(scenario)}</span> : null}
                </button>
              ))}
            </div>
          ) : (
            <div className="cybergym-empty-state">No matching CyberGym scenarios.</div>
          )}
        </div>
        {filtered.length > visible.length ? (
          <p className="cybergym-picker-truncation">
            Showing first {visible.length.toLocaleString()} matches. Narrow the search to choose from the rest.
          </p>
        ) : null}
      </section>
      <ScenarioRunMetricsPanel
        benchmark={benchmark}
        busy={busy}
        scenario={selectedScenario}
        selectedScenarioId={selectedScenarioId}
        onRunScenario={setScenarioToRun}
      />
      {scenarioToRun ? (
        <CyberGymRunScenarioModal
          busy={busy}
          openAiStatus={openAiStatus}
          scenario={scenarioToRun}
          executor={executor}
          snapshot={snapshot}
          vmPreference={vmPreference}
          onClose={() => setScenarioToRun(null)}
          onStarted={(result) => {
            setScenarioToRun(null);
            onOpenStartedRun(result);
          }}
          runAction={runAction}
        />
      ) : null}
    </div>
  );
}

function ScenarioRunMetricsPanel({
  benchmark,
  busy,
  scenario,
  selectedScenarioId,
  onRunScenario
}: {
  benchmark: BenchmarkOverview | null;
  busy: boolean;
  scenario: CyberGymScenarioSummary | null;
  selectedScenarioId: string;
  onRunScenario: (scenario: CyberGymScenarioSummary) => void;
}): JSX.Element {
  const results = useMemo(() => scenarioTaskResults(benchmark, scenario?.id ?? selectedScenarioId), [benchmark, scenario?.id, selectedScenarioId]);
  const series = useMemo(() => scenarioMetricSeries(results), [results]);
  const latest = results[results.length - 1] ?? null;
  const title = scenario?.projectName ?? 'No Scenario Selected';
  const subtitle = scenario ? `${scenario.id} / ${scenario.source}` : selectedScenarioId || 'Select a scenario to inspect run metrics.';
  const runDisabledReason = cyberGymRunDisabledReason({ busy, scenario });

  return (
    <aside className="cybergym-scenario-detail-panel" aria-label="Selected CyberGym scenario metrics">
      <div className="cybergym-scenario-detail-heading">
        <div>
          <h3>{title}</h3>
          <p>{subtitle}</p>
        </div>
        <div className="cybergym-scenario-detail-summary">
          <span>{results.length.toLocaleString()} run{results.length === 1 ? '' : 's'}</span>
          <strong>{latest ? latest.status : 'No results'}</strong>
        </div>
      </div>

      <div className="cybergym-scenario-detail-body">
        {scenario ? (
          <>
            <p className="cybergym-scenario-detail-description">{scenario.description || scenario.title}</p>
            {series.map((item) => (
              <ScenarioMetricGraph series={item} key={item.id} />
            ))}
          </>
        ) : (
          <div className="cybergym-empty-state">Select a CyberGym scenario to see collected run metrics over time.</div>
        )}
      </div>

      <div className="cybergym-run-scenario-action">
        <button
          type="button"
          className="cybergym-run-scenario-button"
          disabled={runDisabledReason !== null}
          aria-describedby={runDisabledReason ? 'cybergym-run-scenario-disabled-reason' : undefined}
          title={runDisabledReason ?? undefined}
          onClick={() => {
            if (scenario) onRunScenario(scenario);
          }}
        >
          Run Scenario
        </button>
        {runDisabledReason ? (
          <p className="cybergym-run-scenario-disabled-reason" id="cybergym-run-scenario-disabled-reason">
            {runDisabledReason}
          </p>
        ) : null}
      </div>
    </aside>
  );
}

function cyberGymRunDisabledReason({
  busy,
  scenario
}: {
  busy: boolean;
  scenario: CyberGymScenarioSummary | null;
}): string | null {
  if (busy) return 'Another workspace action is still running.';
  if (!scenario) return 'Select a scenario from the list first.';
  return null;
}

function ScenarioMetricGraph({ series }: { series: ScenarioMetricSeries }): JSX.Element {
  const latest = series.points[series.points.length - 1] ?? null;
  const width = 320;
  const height = 118;
  const left = 12;
  const right = 12;
  const top = 10;
  const bottom = 22;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const maxValue = series.id === 'score' ? 1 : Math.max(1, ...series.points.map((point) => point.value));
  const minValue = 0;
  const xFor = (index: number): number => left + (series.points.length === 1 ? plotWidth / 2 : (plotWidth * index) / Math.max(1, series.points.length - 1));
  const yFor = (value: number): number => {
    if (maxValue === minValue) return top + plotHeight / 2;
    return top + plotHeight * (1 - (value - minValue) / (maxValue - minValue));
  };
  const points = series.points.map((point, index) => ({ point, x: xFor(index), y: yFor(point.value) }));
  const pointString = points.map((point) => `${point.x},${point.y}`).join(' ');

  return (
    <article className="cybergym-scenario-metric-card">
      <div className="cybergym-scenario-metric-heading">
        <h4>{series.title}</h4>
        <strong>{latest ? series.formatValue(latest.value) : 'No data'}</strong>
      </div>
      {series.points.length > 0 ? (
        <svg className="cybergym-scenario-metric-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${series.title} over time`}>
          {[0, 0.5, 1].map((tick) => {
            const value = minValue + (maxValue - minValue) * tick;
            const y = yFor(value);
            return <line className="cybergym-chart-grid" x1={left} x2={width - right} y1={y} y2={y} key={tick} />;
          })}
          <polyline className="cybergym-chart-line" points={pointString} />
          {points.map((point) => (
            <g key={point.point.id}>
              <circle className="cybergym-chart-point" cx={point.x} cy={point.y} r={3.5} />
              <title>
                {point.point.label}: {series.formatValue(point.point.value)}
              </title>
            </g>
          ))}
          <text className="cybergym-chart-axis-label" x={left} y={height - 6}>
            {series.points[0].label}
          </text>
          <text className="cybergym-chart-axis-label end" x={width - right} y={height - 6}>
            {series.points[series.points.length - 1].label}
          </text>
        </svg>
      ) : (
        <div className="cybergym-scenario-metric-empty">No collected values yet.</div>
      )}
    </article>
  );
}

function CyberGymRunScenarioModal({
  busy,
  openAiStatus,
  scenario,
  executor,
  snapshot,
  vmPreference,
  onClose,
  onStarted,
  runAction
}: {
  busy: boolean;
  openAiStatus: OpenAiAccountStatus | null;
  scenario: CyberGymScenarioSummary;
  executor: ExecutorStatus | null;
  snapshot: WorkspaceSnapshot | null;
  vmPreference: VmPreference;
  onClose: () => void;
  onStarted: (result: CyberGymScenarioRunStartResult) => void;
  runAction: (action: () => Promise<WorkspaceSnapshot | null | void>) => Promise<void>;
}): JSX.Element {
  const sandboxProfile = preferredSandboxProfile(executor, vmPreference);
  const [level, setLevel] = useState<CyberGymLevel>(3);
  const [input, setInput] = useState<StartRunInput>(() => ({
    ...defaultRunInput,
    mode: 'dynamic',
    attemptStrategy: 'adaptive_portfolio',
    networkProfile: 'offline',
    sandboxProfile
  }));
  const [startingRun, setStartingRun] = useState(false);

  useEffect(() => {
    setInput((current) => ({ ...current, sandboxProfile }));
  }, [sandboxProfile]);

  const update = <K extends keyof StartRunInput>(key: K, value: StartRunInput[K]): void => {
    setInput((current) => ({ ...current, [key]: value }));
  };

  const updateBudget = (key: keyof StartRunInput['budget'], value: number): void => {
    setInput((current) => ({ ...current, budget: { ...current.budget, [key]: value } }));
  };

  const minuteLimitValue = input.budget.maxMinutes >= UNBOUNDED_MINUTES ? '' : String(input.budget.maxMinutes);
  const openAiBlocked = input.runEngine === 'openai_responses' && openAiStatus?.configured === false;

  const start = (): void => {
    if (startingRun || openAiBlocked) return;
    setStartingRun(true);
    void runAction(async () => {
      const result = await window.beale.startCyberGymScenarioRun({
        scenario,
        level,
        settings: input
      });
      onStarted(result);
      return null;
    }).finally(() => setStartingRun(false));
  };

  return (
    <Modal
      title="Run CyberGym Scenario"
      wide
      onClose={onClose}
      footer={
        <>
          <button type="button" disabled={busy || startingRun} onClick={onClose}>
            Nevermind
          </button>
          <button className="primary-button" type="button" disabled={busy || startingRun || openAiBlocked} onClick={start}>
            <Play size={16} />
            Start
          </button>
        </>
      }
    >
      <div className="start-run-modal-body cybergym-run-modal-body">
        {openAiBlocked ? (
          <div className="policy-line">
            <ShieldAlert size={15} />
            {openAiStatus?.userAction ?? openAiStatus?.statusDetail ?? 'OpenAI host credentials are not configured.'}
          </div>
        ) : null}
        {input.sandboxProfile === 'host_research_only' ? (
          <div className="policy-line host-sandbox-warning">
            <ShieldAlert size={15} />
            Commands and executables will run on this host machine. A disposable sandbox is recommended, and a virtual machine is preferred for high-risk target execution.
          </div>
        ) : null}
        <section className="cybergym-run-scenario-summary" aria-label="CyberGym scenario">
          <div>
            <span>Scenario</span>
            <strong>{scenario.projectName}</strong>
            <p>
              {scenario.id} / {scenario.source}
            </p>
          </div>
          <p>{scenario.description || scenario.title}</p>
        </section>
        <label className="cybergym-level-field">
          <span>Level</span>
          <select value={level} onChange={(event) => setLevel(Number(event.target.value) as CyberGymLevel)}>
            {CYBERGYM_LEVELS.map((option) => (
              <option value={option} key={option}>
                {option} {option === 0 ? '(hardest)' : option === 3 ? '(default, easiest)' : ''}
              </option>
            ))}
          </select>
          <small>Lower levels expose less CyberGym task information.</small>
        </label>
        <details className="advanced-run-options" open>
          <summary>Session Settings</summary>
          <SessionSettingsFields input={input} minuteLimitValue={minuteLimitValue} onUpdate={update} onUpdateBudget={updateBudget} />
        </details>
      </div>
    </Modal>
  );
}

function CyberGymBenchmarkAnalysis({ benchmark }: { benchmark: BenchmarkOverview | null }): JSX.Element {
  const runs = useMemo(() => cyberGymRunSummaries(benchmark), [benchmark]);
  const comparisons = useMemo(() => filterCyberGymComparisons(benchmark?.comparisons ?? []), [benchmark?.comparisons]);
  const overview = useMemo(() => cyberGymAnalysisOverview(runs), [runs]);

  return (
    <div className="cybergym-workspace cybergym-workspace-analysis">
      <div className="cybergym-analysis-view">
        <section className="cybergym-analysis-summary" aria-label="CyberGym benchmark summary">
          <CyberGymAnalysisMetric label="Runs" value={runs.length.toLocaleString()} detail={`${overview.totalTasks.toLocaleString()} task result${overview.totalTasks === 1 ? '' : 's'}`} />
          <CyberGymAnalysisMetric label="Latest Pass Rate" value={formatRateValue(overview.latestPassRate)} detail={overview.latestRunLabel} />
          <CyberGymAnalysisMetric label="Best Pass Rate" value={formatRateValue(overview.bestPassRate)} detail={overview.bestRunLabel} />
          <CyberGymAnalysisMetric label="Avg TTF" value={formatDuration(overview.averageTimeToFindingMs)} detail="Passing task mean" />
          <CyberGymAnalysisMetric label="Avg Tokens" value={formatCompactNumber(overview.averageTokens)} detail="Per benchmark run" />
        </section>

        <section className="cybergym-analysis-chart cybergym-analysis-chart-wide" aria-label="CyberGym pass rate over time">
          <div className="cybergym-analysis-heading">
            <h3>Pass Rate Over Time</h3>
            <p>{overview.warning ?? 'CyberGym-compatible runs sorted by creation time.'}</p>
          </div>
          <PassRateTrendChart runs={runs} />
        </section>

        <section className="cybergym-analysis-chart" aria-label="CyberGym task result mix over time">
          <div className="cybergym-analysis-heading">
            <h3>Result Mix</h3>
            <p>Pass, fail, and inconclusive outcomes per run.</p>
          </div>
          <ResultMixBars runs={runs} />
        </section>

        <section className="cybergym-analysis-chart" aria-label="CyberGym benchmark efficiency over time">
          <div className="cybergym-analysis-heading">
            <h3>Efficiency</h3>
            <p>Token and wall-clock movement across recent runs.</p>
          </div>
          <EfficiencyBars runs={runs} />
        </section>

        <section className="cybergym-analysis-chart cybergym-analysis-chart-wide" aria-label="CyberGym harness comparisons">
          <div className="cybergym-analysis-heading">
            <h3>Harness Comparisons</h3>
            <p>Same model and task subset comparisons from persisted benchmark runs.</p>
          </div>
          <CyberGymComparisonList comparisons={comparisons} />
        </section>
      </div>
    </div>
  );
}

function CyberGymAnalysisMetric({ label, value, detail }: { label: string; value: string; detail: string }): JSX.Element {
  return (
    <div className="cybergym-analysis-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{detail}</p>
    </div>
  );
}

function PassRateTrendChart({ runs }: { runs: CyberGymRunSummary[] }): JSX.Element {
  if (runs.length === 0) {
    return <div className="cybergym-empty-state">No CyberGym benchmark runs recorded yet.</div>;
  }

  const width = 760;
  const height = 220;
  const left = 48;
  const right = 24;
  const top = 22;
  const bottom = 38;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const xFor = (index: number): number => left + (runs.length === 1 ? plotWidth / 2 : (plotWidth * index) / (runs.length - 1));
  const yFor = (passRate: number): number => top + plotHeight * (1 - clamp(passRate, 0, 1));
  const points = runs.map((run, index) => ({ run, x: xFor(index), y: yFor(run.passRate) }));
  const pointString = points.map((point) => `${point.x},${point.y}`).join(' ');

  return (
    <svg className="cybergym-line-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="CyberGym pass rate trend over time">
      {[0, 0.25, 0.5, 0.75, 1].map((tick) => {
        const y = yFor(tick);
        return (
          <g key={tick}>
            <line className="cybergym-chart-grid" x1={left} x2={width - right} y1={y} y2={y} />
            <text className="cybergym-chart-tick" x={12} y={y + 4}>
              {formatRateValue(tick)}
            </text>
          </g>
        );
      })}
      <polyline className="cybergym-chart-line" points={pointString} />
      {points.map((point) => (
        <g key={point.run.id}>
          <circle className="cybergym-chart-point" cx={point.x} cy={point.y} r={4} />
          <title>
            {point.run.label}: {formatRateValue(point.run.passRate)}
          </title>
        </g>
      ))}
      <text className="cybergym-chart-axis-label" x={left} y={height - 10}>
        {runs[0].shortLabel}
      </text>
      <text className="cybergym-chart-axis-label end" x={width - right} y={height - 10}>
        {runs[runs.length - 1].shortLabel}
      </text>
    </svg>
  );
}

function ResultMixBars({ runs }: { runs: CyberGymRunSummary[] }): JSX.Element {
  if (runs.length === 0) {
    return <div className="cybergym-empty-state">No task outcomes to visualize.</div>;
  }

  return (
    <div className="cybergym-analysis-bars">
      {runs.map((run) => {
        const total = Math.max(1, run.totalCount);
        return (
          <div className="cybergym-analysis-bar-row" key={run.id}>
            <div>
              <span>{run.shortLabel}</span>
              <strong>{formatRateValue(run.passRate)}</strong>
            </div>
            <div className="cybergym-result-stack" title={`${run.passCount} pass, ${run.failCount} fail, ${run.inconclusiveCount} inconclusive`}>
              <span className="segment-pass" style={{ width: `${(run.passCount / total) * 100}%` }} />
              <span className="segment-inconclusive" style={{ width: `${(run.inconclusiveCount / total) * 100}%` }} />
              <span className="segment-fail" style={{ width: `${(run.failCount / total) * 100}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function EfficiencyBars({ runs }: { runs: CyberGymRunSummary[] }): JSX.Element {
  if (runs.length === 0) {
    return <div className="cybergym-empty-state">No benchmark efficiency metrics yet.</div>;
  }

  const maxTokens = Math.max(1, ...runs.map((run) => run.tokenCount ?? 0));
  const maxWallTimeMs = Math.max(1, ...runs.map((run) => run.wallTimeMs ?? 0));
  return (
    <div className="cybergym-efficiency-list">
      {runs.map((run) => (
        <div className="cybergym-efficiency-row" key={run.id}>
          <div>
            <span>{run.shortLabel}</span>
            <strong>{run.harnessName}</strong>
          </div>
          <div className="cybergym-efficiency-bars">
            <span className="token-bar" style={{ width: `${(((run.tokenCount ?? 0) / maxTokens) * 100).toFixed(2)}%` }} title={`${formatNumber(run.tokenCount)} tokens`} />
            <span className="time-bar" style={{ width: `${(((run.wallTimeMs ?? 0) / maxWallTimeMs) * 100).toFixed(2)}%` }} title={formatDuration(run.wallTimeMs)} />
          </div>
          <p>
            {formatCompactNumber(run.tokenCount)} tokens / {formatDuration(run.wallTimeMs)}
          </p>
        </div>
      ))}
    </div>
  );
}

function CyberGymComparisonList({ comparisons }: { comparisons: BenchmarkComparison[] }): JSX.Element {
  if (comparisons.length === 0) {
    return <div className="cybergym-empty-state">No compatible CyberGym harness comparisons yet.</div>;
  }

  return (
    <div className="cybergym-comparison-list">
      {comparisons.map((comparison) => (
        <article className="cybergym-comparison-row" key={`${comparison.baselineRunId}-${comparison.candidateRunId}`}>
          <div>
            <strong>
              {comparison.baselineHarness} to {comparison.candidateHarness}
            </strong>
            <span>
              {comparison.model} / {comparison.reasoningEffort} / {comparison.taskSubsetId}
            </span>
          </div>
          <div className={comparison.passRateDelta > 0 ? 'delta-positive' : comparison.passRateDelta < 0 ? 'delta-negative' : 'delta-flat'}>
            <strong>{formatSignedRateDelta(comparison.passRateDelta)}</strong>
            <span>
              {formatRateValue(comparison.baselinePassRate)} to {formatRateValue(comparison.candidatePassRate)}
            </span>
          </div>
          {comparison.warning ? <p>{comparison.warning}</p> : null}
        </article>
      ))}
    </div>
  );
}

function scenarioTaskResults(benchmark: BenchmarkOverview | null, taskId: string): BenchmarkTaskResultRecord[] {
  if (!benchmark || !taskId) return [];
  return uniqueBenchmarkResults([...(benchmark.latestResults ?? []), ...(benchmark.recentResults ?? [])])
    .filter((result) => result.taskId === taskId)
    .sort((left, right) => timestampMs(left.createdAt) - timestampMs(right.createdAt));
}

function scenarioMetricSeries(results: BenchmarkTaskResultRecord[]): ScenarioMetricSeries[] {
  return [
    {
      id: 'score',
      title: 'Score',
      points: results.map((result) => scenarioMetricPoint(result, result.score)),
      formatValue: formatRateValue
    },
    {
      id: 'tokens',
      title: 'Tokens',
      points: scenarioMetricPoints(results, 'sessionTokenCount'),
      formatValue: formatNumber
    },
    {
      id: 'duration',
      title: 'Duration',
      points: scenarioMetricPoints(results, 'sessionDurationMs'),
      formatValue: formatDuration
    },
    {
      id: 'turns',
      title: 'Turns',
      points: scenarioMetricPoints(results, 'turnCount'),
      formatValue: formatNumber
    },
    {
      id: 'time-to-finding',
      title: 'Time To Finding',
      points: scenarioMetricPoints(results, 'timeToFindingMs'),
      formatValue: formatDuration
    }
  ];
}

function scenarioMetricPoints(results: BenchmarkTaskResultRecord[], metricKey: string): ScenarioMetricPoint[] {
  return results.flatMap((result) => {
    const value = metricNumber(result.metrics, metricKey);
    return value === null ? [] : [scenarioMetricPoint(result, value)];
  });
}

function scenarioMetricPoint(result: BenchmarkTaskResultRecord, value: number): ScenarioMetricPoint {
  return {
    id: `${result.id}-${value}`,
    label: shortRunDate(result.createdAt),
    value
  };
}

function cyberGymRunSummaries(benchmark: BenchmarkOverview | null): CyberGymRunSummary[] {
  if (!benchmark) return [];
  const resultsByRunId = new Map<string, BenchmarkTaskResultRecord[]>();
  for (const result of uniqueBenchmarkResults([...(benchmark.latestResults ?? []), ...(benchmark.recentResults ?? [])])) {
    if (!isCyberGymTaskResult(result)) continue;
    const current = resultsByRunId.get(result.benchmarkRunId) ?? [];
    current.push(result);
    resultsByRunId.set(result.benchmarkRunId, current);
  }

  return benchmark.recentRuns
    .filter((run) => isCyberGymRun(run) || resultsByRunId.has(run.id))
    .map((run) => cyberGymRunSummary(run, resultsByRunId.get(run.id) ?? []))
    .sort((left, right) => timestampMs(left.createdAt) - timestampMs(right.createdAt));
}

function cyberGymRunSummary(run: BenchmarkRunRecord, results: BenchmarkTaskResultRecord[]): CyberGymRunSummary {
  const passCount = results.length > 0 ? results.filter((result) => result.status === 'pass').length : run.identity.passCount;
  const failCount = results.length > 0 ? results.filter((result) => result.status === 'fail').length : Math.max(0, run.identity.totalCount - run.identity.passCount);
  const inconclusiveCount = results.length > 0 ? results.filter((result) => result.status === 'inconclusive').length : 0;
  const totalCount = results.length > 0 ? results.length : run.identity.totalCount;
  const resultTokenCount = sumMetric(results, 'sessionTokenCount');
  const identityTokenCount = metricNumber(run.identity.tokens, 'total');
  const resultWallTimeMs = sumMetric(results, 'sessionDurationMs');
  const timeToFindingMs = averageMetric(results, 'timeToFindingMs');

  return {
    id: run.id,
    label: `${formatSessionDateTime(run.createdAt)} / ${run.identity.harnessName}`,
    shortLabel: shortRunDate(run.createdAt),
    harnessName: run.identity.harnessName,
    model: run.identity.model,
    createdAt: run.createdAt,
    passCount,
    failCount,
    inconclusiveCount,
    totalCount,
    passRate: totalCount > 0 ? passCount / totalCount : clamp(run.identity.passRate, 0, 1),
    tokenCount: identityTokenCount && identityTokenCount > 0 ? identityTokenCount : resultTokenCount,
    wallTimeMs: run.identity.wallTimeMs > 0 ? run.identity.wallTimeMs : resultWallTimeMs,
    timeToFindingMs,
    warning: run.identity.smallSampleWarning
  };
}

function cyberGymAnalysisOverview(runs: CyberGymRunSummary[]): CyberGymAnalysisOverview {
  const latest = runs[runs.length - 1] ?? null;
  const best = runs.reduce<CyberGymRunSummary | null>((current, run) => (!current || run.passRate > current.passRate ? run : current), null);
  const averageTimeToFindingMs = average(runs.map((run) => run.timeToFindingMs).filter(isNumber));
  const averageTokens = average(runs.map((run) => run.tokenCount).filter(isNumber));
  return {
    totalTasks: runs.reduce((total, run) => total + run.totalCount, 0),
    latestPassRate: latest?.passRate ?? null,
    latestRunLabel: latest ? latest.label : 'No runs yet',
    bestPassRate: best?.passRate ?? null,
    bestRunLabel: best ? best.label : 'No runs yet',
    averageTimeToFindingMs,
    averageTokens,
    warning: runs.find((run) => run.warning)?.warning ?? null
  };
}

function uniqueBenchmarkResults(results: BenchmarkTaskResultRecord[]): BenchmarkTaskResultRecord[] {
  const seen = new Set<string>();
  const unique: BenchmarkTaskResultRecord[] = [];
  for (const result of results) {
    if (seen.has(result.id)) continue;
    seen.add(result.id);
    unique.push(result);
  }
  return unique;
}

function isCyberGymRun(run: BenchmarkRunRecord): boolean {
  const suiteKind = run.suiteKind.toLowerCase();
  const suiteId = run.suiteId.toLowerCase();
  const taskSubsetId = run.identity.taskSubsetId.toLowerCase();
  return suiteKind.includes('cybergym') || suiteId.includes('cybergym') || taskSubsetId.includes('cybergym') || run.identity.taskIds.some((taskId) => taskId.toLowerCase().includes('cybergym'));
}

function isCyberGymTaskResult(result: BenchmarkTaskResultRecord): boolean {
  const suiteKind = result.suiteKind.toLowerCase();
  const taskId = result.taskId.toLowerCase();
  return suiteKind.includes('cybergym') || taskId.includes('cybergym');
}

function filterCyberGymComparisons(comparisons: BenchmarkComparison[]): BenchmarkComparison[] {
  return comparisons.filter((comparison) => comparison.suiteKind.toLowerCase().includes('cybergym') || comparison.taskSubsetId.toLowerCase().includes('cybergym'));
}

function sumMetric(results: BenchmarkTaskResultRecord[], key: string): number | null {
  const values = results.map((result) => metricNumber(result.metrics, key)).filter(isNumber);
  if (values.length === 0) return null;
  return values.reduce((total, value) => total + value, 0);
}

function averageMetric(results: BenchmarkTaskResultRecord[], key: string): number | null {
  return average(results.map((result) => metricNumber(result.metrics, key)).filter(isNumber));
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function isNumber(value: number | null): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function timestampMs(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function shortRunDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
}

function metricNumber(metrics: Record<string, unknown>, key: string): number | null {
  const value = metrics[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function formatNumber(value: number | null): string {
  return value === null ? 'unknown' : value.toLocaleString();
}

function formatCompactNumber(value: number | null): string {
  if (value === null) return 'unknown';
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

function formatDuration(value: number | null): string {
  if (value === null) return 'unknown';
  if (value < 1000) return `${Math.round(value)} ms`;
  if (value >= 60_000) return `${Math.round((value / 60_000) * 10) / 10} min`;
  return `${Math.round((value / 1000) * 10) / 10} s`;
}

function formatRateValue(value: number | null): string {
  if (value === null) return 'unknown';
  return new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 1 }).format(clamp(value, 0, 1));
}

function formatSignedRateDelta(value: number): string {
  if (value === 0) return '0%';
  const magnitude = new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 1 }).format(Math.abs(value));
  return `${value > 0 ? '+' : '-'}${magnitude}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function scenarioWarning(scenario: CyberGymScenarioSummary): string | null {
  const warning = CYBERGYM_SCENARIO_WARNINGS.find((item) => item.projectName.toLowerCase() === scenario.projectName.toLowerCase());
  return warning?.message ?? null;
}

function filterCyberGymScenarios(scenarios: CyberGymScenarioSummary[], query: string): CyberGymScenarioSummary[] {
  const terms = query.toLowerCase().split(/\s+/).map((term) => term.trim()).filter(Boolean);
  if (terms.length === 0) return scenarios;
  return scenarios.filter((scenario) => {
    const haystack = [scenario.id, scenario.title, scenario.projectName, scenario.source, scenario.difficulty, scenario.description, scenario.searchText, ...scenario.tags]
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
