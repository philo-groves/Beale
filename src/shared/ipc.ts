export const IPC_CHANNELS = {
  selectWorkspace: 'beale:select-workspace',
  openWorkspace: 'beale:open-workspace',
  createWorkspace: 'beale:create-workspace',
  getSnapshot: 'beale:get-snapshot',
  getHostEnvironment: 'beale:get-host-environment',
  refreshOpenAiStatus: 'beale:refresh-openai-status',
  saveProgramScope: 'beale:save-program-scope',
  startRun: 'beale:start-run',
  runBenchmarkSuite: 'beale:run-benchmark-suite',
  exportWorkspaceBackup: 'beale:export-workspace-backup',
  getRunDetail: 'beale:get-run-detail',
  steerRun: 'beale:steer-run',
  snapshotUpdated: 'beale:snapshot-updated'
} as const;
