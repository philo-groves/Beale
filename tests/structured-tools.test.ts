import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WorkspaceDatabase, type CreatedRunContext } from '../src/main/database';
import { ExecutorManager } from '../src/main/executorManager';
import { BealeToolRouter } from '../src/main/openaiTools';
import type { ScopeAssetInput } from '../src/shared/types';

const createdDirs: string[] = [];
const ENV_KEYS = ['BEALE_VMCTL_COMMAND', 'BEALE_VMCTL_ARGS_JSON', 'BEALE_VMCTL_TIMEOUT_MS', 'BEALE_GIT_COMMAND'];
let callSequence = 0;

afterEach(() => {
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
  callSequence = 0;
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('structured research tools', () => {
  it('materializes in-scope source repositories before scoped search and VM import', () => {
    const { db, context, targetDir } = openStructuredToolDb();
    const gitFixture = join(process.cwd(), 'tests/fixtures/git-fixture.mjs');
    chmodSync(gitFixture, 0o700);
    process.env.BEALE_GIT_COMMAND = gitFixture;
    const router = new BealeToolRouter(db);

    db.saveProgramScope({
      ...scopeDraftFromActive(db),
      assets: [
        ...scopeDraftFromActive(db).assets,
        {
          direction: 'in_scope',
          kind: 'other',
          value: 'Open Source - Zuul',
          sensitivity: 'public',
          attributes: { instruction: '## https://github.com/Netflix/zuul\nPrimary target.' }
        }
      ]
    });

    const source = callTool(router, context, 'source', { repository: 'Zuul', ref: '' });
    expect(source.status).toBe('success');
    expect(source.payload.repositoryUrl).toBe('https://github.com/Netflix/zuul');
    expect(String(source.payload.localPath)).toContain('targets/repositories/github.com_Netflix_zuul');

    for (let index = 0; index < 325; index += 1) {
      writeFileSync(join(targetDir, `filler-${index}.txt`), 'unrelated filler\n');
    }

    const search = callTool(router, context, 'search', { query: 'authorizationBoundary', target: 'Open Source - Zuul' });
    expect(search.status).toBe('success');
    expect(search.payload.targetResolution).toBe('materialized_source_repository');
    expect(search.payload.filesConsidered).toBeGreaterThan(0);
    expect(JSON.stringify(search.payload)).toContain('ProxyEndpoint.java');

    const regexSearch = callTool(router, context, 'search', { query: 'ProxyEndpoint|MissingRoute', target: 'https://github.com/Netflix/zuul' });
    expect(regexSearch.status).toBe('success');
    expect(regexSearch.payload.queryMode).toBe('regex_or_terms');
    expect(JSON.stringify(regexSearch.payload)).toContain('ProxyEndpoint.java');
    db.close();
  });

  it('searches scoped source and binary-derived strings, then reads bounded source chunks', () => {
    const { db, context, sourceFile, binaryFile, routeFile, targetDir } = openStructuredToolDb();
    const router = new BealeToolRouter(db);

    const search = callTool(router, context, 'search', { query: 'authorization boundary', target: '' });
    expect(search.status).toBe('success');
    expect(JSON.stringify(search.payload)).toContain(sourceFile);

    const binarySearch = callTool(router, context, 'search', { query: 'CRASH_SIG', target: '' });
    expect(binarySearch.status).toBe('success');
    expect(JSON.stringify(binarySearch.payload)).toContain(binaryFile);
    expect(JSON.stringify(binarySearch.payload)).toContain('binaryDerived');
    const binaryMatches = binarySearch.payload.matches as Array<Record<string, unknown>>;
    expect(binaryMatches.filter((match) => match.kind === 'file' && (match.path === binaryFile || match.sourcePath === binaryFile))).toHaveLength(1);
    const binaryIndexSearch = db.searchProjectDocumentsForRun(context.run.id, 'CRASH_SIG');
    expect(JSON.stringify(binaryIndexSearch)).toContain('inventory_item');
    expect(JSON.stringify(binaryIndexSearch)).toContain('CRASH_SIG');

    db.appendTraceEvent({
      runId: context.run.id,
      attemptId: context.attempt.id,
      type: 'model_message',
      source: 'model',
      summary: 'UniqueTraceOnlyNeedle should not become scoped search material.',
      payload: { text: 'UniqueTraceOnlyNeedle' }
    });
    const selfSearch = callTool(router, context, 'search', { query: 'UniqueTraceOnlyNeedle', target: '' });
    expect(selfSearch.status).toBe('success');
    expect(JSON.stringify(selfSearch.payload)).toContain('trace_event');

    const inventory = db.getProjectInventorySummary(context.run.scopeVersionId);
    expect(inventory.fileCount).toBeGreaterThanOrEqual(3);
    expect(inventory.manifestCount).toBeGreaterThanOrEqual(1);
    const manifestSearch = callTool(router, context, 'search', { query: 'bealetestdependency', target: '' });
    expect(manifestSearch.status).toBe('success');
    expect(JSON.stringify(manifestSearch.payload)).toContain('bealetestdependency');
    expect(manifestSearch.payload.metadataMatches).toBe(0);
    const manifestIndexSearch = db.searchProjectDocumentsForRun(context.run.id, 'bealetestdependency');
    expect(JSON.stringify(manifestIndexSearch)).toContain('inventory_item');
    expect(JSON.stringify(manifestIndexSearch[0]?.metadata ?? {})).toContain('dependencyNames');

    const requirementsFile = join(targetDir, 'requirements.txt');
    writeFileSync(requirementsFile, 'freshdependency==1.2.3\n');
    const freshMtime = new Date(Date.now() + 2000);
    utimesSync(targetDir, freshMtime, freshMtime);
    const staleInventoryFileCount = db.getProjectInventorySummary(context.run.scopeVersionId).fileCount;
    const staleToolSearch = callTool(router, context, 'search', { query: 'freshdependency', target: '' });
    expect(staleToolSearch.status).toBe('success');
    expect(JSON.stringify(staleToolSearch.payload)).toContain('requirements.txt');
    expect(db.getProjectInventorySummary(context.run.scopeVersionId).fileCount).toBe(staleInventoryFileCount);
    const staleCodeRead = callTool(router, context, 'code_browser', { path: sourceFile, line_start: '1', line_end: '4' });
    expect(staleCodeRead.status).toBe('success');
    expect(db.getProjectInventorySummary(context.run.scopeVersionId).fileCount).toBe(staleInventoryFileCount);
    const refreshedManifestSearch = db.searchProjectDocumentsForRun(context.run.id, 'freshdependency');
    expect(JSON.stringify(refreshedManifestSearch)).toContain('requirements.txt');
    expect(JSON.stringify(refreshedManifestSearch)).toContain('freshdependency');

    const structure = db.getProjectStructureSummary(context.run.scopeVersionId);
    expect(structure.status).toBe('ready');
    expect(structure.indexedFileCount).toBeGreaterThanOrEqual(5);
    expect(structure.definitionCount).toBeGreaterThanOrEqual(1);
    expect(structure.routeCount).toBeGreaterThanOrEqual(1);
    expect(structure.importCount).toBeGreaterThanOrEqual(1);
    expect(structure.relationCount).toBeGreaterThanOrEqual(4);
    const graph = db.getProjectGraphSummary(context.run.scopeVersionId);
    expect(graph.status).toBe('ready');
    expect(graph.nodeCount).toBeGreaterThan(structure.entityCount);
    expect(graph.edgeCount).toBeGreaterThanOrEqual(structure.relationCount);
    expect(graph.structuralEdgeCount).toBeGreaterThanOrEqual(structure.relationCount);
    expect(graph.expectedNodeCount).toBe(graph.nodeCount);
    expect(graph.staleReasons).toEqual([]);
    expect(graph.buildCount).toBeGreaterThanOrEqual(1);
    expect(graph.nodeFamilyCounts.structure_entity).toBeGreaterThanOrEqual(structure.entityCount);
    expect(graph.edgeFamilyCounts.defines).toBeGreaterThanOrEqual(1);
    const structureSearch = callTool(router, context, 'search', { query: 'GET /api/users', target: '' });
    expect(structureSearch.status).toBe('success');
    expect(JSON.stringify(structureSearch.payload)).toContain('structure_entity');
    expect(['ready', 'stale']).toContain(String((structureSearch.payload.projectGraph as { status: string }).status));
    expect(Number(structureSearch.payload.graphMatches)).toBeGreaterThanOrEqual(1);
    expect(Number(structureSearch.payload.graphVariantMatches)).toBeGreaterThanOrEqual(1);
    const graphToolMatch = (structureSearch.payload.matches as Array<Record<string, unknown>>).find((match) => match.kind === 'graph');
    expect(graphToolMatch).toBeTruthy();
    expect(Number(graphToolMatch?.retrievalScore)).toBeGreaterThan(0);
    expect(Number((graphToolMatch?.retrievalSignals as Record<string, unknown> | undefined)?.graphProximity)).toBeGreaterThan(0);
    const graphVariantMatch = (structureSearch.payload.matches as Array<Record<string, unknown>>).find((match) => match.kind === 'graph_variant');
    expect(graphVariantMatch).toBeTruthy();
    expect(String(graphVariantMatch?.matchedBy)).toBe('project_graph_variant');
    expect(['checks_permission', 'reaches_sink', 'uses_middleware']).toContain(String(graphVariantMatch?.graphEdgeKind));
    expect(String(graphVariantMatch?.rankReason)).toContain('Variant candidate');
    expect(JSON.stringify(structureSearch.payload)).toContain('lineStart');
    expect(JSON.stringify(structureSearch.payload)).toContain('listUsers');
    expect(JSON.stringify(structureSearch.payload)).toContain('listAdmins');
    expect((structureSearch.payload.matches as Array<Record<string, unknown>>).filter((match) => match.kind === 'graph' && match.entityType === 'inventory_item' && match.sourcePath === routeFile)).toHaveLength(0);
    const sinkSearch = db.searchProjectDocumentsForRun(context.run.id, 'reaches_sink query');
    expect(sinkSearch.some((result) => result.entityType === 'structure_entity' && result.metadata.entityKind === 'sink')).toBe(true);
    const exportSearch = db.searchProjectDocumentsForRun(context.run.id, 'exports listUsers');
    expect(exportSearch.some((result) => result.entityType === 'structure_entity' && result.metadata.entityKind === 'export')).toBe(true);
    const functionStructureSearch = db.searchProjectDocumentsForRun(context.run.id, 'check_access');
    expect(functionStructureSearch.some((result) => result.entityType === 'structure_entity' && result.metadata.entityKind === 'function')).toBe(true);

    const read = callTool(router, context, 'code_browser', { path: sourceFile, symbol: 'check_access' });
    expect(read.status).toBe('success');
    expect(JSON.stringify(read.payload)).toContain('check_access');
    expect(JSON.stringify(read.payload)).toContain('authorization boundary');

    const structuredRead = callTool(router, context, 'code_browser', { path: routeFile, symbol: 'listUsers' });
    expect(structuredRead.status).toBe('success');
    expect(structuredRead.summary).toContain('from the structural index');
    const structureNavigation = structuredRead.payload.structureNavigation as Record<string, unknown>;
    expect(structureNavigation.status).toBe('hit');
    expect(JSON.stringify(structureNavigation.entity)).toContain('function');
    expect(JSON.stringify(structureNavigation.containedEntities)).toContain('security_marker');
    expect(JSON.stringify(structureNavigation.containedEntities)).toContain('sink');
    expect(JSON.stringify(structureNavigation.graphNeighborhood)).toContain('defines');
    expect(JSON.stringify(structureNavigation.graphNeighborhood)).toContain('belongs_to_program');

    const routeRead = callTool(router, context, 'code_browser', { path: routeFile, symbol: 'GET /api/users' });
    expect(routeRead.status).toBe('success');
    expect(JSON.stringify(routeRead.payload.structureNavigation)).toContain('handles_with');
    expect(JSON.stringify(routeRead.payload.structureNavigation)).toContain('listUsers');
    expect(JSON.stringify(routeRead.payload.structureNavigation)).toContain('scope_name_match');
    expect(JSON.stringify(routeRead.payload.structureNavigation)).toContain('auth.js');

    const frameworkRouteSearch = db.searchProjectDocumentsForRun(context.run.id, 'POST /api/orders');
    expect(frameworkRouteSearch.some((result) => result.entityType === 'structure_entity' && result.metadata.routeStyle === 'fastify_route_object')).toBe(true);
    expect(db.searchProjectDocumentsForRun(context.run.id, 'parses_body request_parse').some((result) => result.entityType === 'structure_entity' && result.metadata.relationKind === 'parses_body')).toBe(true);
    expect(db.searchProjectDocumentsForRun(context.run.id, 'serializes_response response_serialization').some((result) => result.entityType === 'structure_entity' && result.metadata.relationKind === 'serializes_response')).toBe(true);
    expect(db.searchProjectDocumentsForRun(context.run.id, 'reads_model order').some((result) => result.entityType === 'structure_entity' && result.metadata.relationKind === 'reads_model')).toBe(true);
    expect(db.searchProjectDocumentsForRun(context.run.id, 'writes_model order').some((result) => result.entityType === 'structure_entity' && result.metadata.relationKind === 'writes_model')).toBe(true);
    const frameworkGraph = db.getProjectGraphNeighborhood(context.run.scopeVersionId, 'structure_entity', frameworkRouteSearch.find((result) => result.metadata.routeStyle === 'fastify_route_object')?.entityId ?? '', { depth: 2 });
    expect(frameworkGraph.edges.some((edge) => edge.edgeKind === 'handles_with' && edge.targetLabel === 'createOrder')).toBe(true);
    const frameworkGraphSummary = db.getProjectGraphSummary(context.run.scopeVersionId);
    expect(frameworkGraphSummary.edgeFamilyCounts.parses_body).toBeGreaterThanOrEqual(1);
    expect(frameworkGraphSummary.edgeFamilyCounts.serializes_response).toBeGreaterThanOrEqual(1);
    expect(frameworkGraphSummary.edgeFamilyCounts.reads_model).toBeGreaterThanOrEqual(1);
    expect(frameworkGraphSummary.edgeFamilyCounts.writes_model).toBeGreaterThanOrEqual(1);
    expect(db.searchProjectDocumentsForRun(context.run.id, 'GET /admin/users').some((result) => result.entityType === 'structure_entity' && result.metadata.routeStyle === 'rails_routes')).toBe(true);
    expect(db.searchProjectDocumentsForRun(context.run.id, 'ANY /reports/').some((result) => result.entityType === 'structure_entity' && result.metadata.routeStyle === 'django_urlconf')).toBe(true);
    expect(db.searchProjectDocumentsForRun(context.run.id, 'GET /accounts').some((result) => result.entityType === 'structure_entity' && result.metadata.routeStyle === 'laravel_route')).toBe(true);

    const mobileStructureSearch = db.searchProjectDocumentsForRun(context.run.id, 'android.permission.CAMERA');
    expect(mobileStructureSearch.some((result) => result.entityType === 'structure_entity' && result.metadata.entityKind === 'mobile_permission')).toBe(true);
    const webStructureSearch = db.searchProjectDocumentsForRun(context.run.id, 'declares_endpoint /v1/widgets');
    expect(webStructureSearch.some((result) => result.entityType === 'structure_entity' && result.metadata.entityKind === 'web_endpoint')).toBe(true);
    const binaryStructureSearch = db.searchProjectDocumentsForRun(context.run.id, 'Java_com_example_Native');
    expect(binaryStructureSearch.some((result) => result.entityType === 'structure_entity' && result.metadata.entityKind === 'binary_symbol')).toBe(true);

    const defaultSemantic = db.getProjectSemanticSummary(context.run.scopeVersionId);
    expect(defaultSemantic.enabled).toBe(true);
    expect(defaultSemantic.status).toBe('empty');
    db.appendTraceEvent({
      runId: context.run.id,
      attemptId: context.attempt.id,
      type: 'model_message',
      source: 'model',
      summary: 'Semantic prototype-key regression marker.',
      payload: { text: 'constructor prototype toString should not break semantic token synonym expansion.' }
    });
    const enabledSemantic = db.setProjectSemanticIndexEnabled(true, context.run.scopeVersionId);
    expect(enabledSemantic.enabled).toBe(true);
    expect(enabledSemantic.status).toBe('ready');
    expect(enabledSemantic.remoteEmbeddingEnabled).toBe(false);
    expect(enabledSemantic.chunkCount).toBeGreaterThan(0);
    expect(enabledSemantic.sourceDocumentCount).toBeGreaterThan(0);
    expect(enabledSemantic.indexedSourceDocumentCount).toBe(enabledSemantic.sourceDocumentCount);
    expect(enabledSemantic.indexSizeBytes).toBeGreaterThan(0);
    expect(enabledSemantic.lastRefreshDurationMs).toBeGreaterThanOrEqual(0);
    expect(enabledSemantic.namespaceCounts.code).toBeGreaterThan(0);
    const prototypeKeySemanticResults = db.searchProjectSemanticChunksForRun(context.run.id, 'constructor prototype token expansion', 10);
    expect(prototypeKeySemanticResults.some((result) => result.entityType === 'trace_event')).toBe(true);
    const directSourceResults = db.searchProjectSemanticChunksForRun(context.run.id, 'authorization boundary check_access return', 10);
    const directSourceHit = directSourceResults.find((result) => result.sourcePath === sourceFile && result.metadata.semanticSourceKind === 'source_range');
    expect(directSourceHit).toBeTruthy();
    expect(directSourceHit?.metadata.lineStart).toBe(1);
    expect(directSourceHit?.metadata.lineEnd).toBeGreaterThanOrEqual(4);
    const directEntityResults = db.searchProjectSemanticChunksForRun(context.run.id, 'listUsers database query filter response json', 20);
    const directEntityHit = directEntityResults.find((result) => result.sourcePath === routeFile && result.metadata.semanticSourceKind === 'entity_range' && result.metadata.entityName === 'listUsers');
    expect(directEntityHit).toBeTruthy();
    expect(directEntityHit?.metadata.lineStart).toBeLessThanOrEqual(6);
    expect(directEntityHit?.metadata.lineEnd).toBeGreaterThanOrEqual(8);
    const directEntityRanking = directEntityHit?.metadata.semanticRanking as Record<string, unknown> | undefined;
    expect(Number(directEntityRanking?.structureScore)).toBeGreaterThan(0);
    expect(String(directEntityRanking?.reason)).toContain('code-structure fit');
    db.appendTraceEvent({
      runId: context.run.id,
      attemptId: context.attempt.id,
      type: 'model_message',
      source: 'model',
      summary: 'Semantic lifecycle stale marker.',
      payload: { text: 'SemanticLifecycleNeedle' }
    });
    expect(db.getProjectSemanticSummary(context.run.scopeVersionId)).toMatchObject({ enabled: true, status: 'stale' });
    expect(db.getProjectSemanticAutoRefreshReason(context.run.scopeVersionId, 'test_auto')).toBe('search_document_changed');
    const staleSemanticToolSearch = callTool(router, context, 'search', { query: 'native jni symbol', target: '' });
    expect(staleSemanticToolSearch.status).toBe('success');
    expect(staleSemanticToolSearch.payload.projectSemantic).toMatchObject({ enabled: true, status: 'stale' });
    expect(db.getProjectSemanticSummary(context.run.scopeVersionId)).toMatchObject({ enabled: true, status: 'stale' });
    const semanticResults = db.searchProjectSemanticChunksForRun(context.run.id, 'android mobile camera permission', 5);
    expect(db.getProjectSemanticSummary(context.run.scopeVersionId)).toMatchObject({ enabled: true, status: 'ready' });
    expect(db.getProjectSemanticAutoRefreshReason(context.run.scopeVersionId, 'test_auto')).toBeNull();
    expect(semanticResults.some((result) => result.namespace === 'mobile' || result.metadata.entityKind === 'mobile_permission')).toBe(true);
    const identifierSemanticResults = db.searchProjectSemanticChunksForRun(context.run.id, 'access check authorization guard', 20);
    const identifierSemanticHit = identifierSemanticResults.find((result) => result.title.includes('check_access') || result.snippet.includes('check_access'));
    expect(identifierSemanticHit).toBeTruthy();
    expect(identifierSemanticHit?.matchedTerms).toEqual(expect.arrayContaining(['access', 'check']));
    expect(identifierSemanticHit?.rankReason).toContain('term overlap');
    const identifierSemanticRanking = identifierSemanticHit?.metadata.semanticRanking as Record<string, unknown> | undefined;
    expect(Number(identifierSemanticRanking?.securityScore)).toBeGreaterThan(0);
    expect(Number(identifierSemanticRanking?.scopeScore)).toBeGreaterThan(0);
    expect(String(identifierSemanticRanking?.reason)).toContain('security-relevant surface');
    const semanticSearch = callTool(router, context, 'search', { query: 'native jni symbol', target: '' });
    expect(semanticSearch.status).toBe('success');
    expect(semanticSearch.payload.projectSemantic).toMatchObject({ enabled: true, status: 'stale', remoteEmbeddingEnabled: false });
    const semanticToolMatch = (semanticSearch.payload.matches as Array<Record<string, unknown>>).find((match) => match.kind === 'semantic');
    expect(semanticToolMatch).toBeTruthy();
    expect(semanticToolMatch?.matchedBy).toBe('project_semantic_hybrid_local_hash');
    expect(semanticToolMatch?.rankReason).toBeTruthy();
    expect(semanticToolMatch?.matchedTerms).toEqual(expect.arrayContaining(['native', 'jni', 'symbol']));
    const sourceSemanticSearch = callTool(router, context, 'search', { query: 'listUsers database filter response json', target: '' });
    const sourceSemanticToolMatch = (sourceSemanticSearch.payload.matches as Array<Record<string, unknown>>).find(
      (match) => match.kind === 'semantic' && match.sourcePath === routeFile && match.semanticSourceKind === 'entity_range'
    );
    expect(sourceSemanticToolMatch).toBeTruthy();
    expect(Number(sourceSemanticToolMatch?.line)).toBeLessThanOrEqual(6);
    expect(sourceSemanticToolMatch?.range).toBeTruthy();

    db.createHypothesis({
      runId: context.run.id,
      state: 'needs_evidence',
      title: 'Route handler authorization bypass memory',
      descriptionMarkdown: 'Prior research memory tied to the route handler authorization surface.',
      component: routeFile,
      bugClass: 'missing_authz',
      priorityScore: 11,
      attackerReachability: '2 route caller',
      impact: '2 route data exposure',
      evidenceConfidence: '1 source correlation',
      exploitPracticality: '1 needs variant test',
      scopeConfidence: '2 source-backed',
      cweMappings: [{ cweId: 'CWE-862', confidence: 'medium', rationaleMarkdown: 'Route handler authorization memory.', source: 'model' }]
    });
    const staleGraph = db.getProjectGraphSummary(context.run.scopeVersionId);
    expect(staleGraph.status).toBe('stale');
    expect(staleGraph.staleReasons.some((reason) => reason.startsWith('missing_node_family:hypothesis:'))).toBe(true);
    const staleGraphSearch = callTool(router, context, 'search', { query: 'Route handler authorization bypass memory', target: '' });
    expect(staleGraphSearch.status).toBe('success');
    expect((staleGraphSearch.payload.projectGraph as { status: string }).status).toBe('stale');
    expect((staleGraphSearch.payload.projectGraph as { buildCount: number }).buildCount).toBe(staleGraph.buildCount);

    const rebuiltGraph = db.findProjectGraphNodes(context.run.scopeVersionId, 'Route handler authorization bypass memory', { entityType: 'hypothesis' });
    expect(rebuiltGraph.length).toBeGreaterThanOrEqual(1);
    const codeToMemorySearch = callTool(router, context, 'search', { query: 'GET /api/users', target: '' });
    const memoryVariant = (codeToMemorySearch.payload.matches as Array<Record<string, unknown>>).find(
      (match) => match.kind === 'graph_variant' && match.entityType === 'hypothesis' && match.graphEdgeKind === 'affects_component'
    );
    expect(memoryVariant).toBeTruthy();
    expect(String(memoryVariant?.rankReason)).toContain('Variant candidate');

    const largeFile = join(targetDir, 'src', 'large-controller.js');
    const largeLines = Array.from({ length: 40_000 }, (_, index) => {
      const line = index + 1;
      return line === 420 ? 'function dangerousSink(input) { return input.url; }' : `const route_${line} = ${line};`;
    });
    writeFileSync(largeFile, largeLines.join('\n'));

    const firstChunk = callTool(router, context, 'code_browser', { path: largeFile, symbol: '', line_start: '', line_end: '' });
    expect(firstChunk.status).toBe('success');
    expect(firstChunk.payload.largeFile).toBe(true);
    expect(firstChunk.payload.lineStart).toBe(1);
    expect(firstChunk.payload.lineEnd).toBe(180);
    expect(firstChunk.payload.nextLineStart).toBe(181);

    const laterChunk = callTool(router, context, 'code_browser', { path: largeFile, symbol: '', line_start: '400', line_end: '405' });
    expect(laterChunk.status).toBe('success');
    expect(laterChunk.payload.lineStart).toBe(400);
    expect(laterChunk.payload.lineEnd).toBe(405);
    expect(JSON.stringify(laterChunk.payload)).toContain('route_405');
    expect(JSON.stringify(laterChunk.payload)).not.toContain('route_1');

    const anchoredChunk = callTool(router, context, 'code_browser', { path: largeFile, symbol: 'dangerousSink', line_start: '', line_end: '' });
    expect(anchoredChunk.status).toBe('success');
    expect(JSON.stringify(anchoredChunk.payload)).toContain('dangerousSink');
    expect(anchoredChunk.payload.lineStart).toBeLessThanOrEqual(420);
    expect(anchoredChunk.payload.lineEnd).toBeGreaterThanOrEqual(420);

    const blocked = callTool(router, context, 'code_browser', { path: join(tmpdir(), 'out-of-scope.c'), symbol: '' });
    expect(blocked.status).toBe('policy_blocked');
    expect(JSON.stringify(blocked.payload)).toContain('path_outside_active_scope');

    const missing = callTool(router, context, 'code_browser', { path: join(targetDir, 'src', 'missing.js'), symbol: '' });
    expect(missing.status).toBe('error');
    expect(missing.payload.error).toBe('path_not_found');
    expect(String(missing.payload.recoveryHint)).toContain('Search scoped source');

    const directory = callTool(router, context, 'code_browser', { path: targetDir, symbol: '' });
    expect(directory.status).toBe('error');
    expect(directory.payload.error).toBe('directory_not_file');

    const verifierIdRead = callTool(router, context, 'code_browser', { path: 'verifier_run_missing', symbol: '' });
    expect(verifierIdRead.status).toBe('error');
    expect(verifierIdRead.payload.error).toBe('unsupported_resource_id_for_code_browser');
    expect(String(verifierIdRead.payload.recoveryHint)).toContain('resource_lookup');
    db.close();
  }, 10000);

  it('carries semantic indexing across scope versions and marks new source material dirty', () => {
    const { db, targetDir } = openStructuredToolDb();
    const previousScope = db.getActiveScope();
    expect(db.setProjectSemanticIndexEnabled(true, previousScope.id)).toMatchObject({ enabled: true, status: 'ready' });

    const nextScope = db.saveProgramScope({
      ...scopeDraftFromActive(db),
      assets: [
        ...scopeDraftFromActive(db).assets,
        {
          direction: 'in_scope',
          kind: 'path',
          value: join(targetDir, 'src'),
          sensitivity: 'internal',
          attributes: { source: 'materialized_test' }
        }
      ]
    });

    expect(db.getProjectSemanticSummary(nextScope.id)).toMatchObject({ enabled: true, status: 'empty' });
    expect(db.getProjectSemanticAutoRefreshReason(nextScope.id, 'scope_changed')).toBe('search_document_changed');
    db.close();
  });

  it('preserves explicit semantic indexing disables across scope versions', () => {
    const { db, targetDir } = openStructuredToolDb();
    const previousScope = db.getActiveScope();
    expect(db.setProjectSemanticIndexEnabled(false, previousScope.id)).toMatchObject({ enabled: false, status: 'disabled' });

    const nextScope = db.saveProgramScope({
      ...scopeDraftFromActive(db),
      assets: [
        ...scopeDraftFromActive(db).assets,
        {
          direction: 'in_scope',
          kind: 'path',
          value: join(targetDir, 'src'),
          sensitivity: 'internal',
          attributes: { source: 'materialized_test' }
        }
      ]
    });

    expect(db.getProjectSemanticSummary(nextScope.id)).toMatchObject({ enabled: false, status: 'disabled' });
    expect(db.getProjectSemanticAutoRefreshReason(nextScope.id, 'scope_changed')).toBeNull();
    db.close();
  });

  it('indexes Beale research metadata for lexical search', () => {
    const { db, context } = openStructuredToolDb();
    const router = new BealeToolRouter(db);
    const hypothesis = db.createHypothesis({
      runId: context.run.id,
      state: 'needs_evidence',
      title: 'Telemetry beacon authorization bypass',
      descriptionMarkdown: 'A telemetry beacon path may bypass endpoint authorization.',
      component: 'telemetry ingestion',
      bugClass: 'missing_authz',
      priorityScore: 18,
      attackerReachability: '2 authenticated user',
      impact: '3 tenant data exposure',
      evidenceConfidence: '1 source correlation',
      exploitPracticality: '2 moderate constraints',
      scopeConfidence: '2 in-scope asset',
      cweMappings: [{ cweId: 'CWE-862', confidence: 'medium', rationaleMarkdown: 'Potential missing authorization check.', source: 'model' }]
    });

    const search = callTool(router, context, 'search', { query: 'telemetry endpoint authorization', target: '' });
    expect(search.status).toBe('success');
    expect(JSON.stringify(search.payload)).toContain(hypothesis.id);
    expect(JSON.stringify(search.payload)).toContain('hypothesis');
    expect(Number(search.payload.metadataMatches)).toBeGreaterThanOrEqual(1);
    const graphHypothesisNodes = db.findProjectGraphNodes(context.run.scopeVersionId, 'telemetry beacon', { entityType: 'hypothesis' });
    expect(graphHypothesisNodes.some((node) => node.entityId === hypothesis.id)).toBe(true);
    const hypothesisNeighborhood = db.getProjectGraphNeighborhood(context.run.scopeVersionId, 'hypothesis', hypothesis.id, { depth: 1 });
    expect(hypothesisNeighborhood.edges.some((edge) => edge.edgeKind === 'belongs_to_run')).toBe(true);
    expect(hypothesisNeighborhood.edges.some((edge) => edge.edgeKind === 'affects_component' && edge.targetEntityType === 'research_component')).toBe(true);
    expect(hypothesisNeighborhood.edges.some((edge) => edge.edgeKind === 'classified_as_cwe' && edge.targetEntityType === 'weakness')).toBe(true);

    const duplicateHypothesis = db.createHypothesis({
      runId: context.run.id,
      parentHypothesisId: hypothesis.id,
      state: 'duplicate',
      title: 'Duplicate telemetry authorization bypass',
      descriptionMarkdown: 'This duplicate claim should remain searchable but rank with duplicate risk.',
      component: 'telemetry ingestion',
      bugClass: 'missing_authz',
      priorityScore: 5,
      attackerReachability: '1 unclear',
      impact: '1 duplicate of prior research',
      evidenceConfidence: '0 none',
      exploitPracticality: '0 duplicate',
      scopeConfidence: '1 needs confirmation',
      cweMappings: [{ cweId: 'CWE-862', confidence: 'low', rationaleMarkdown: 'Duplicate authorization claim.', source: 'model' }]
    });
    db.setProjectSemanticIndexEnabled(true, context.run.scopeVersionId);
    const duplicateSemanticResult = db
      .searchProjectSemanticChunksForRun(context.run.id, 'duplicate telemetry authorization bypass', 10)
      .find((result) => result.entityId === duplicateHypothesis.id);
    const duplicateSemanticRanking = duplicateSemanticResult?.metadata.semanticRanking as Record<string, unknown> | undefined;
    expect(duplicateSemanticResult).toBeTruthy();
    expect(Number(duplicateSemanticRanking?.duplicateRiskPenalty)).toBeGreaterThan(0);
    expect(String(duplicateSemanticRanking?.reason)).toContain('duplicate or dismissed risk penalty');
    const duplicateNeighborhood = db.getProjectGraphNeighborhood(context.run.scopeVersionId, 'hypothesis', duplicateHypothesis.id, { depth: 1 });
    expect(duplicateNeighborhood.edges.some((edge) => edge.edgeKind === 'duplicates' && edge.targetEntityId === hypothesis.id)).toBe(true);
    const parentNeighborhood = db.getProjectGraphNeighborhood(context.run.scopeVersionId, 'hypothesis', hypothesis.id, { depth: 1 });
    expect(parentNeighborhood.edges.some((edge) => edge.edgeKind === 'has_duplicate_hypothesis' && edge.targetEntityId === duplicateHypothesis.id)).toBe(true);
    db.close();
  });

  it('preserves model-generated artifacts separately from observations and gates verifier promotion on evidence references', () => {
    const { db, context } = openStructuredToolDb();
    const router = new BealeToolRouter(db);

    const artifact = callTool(router, context, 'artifact', {
      name: 'candidate-poc.txt',
      content: 'candidate input generated by model',
      kind: 'poc_input'
    });
    expect(artifact.status).toBe('success');
    expect(artifact.artifact_id).toBeTruthy();
    expect(artifact.payload.observationBacked).toBe(false);

    const verifier = callTool(router, context, 'verifier', {
      hypothesis: 'candidate parser issue',
      expectation: 'candidate input should reproduce the observed condition',
      artifact_id: artifact.artifact_id,
      trace_event_id: artifact.trace_event_id,
      verifier_script: '',
      artifact_path: '',
      expected_stdout: ''
    });
    expect(verifier.status).toBe('success');
    expect(verifier.payload.status).toBe('inconclusive');
    expect(verifier.payload.promotedFinding).toBe(false);
    expect((verifier.payload.evidenceReferences as { artifactId: string }).artifactId).toBe(artifact.artifact_id);
    expect(String(verifier.payload.readHint)).toContain('code_browser');
    const artifactNeighborhood = db.getProjectGraphNeighborhood(context.run.scopeVersionId, 'artifact', artifact.artifact_id ?? '', { depth: 1 });
    expect(artifactNeighborhood.edges.some((edge) => edge.edgeKind === 'produced_by_trace' && edge.targetEntityType === 'trace_event')).toBe(true);

    const artifactLookup = callTool(router, context, 'resource_lookup', {
      resource_id: artifact.artifact_id ?? '',
      kind: 'artifact',
      query: ''
    });
    expect(artifactLookup.status).toBe('success');
    expect(artifactLookup.payload.totalMatches).toBe(1);
    expect(JSON.stringify(artifactLookup.payload.matches)).toContain('readHint');

    const verifierLookup = callTool(router, context, 'resource_lookup', {
      resource_id: verifier.payload.verifierRunId as string,
      kind: 'verifier_run',
      query: ''
    });
    expect(verifierLookup.status).toBe('success');
    expect(JSON.stringify(verifierLookup.payload.matches)).toContain('inconclusive');

    const detail = db.getRunDetail(context.run.id);
    expect(detail.artifacts.find((candidate) => candidate.id === artifact.artifact_id)?.source).toBe('model_generated');
    expect(detail.verifierRuns).toHaveLength(1);
    expect(detail.traceEvents.some((event) => event.type === 'verifier_result' && event.source === 'verifier')).toBe(true);
    db.close();
  });

  it('lets OpenAI tools record hypotheses, evidence, and findings without bypassing verifier gates', () => {
    const { db, context } = openStructuredToolDb();
    const router = new BealeToolRouter(db);

    const hypothesis = callTool(router, context, 'hypothesis', {
      hypothesis_id: '',
      state: 'needs_evidence',
      title: 'Header value disclosure',
      description: 'Sensitive headers may be serialized without redaction.',
      component: 'ipc logging',
      bug_class: 'secret_leak',
      primary_cwe_id: 'CWE-200',
      primary_cwe_name: '',
      alternate_cwe_ids_json: '["CWE-798"]',
      cwe_mapping_confidence: 'medium',
      cwe_mapping_rationale: 'Sensitive header values are exposed to unauthorized log readers.',
      attacker_reachability: '2 authenticated/user-assisted',
      impact: '3 credential exposure',
      evidence_confidence: '1 static/tool-backed lead',
      exploit_practicality: '2 moderate constraints',
      scope_confidence: '2 in-scope asset',
      priority_score: 8
    });
    expect(hypothesis.status).toBe('success');
    const hypothesisId = hypothesis.payload.hypothesisId as string;
    expect(hypothesisId).toBeTruthy();

    const updatedHypothesis = callTool(router, context, 'hypothesis', {
      hypothesis_id: hypothesisId,
      state: 'reproduced',
      title: 'Header value disclosure',
      description: 'A local artifact reproduced unredacted header serialization.',
      component: 'ipc logging',
      bug_class: 'secret_leak',
      primary_cwe_id: '',
      primary_cwe_name: '',
      alternate_cwe_ids_json: '[]',
      cwe_mapping_confidence: 'low',
      cwe_mapping_rationale: '',
      attacker_reachability: '2 authenticated/user-assisted',
      impact: '3 credential exposure',
      evidence_confidence: '2 dynamic evidence',
      exploit_practicality: '2 moderate constraints',
      scope_confidence: '2 in-scope asset',
      priority_score: 12
    });
    expect(updatedHypothesis.status).toBe('success');

    const artifact = callTool(router, context, 'artifact', {
      name: 'header-repro.txt',
      content: 'PASS unredacted header observed',
      kind: 'reproduction_note'
    });
    expect(artifact.status).toBe('success');

    const evidence = callTool(router, context, 'evidence', {
      kind: 'artifact',
      summary: 'Reproduction artifact shows the unredacted header marker.',
      hypothesis_id: hypothesisId,
      finding_id: '',
      artifact_id: artifact.artifact_id ?? '',
      trace_event_id: '',
      verifier_run_id: ''
    });
    expect(evidence.status).toBe('success');
    expect(evidence.payload.evidenceId).toBeTruthy();

    const finding = callTool(router, context, 'finding', {
      finding_id: '',
      hypothesis_id: hypothesisId,
      state: 'reproduced',
      title: 'Sensitive header values are logged unredacted',
      summary: 'A local reproduction artifact shows sensitive header values serialized without redaction.',
      primary_cwe_id: 'CWE-200',
      primary_cwe_name: '',
      alternate_cwe_ids_json: '[]',
      cwe_mapping_confidence: 'high',
      cwe_mapping_rationale: 'The reproduced behavior exposes sensitive header values through logs.',
      affected_assets_json: '{"component":"ipc logging"}',
      affected_versions_json: '{"commit":"fixture"}',
      impact: 'Credential material may be exposed through logs when the integration records request headers.',
      priority_score: 12,
      verified_by_verifier_run_id: ''
    });
    expect(finding.status).toBe('success');
    const findingId = finding.payload.findingId as string;
    expect(findingId).toBeTruthy();

    const blockedVerified = callTool(router, context, 'finding', {
      finding_id: findingId,
      hypothesis_id: hypothesisId,
      state: 'verified',
      title: 'Sensitive header values are logged unredacted',
      summary: 'Should not become verified without a passing real verifier.',
      primary_cwe_id: 'CWE-200',
      primary_cwe_name: '',
      alternate_cwe_ids_json: '[]',
      cwe_mapping_confidence: 'high',
      cwe_mapping_rationale: 'The reproduced behavior exposes sensitive header values through logs.',
      affected_assets_json: '{}',
      affected_versions_json: '{}',
      impact: 'Credential material may be exposed.',
      priority_score: 12,
      verified_by_verifier_run_id: ''
    });
    expect(blockedVerified.status).toBe('error');

    const blockedReportable = callTool(router, context, 'finding', {
      finding_id: findingId,
      hypothesis_id: hypothesisId,
      state: 'reportable',
      title: 'Sensitive header values are logged unredacted',
      summary: 'Should not become reportable without a passing real verifier.',
      primary_cwe_id: 'CWE-200',
      primary_cwe_name: '',
      alternate_cwe_ids_json: '[]',
      cwe_mapping_confidence: 'high',
      cwe_mapping_rationale: 'The reproduced behavior exposes sensitive header values through logs.',
      affected_assets_json: '{}',
      affected_versions_json: '{}',
      impact: 'Credential material may be exposed.',
      priority_score: 12,
      verified_by_verifier_run_id: ''
    });
    expect(blockedReportable.status).toBe('error');
    expect(blockedReportable.summary).toContain('Reportable findings require');

    const detail = db.getRunDetail(context.run.id);
    expect(detail.hypotheses.find((item) => item.id === hypothesisId)?.state).toBe('reproduced');
    expect(detail.hypotheses.find((item) => item.id === hypothesisId)?.priorityScore).toBe(18);
    expect(detail.hypotheses.find((item) => item.id === hypothesisId)?.createdTraceEventId).toBeTruthy();
    expect(detail.hypotheses.find((item) => item.id === hypothesisId)?.cweMappings.map((mapping) => mapping.cweId)).toEqual(['CWE-200', 'CWE-798']);
    expect(detail.hypotheses.find((item) => item.id === hypothesisId)?.cweMappings[0]?.cweName).toBe('Exposure of Sensitive Information to an Unauthorized Actor');
    expect(detail.evidence).toHaveLength(1);
    expect(detail.findings.find((item) => item.id === findingId)?.state).toBe('reproduced');
    expect(detail.findings.find((item) => item.id === findingId)?.priorityScore).toBe(18);
    expect(detail.findings.find((item) => item.id === findingId)?.cweMappings[0]?.confidence).toBe('high');
    expect(detail.traceEvents.some((event) => event.type === 'hypothesis_event' && event.payload.hypothesisId === hypothesisId)).toBe(true);
    expect(detail.traceEvents.some((event) => event.type === 'finding_event' && event.payload.findingId === findingId)).toBe(true);
    db.close();
  });

  it('promotes reproduced verifier-backed hypotheses into reproduced findings', () => {
    const { db, context } = openStructuredToolDb('host_research_only');
    const router = new BealeToolRouter(db);

    const hypothesis = callTool(router, context, 'hypothesis', {
      hypothesis_id: '',
      state: 'needs_evidence',
      title: 'Exported provider exposes token store',
      description: 'The exported provider returns sensitive token-store rows to authorized callers.',
      component: 'android content provider',
      bug_class: 'ipc_authz',
      primary_cwe_id: 'CWE-862',
      primary_cwe_name: '',
      alternate_cwe_ids_json: '[]',
      cwe_mapping_confidence: 'medium',
      cwe_mapping_rationale: 'The issue concerns missing authorization on IPC access.',
      attacker_reachability: '2 local app IPC',
      impact: '3 token store exposure',
      evidence_confidence: '2 static evidence',
      exploit_practicality: '2 moderate constraints',
      scope_confidence: '2 in-scope asset',
      priority_score: 34
    });
    expect(hypothesis.status).toBe('success');
    const hypothesisId = hypothesis.payload.hypothesisId as string;

    const verifier = callTool(router, context, 'verifier', {
      hypothesis: hypothesisId,
      expectation: 'Static verifier should confirm the exported provider token-store path.',
      artifact_id: '',
      trace_event_id: '',
      verifier_script: "echo 'PASS: exported provider token-store path confirmed'",
      artifact_path: '',
      expected_stdout: 'PASS: exported provider token-store path confirmed'
    });
    expect(verifier.status).toBe('success');
    expect(verifier.payload.status).toBe('pass');
    const verifierRunId = verifier.payload.verifierRunId as string;

    const evidence = callTool(router, context, 'evidence', {
      kind: 'verifier',
      summary: 'Verifier confirmed the exported provider token-store path.',
      hypothesis_id: hypothesisId,
      finding_id: '',
      artifact_id: '',
      trace_event_id: '',
      verifier_run_id: verifierRunId
    });
    expect(evidence.status).toBe('success');

    const update = callTool(router, context, 'hypothesis', {
      hypothesis_id: hypothesisId,
      state: 'reproduced',
      title: 'Exported provider exposes token store',
      description: 'The exported provider returns sensitive token-store rows to authorized callers.',
      component: 'android content provider',
      bug_class: 'ipc_authz',
      primary_cwe_id: 'CWE-862',
      primary_cwe_name: '',
      alternate_cwe_ids_json: '[]',
      cwe_mapping_confidence: 'medium',
      cwe_mapping_rationale: 'The verifier-backed path concerns missing authorization on IPC access.',
      attacker_reachability: '2 local app IPC',
      impact: '3 token store exposure',
      evidence_confidence: '3 verifier-backed reproduction',
      exploit_practicality: '2 moderate constraints',
      scope_confidence: '2 in-scope asset',
      priority_score: 42
    });
    expect(update.status).toBe('success');
    expect(update.payload.autoPromotedFindingIds).toHaveLength(1);

    const detail = db.getRunDetail(context.run.id);
    const finding = detail.findings.find((item) => item.hypothesisId === hypothesisId);
    expect(detail.hypotheses.find((item) => item.id === hypothesisId)?.priorityScore).toBe(27);
    expect(finding?.state).toBe('reproduced');
    expect(finding?.priorityScore).toBe(27);
    expect(finding?.verifiedByVerifierRunId).toBe(verifierRunId);
    expect(finding?.cweMappings[0]?.cweId).toBe('CWE-862');
    expect(detail.evidence.some((item) => item.findingId === finding?.id && item.verifierRunId === verifierRunId)).toBe(true);
    expect(detail.traceEvents.some((event) => event.type === 'finding_event' && event.payload.action === 'auto_create')).toBe(true);

    const reportable = callTool(router, context, 'finding', {
      finding_id: finding?.id ?? '',
      hypothesis_id: hypothesisId,
      state: 'reportable',
      title: 'Exported provider exposes token store',
      summary: 'Verifier-backed reproduction and reviewed reachability make this ready for disclosure review.',
      primary_cwe_id: 'CWE-862',
      primary_cwe_name: '',
      alternate_cwe_ids_json: '[]',
      cwe_mapping_confidence: 'high',
      cwe_mapping_rationale: 'The verified behavior is a missing authorization boundary on IPC access.',
      affected_assets_json: '{"component":"android content provider"}',
      affected_versions_json: '{"commit":"fixture"}',
      impact: 'Reachable local IPC callers can read token-store rows.',
      verified_by_verifier_run_id: verifierRunId
    });
    expect(reportable.status).toBe('success');
    expect(db.getRunDetail(context.run.id).findings.find((item) => item.id === finding?.id)?.state).toBe('reportable');
    const verifierRunNeighborhood = db.getProjectGraphNeighborhood(context.run.scopeVersionId, 'verifier_run', verifierRunId, { depth: 1 });
    expect(verifierRunNeighborhood.edges.some((edge) => edge.edgeKind === 'verifies_finding_outcome' && edge.targetEntityId === finding?.id)).toBe(true);
    expect(verifierRunNeighborhood.edges.some((edge) => edge.edgeKind === 'backs_evidence')).toBe(true);
    const findingNeighborhood = db.getProjectGraphNeighborhood(context.run.scopeVersionId, 'finding', finding?.id ?? '', { depth: 1 });
    expect(findingNeighborhood.edges.some((edge) => edge.edgeKind === 'supported_by_evidence')).toBe(true);
    expect(findingNeighborhood.edges.some((edge) => edge.edgeKind === 'affects_component' && edge.targetEntityType === 'research_component')).toBe(true);
    expect(findingNeighborhood.edges.some((edge) => edge.edgeKind === 'classified_as_cwe' && edge.targetEntityType === 'weakness')).toBe(true);
    db.close();
  });

  it('blocks duplicate hypotheses against prior program findings', () => {
    const { db, context } = openStructuredToolDb();
    const router = new BealeToolRouter(db);

    const priorHypothesis = callTool(router, context, 'hypothesis', {
      hypothesis_id: '',
      state: 'reproduced',
      title: 'Header value disclosure',
      description: 'Sensitive headers are serialized without redaction in IPC logging.',
      component: 'ipc logging',
      bug_class: 'secret_leak',
      primary_cwe_id: 'CWE-200',
      primary_cwe_name: '',
      alternate_cwe_ids_json: '[]',
      cwe_mapping_confidence: 'high',
      cwe_mapping_rationale: 'Sensitive header values are exposed to unauthorized log readers.',
      attacker_reachability: '2 authenticated/user-assisted',
      impact: '3 credential exposure',
      evidence_confidence: '2 dynamic evidence',
      exploit_practicality: '2 moderate constraints',
      scope_confidence: '2 in-scope asset'
    });
    const priorHypothesisId = priorHypothesis.payload.hypothesisId as string;
    const priorFinding = callTool(router, context, 'finding', {
      finding_id: '',
      hypothesis_id: priorHypothesisId,
      state: 'reproduced',
      title: 'Sensitive header values are logged unredacted',
      summary: 'A local reproduction artifact shows sensitive header values serialized without redaction.',
      primary_cwe_id: 'CWE-200',
      primary_cwe_name: '',
      alternate_cwe_ids_json: '[]',
      cwe_mapping_confidence: 'high',
      cwe_mapping_rationale: 'The reproduced behavior exposes sensitive header values through logs.',
      affected_assets_json: '{"component":"ipc logging"}',
      affected_versions_json: '{}',
      impact: 'Credential material may be exposed through logs when the integration records request headers.',
      verified_by_verifier_run_id: ''
    });
    const priorFindingId = priorFinding.payload.findingId as string;
    const followUp = createStructuredRun(db, 'Follow-up duplicate sweep');

    const duplicate = callTool(router, followUp, 'hypothesis', {
      hypothesis_id: '',
      state: 'needs_evidence',
      title: 'Sensitive header values are logged unredacted',
      description: 'IPC logging still appears to serialize sensitive request headers without redaction.',
      component: 'ipc logging',
      bug_class: 'secret_leak',
      primary_cwe_id: 'CWE-200',
      primary_cwe_name: '',
      alternate_cwe_ids_json: '[]',
      cwe_mapping_confidence: 'medium',
      cwe_mapping_rationale: 'Sensitive header values are exposed to unauthorized log readers.',
      attacker_reachability: '2 authenticated/user-assisted',
      impact: '3 credential exposure',
      evidence_confidence: '1 static/tool-backed lead',
      exploit_practicality: '2 moderate constraints',
      scope_confidence: '2 in-scope asset'
    });

    expect(duplicate.status).toBe('success');
    expect(duplicate.payload.action).toBe('duplicate_blocked');
    expect((duplicate.payload.duplicateReview as { outcome: string; matchedEntityId: string }).outcome).toBe('duplicate');
    expect((duplicate.payload.duplicateReview as { outcome: string; matchedEntityId: string }).matchedEntityId).toBe(priorFindingId);
    expect(db.getRunDetail(followUp.run.id).hypotheses).toHaveLength(0);
    expect(db.getRunDetail(followUp.run.id).traceEvents.some((event) => event.type === 'hypothesis_event' && event.payload.action === 'duplicate_blocked')).toBe(true);
    db.close();
  });

  it('blocks duplicate findings and links new evidence to the existing program finding', () => {
    const { db, context } = openStructuredToolDb();
    const router = new BealeToolRouter(db);

    const priorHypothesis = callTool(router, context, 'hypothesis', {
      hypothesis_id: '',
      state: 'reproduced',
      title: 'Exported provider exposes token store',
      description: 'The exported provider returns sensitive token-store rows to local IPC callers.',
      component: 'android content provider',
      bug_class: 'ipc_authz',
      primary_cwe_id: 'CWE-862',
      primary_cwe_name: '',
      alternate_cwe_ids_json: '[]',
      cwe_mapping_confidence: 'high',
      cwe_mapping_rationale: 'The issue concerns missing authorization on IPC access.',
      attacker_reachability: '2 local app IPC',
      impact: '3 token store exposure',
      evidence_confidence: '2 dynamic evidence',
      exploit_practicality: '2 moderate constraints',
      scope_confidence: '2 in-scope asset'
    });
    const priorHypothesisId = priorHypothesis.payload.hypothesisId as string;
    const priorFinding = callTool(router, context, 'finding', {
      finding_id: '',
      hypothesis_id: priorHypothesisId,
      state: 'reproduced',
      title: 'Exported provider exposes token store',
      summary: 'The exported provider returns sensitive token-store rows to local IPC callers.',
      primary_cwe_id: 'CWE-862',
      primary_cwe_name: '',
      alternate_cwe_ids_json: '[]',
      cwe_mapping_confidence: 'high',
      cwe_mapping_rationale: 'The issue concerns missing authorization on IPC access.',
      affected_assets_json: '{"component":"android content provider"}',
      affected_versions_json: '{}',
      impact: 'Token store rows are exposed to local applications through IPC.',
      verified_by_verifier_run_id: ''
    });
    const priorFindingId = priorFinding.payload.findingId as string;
    const followUp = createStructuredRun(db, 'Duplicate finding sanity check');
    const currentHypothesis = db.createHypothesis({
      runId: followUp.run.id,
      state: 'reproduced',
      title: 'Provider token store exposure',
      descriptionMarkdown: 'The exported provider returns sensitive token-store rows to local IPC callers.',
      component: 'android content provider',
      bugClass: 'ipc_authz',
      priorityScore: 27,
      attackerReachability: '2 local app IPC',
      impact: '3 token store exposure',
      evidenceConfidence: '2 dynamic evidence',
      exploitPracticality: '2 moderate constraints',
      scopeConfidence: '2 in-scope asset',
      cweMappings: [{ cweId: 'CWE-862', confidence: 'high', rationaleMarkdown: 'Missing authorization on IPC access.', source: 'model' }]
    });
    const evidence = db.createEvidence({
      runId: followUp.run.id,
      hypothesisId: currentHypothesis.id,
      kind: 'dynamic_observation',
      summary: 'Follow-up reproduction reached the same token-store provider path.'
    });

    const duplicate = callTool(router, followUp, 'finding', {
      finding_id: '',
      hypothesis_id: currentHypothesis.id,
      state: 'reproduced',
      title: 'Exported provider exposes token store',
      summary: 'The exported provider returns sensitive token-store rows to local IPC callers.',
      primary_cwe_id: 'CWE-862',
      primary_cwe_name: '',
      alternate_cwe_ids_json: '[]',
      cwe_mapping_confidence: 'high',
      cwe_mapping_rationale: 'The issue concerns missing authorization on IPC access.',
      affected_assets_json: '{"component":"android content provider"}',
      affected_versions_json: '{}',
      impact: 'Token store rows are exposed to local applications through IPC.',
      verified_by_verifier_run_id: ''
    });

    expect(duplicate.status).toBe('success');
    expect(duplicate.payload.action).toBe('duplicate_blocked');
    expect(duplicate.payload.findingId).toBe(priorFindingId);
    const followUpDetail = db.getRunDetail(followUp.run.id);
    expect(followUpDetail.findings).toHaveLength(0);
    expect(followUpDetail.hypotheses.find((item) => item.id === currentHypothesis.id)?.state).toBe('duplicate');
    expect(followUpDetail.evidence.find((item) => item.id === evidence.id)?.findingId).toBe(priorFindingId);
    expect(followUpDetail.traceEvents.some((event) => event.type === 'finding_event' && event.payload.action === 'duplicate_blocked')).toBe(true);
    db.close();
  });

  it('runs Python and the debugger wrapper through the disposable VM controller boundary', () => {
    const { db, context, logPath } = openStructuredToolDb();
    context.run.networkProfile = 'elevated';
    configureVmctlFixture(logPath);
    const router = new BealeToolRouter(db, new ExecutorManager(db));

    const python = callTool(router, context, 'python', {
      task: 'generate a candidate input',
      script: 'print("candidate")',
      artifact_path: '/tmp/beale-output.txt'
    });
    expect(python.status).toBe('success');
    expect(python.artifact_id).toBeTruthy();
    expect(python.payload.hostExecution).toBe(false);
    expect(python.payload.requestedNetworkProfile).toBe('elevated');
    expect(python.payload.networkProfile).toBe('scoped');

    const debuggerResult = callTool(router, context, 'debugger', {
      operation: 'gdb_probe',
      target: '/workspace/target',
      input_path: ''
    });
    expect(debuggerResult.status).toBe('success');
    expect(debuggerResult.artifact_id).toBeTruthy();
    expect(debuggerResult.payload.wrapper).toBe('gdb_batch_probe');
    expect(debuggerResult.payload.hostExecution).toBe(false);
    expect(debuggerResult.payload.requestedNetworkProfile).toBe('elevated');
    expect(debuggerResult.payload.networkProfile).toBe('scoped');
    expect((debuggerResult.payload.debugger as { signal: string }).signal).toBe('SIGSEGV');
    expect((debuggerResult.payload.debugger as { frames: string[] }).frames.length).toBeGreaterThan(0);
    expect((debuggerResult.payload.debugger as { registersCaptured: boolean }).registersCaptured).toBe(true);
    context.run.networkProfile = 'offline';

    const verifier = callTool(router, context, 'verifier', {
      hypothesis: 'structured tool VM verifier',
      expectation: 'VM verifier should observe fixture stdout',
      artifact_id: '',
      trace_event_id: '',
      verifier_script: 'echo verifier-ok',
      artifact_path: '/tmp/beale-output.txt',
      expected_stdout: 'fixture guest stdout'
    });
    expect(verifier.status).toBe('success');
    expect(verifier.payload.status).toBe('pass');
    expect(verifier.payload.realExecution).toBe(true);
    expect(verifier.artifact_id).toBeTruthy();

    const actions = readVmctlEntries(logPath).map((entry) => entry.input.action);
    expect(actions).toContain('create_context');
    expect(actions).toContain('clone_context');
    expect(actions).toContain('import_workspace_material');
    expect(actions.filter((action) => action === 'execute')).toHaveLength(3);
    expect(actions).toContain('export_artifact');
    expect(actions.filter((action) => action === 'destroy')).toHaveLength(3);

    const operations = readVmctlEntries(logPath)
      .filter((entry) => entry.input.action === 'execute' && entry.input.payload.operation)
      .map((entry) => entry.input.payload.operation?.operationKind);
    expect(operations).toEqual(['python', 'shell', 'shell']);
    const localAnalysisProfiles = readVmctlEntries(logPath)
      .filter((entry) => entry.input.action === 'execute')
      .slice(0, 2)
      .map((entry) => entry.input.payload.operation?.networkPolicy?.profile);
    expect(localAnalysisProfiles).toEqual(['scoped', 'scoped']);
    db.close();
  });

  it('runs Python and verifier scripts on the host when the session sandbox is host_research_only', () => {
    const { db, context, targetDir } = openStructuredToolDb('host_research_only');
    const router = new BealeToolRouter(db);

    const python = callTool(router, context, 'python', {
      task: 'generate host-side analysis output',
      script: [
        'import os',
        'target = os.environ["BEALE_TARGET_PATH"]',
        'path = os.path.join(target, "beale-host-output.txt")',
        'open(path, "w", encoding="utf-8").write("host artifact")',
        'print(os.environ["BEALE_EXECUTION_SUBSTRATE"])'
      ].join('\n'),
      artifact_path: '/workspace/target/beale-host-output.txt'
    });
    expect(python.status).toBe('success');
    expect(python.artifact_id).toBeTruthy();
    expect(python.payload.hostExecution).toBe(true);
    expect(python.payload.executionSubstrate).toBe('host');
    expect(python.payload.hostTargetPath).toBe(targetDir);
    expect(python.payload.stdoutSummary).toContain('host');

    const verifier = callTool(router, context, 'verifier', {
      hypothesis: 'host verifier',
      expectation: 'host verifier should observe stdout',
      artifact_id: '',
      trace_event_id: '',
      verifier_script: 'printf verifier-ok',
      artifact_path: '',
      expected_stdout: 'verifier-ok'
    });
    expect(verifier.status).toBe('success');
    expect(verifier.payload.status).toBe('pass');
    expect(verifier.payload.realExecution).toBe(true);
    expect(verifier.payload.hostExecution).toBe(true);
    expect(verifier.payload.vmExecution).toBe(false);
    expect(db.getRunDetail(context.run.id).traceEvents.some((event) => event.summary === 'Verifier contract executed on host with pass.')).toBe(true);
    db.close();
  });

  it('runs host Python through the async OpenAI tool path without blocking the event loop', async () => {
    const { db, context } = openStructuredToolDb('host_research_only');
    const router = new BealeToolRouter(db);
    const startedAt = performance.now();

    const outputPromise = router.executeAsync(context, {
      callId: `call_python_${(callSequence += 1)}`,
      name: 'python',
      argumentsJson: JSON.stringify({
        task: 'prove host python does not block the main event loop',
        script: 'import time\ntime.sleep(1.0)\nprint("async-host")',
        artifact_path: ''
      })
    });

    expect(performance.now() - startedAt).toBeLessThan(200);
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(performance.now() - startedAt).toBeLessThan(500);

    const python = JSON.parse((await outputPromise).output) as ToolOutput;
    expect(python.status).toBe('success');
    expect(python.payload.hostExecution).toBe(true);
    expect(python.payload.stdoutSummary).toContain('async-host');
    db.close();
  });

  it('selects the prompt-referenced host target and collects target-named temporary verifier artifacts', () => {
    const spectatorDir = mkdtempSync(join(tmpdir(), 'beale-spectator-target-'));
    createdDirs.push(spectatorDir);
    writeFileSync(join(spectatorDir, 'README.md'), 'spectator fixture\n');
    const { db, context, targetDir } = openStructuredToolDb('host_research_only', {
      title: 'Spectator source audit',
      promptMarkdown: `# Spectator source audit\nUse local repo: ${spectatorDir}`,
      extraAssets: [
        {
          direction: 'in_scope',
          kind: 'repo',
          value: spectatorDir,
          sensitivity: 'public',
          attributes: { repositoryUrl: 'https://github.com/Netflix/spectator' }
        }
      ]
    });
    const router = new BealeToolRouter(db);
    expect(context.run.targetPath).toBe(spectatorDir);
    expect(context.run.targetAssetId).toBeTruthy();

    const python = callTool(router, context, 'python', {
      task: 'report selected host target',
      script: 'import os\nprint(os.environ["BEALE_TARGET_PATH"])',
      artifact_path: ''
    });
    expect(python.status).toBe('success');
    expect(python.payload.hostTargetPath).toBe(spectatorDir);
    expect(python.payload.hostTargetPath).not.toBe(targetDir);

    const verifier = callTool(router, context, 'verifier', {
      hypothesis: 'host verifier bash and artifact policy',
      expectation: 'host verifier should run Bash and collect a target-prefixed temp artifact',
      artifact_id: '',
      trace_event_id: '',
      verifier_script: '#!/usr/bin/env bash\nset -euo pipefail\nprintf verifier-ok | tee /tmp/spectator-verifier.txt',
      artifact_path: '/tmp/spectator-verifier.txt',
      expected_stdout: 'verifier-ok'
    });
    expect(verifier.status).toBe('success');
    expect(verifier.payload.status).toBe('pass');
    expect(verifier.artifact_id).toBeTruthy();
    expect(db.getRunDetail(context.run.id).artifacts.some((artifact) => artifact.kind === 'verifier_output')).toBe(true);
    db.close();
  });

  it('selects an exact prompted domain target instead of unrelated HackerOne metadata aliases', () => {
    const { db, context } = openStructuredToolDb('host_research_only', {
      title: 'Netflix Production Microservice Wildcard Reconnaissance Prod.Ftl.Netflix.Com',
      promptMarkdown: [
        '# Netflix production microservice wildcard reconnaissance',
        '',
        'Focus on the underexplored in-scope primary wildcard domains:',
        '',
        '- `*.prod.ftl.netflix.com`',
        '- `*.prod.cloud.netflix.com`',
        '- `*.prod.dradis.netflix.com`',
        '',
        'Use the scoped network profile only.'
      ].join('\n'),
      extraAssets: [
        hackerOneWildcard('*.nflxext.com', 'Static content is served over this domain'),
        hackerOneWildcard('*.prod.ftl.netflix.com', 'The primary Netflix experience is driven by microservices.'),
        hackerOneWildcard('*.prod.cloud.netflix.com', 'The primary Netflix experience is driven by microservices.'),
        hackerOneWildcard('*.prod.dradis.netflix.com', 'The primary Netflix experience is driven by microservices.')
      ]
    });
    const ftlAsset = db.getActiveScope().assets.find((asset) => asset.value === '*.prod.ftl.netflix.com');

    expect(ftlAsset).toBeTruthy();
    expect(context.run.targetAssetId).toBe(ftlAsset?.id);
    expect(context.run.targetPath).toBeNull();
    db.close();
  });

  it('selects an exact mobile app target instead of a materialized repo owner alias', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'beale-netflix-repo-assets-'));
    createdDirs.push(repoRoot);
    const zuulPath = join(repoRoot, 'github.com_Netflix_zuul');
    mkdirSync(zuulPath, { recursive: true });
    const { db, context } = openStructuredToolDb('host_research_only', {
      title: 'Netflix Android Mobile App High-Impact Audit',
      promptMarkdown: [
        '# Netflix Android mobile app high-impact audit',
        '',
        'Focus on the underexplored in-scope mobile target:',
        '',
        '- Netflix Mobile Application for Android / com.netflix.mediaclient'
      ].join('\n'),
      extraAssets: [
        {
          direction: 'in_scope',
          kind: 'repo',
          value: zuulPath,
          sensitivity: 'public',
          attributes: { repositoryUrl: 'https://github.com/Netflix/zuul' }
        },
        {
          direction: 'in_scope',
          kind: 'domain',
          value: 'com.netflix.mediaclient',
          sensitivity: 'public',
          attributes: {
            source: 'hackerone',
            assetType: 'GOOGLE_PLAY_APP_ID',
            instruction: 'Netflix Mobile Application for Android'
          }
        }
      ]
    });
    const appAsset = db.getActiveScope().assets.find((asset) => asset.value === 'com.netflix.mediaclient');

    expect(appAsset).toBeTruthy();
    expect(context.run.targetAssetId).toBe(appAsset?.id);
    expect(context.run.targetPath).toBeNull();
    db.close();
  });
});

interface ToolOutput {
  status: string;
  summary: string;
  trace_event_id?: string;
  artifact_id?: string;
  payload: Record<string, unknown>;
}

function scopeDraftFromActive(db: WorkspaceDatabase) {
  const scope = db.getActiveScope();
  return {
    programName: scope.programName,
    organizationName: scope.organizationName,
    descriptionMarkdown: scope.descriptionMarkdown,
    rulesMarkdown: scope.rulesMarkdown,
    networkProfile: scope.networkProfile,
    expiresAt: scope.expiresAt,
    assets: scope.assets.map((asset) => ({
      direction: asset.direction,
      kind: asset.kind,
      value: asset.value,
      sensitivity: asset.sensitivity,
      attributes: asset.attributes
    }))
  };
}

function callTool(router: BealeToolRouter, context: CreatedRunContext, name: string, args: Record<string, unknown>): ToolOutput {
  return JSON.parse(
    router.execute(context, {
      callId: `call_${name}_${(callSequence += 1)}`,
      name,
      argumentsJson: JSON.stringify(args)
    }).output
  ) as ToolOutput;
}

function createStructuredRun(db: WorkspaceDatabase, title: string): CreatedRunContext {
  return db.createRun({
    scopeVersionId: db.getActiveScope().id,
    title,
    promptMarkdown: `# ${title}`,
    mode: 'open_discovery',
    model: 'gpt-5.5',
    reasoningEffort: 'xhigh',
    attemptStrategy: 'single_path',
    networkProfile: 'offline',
    sandboxProfile: 'local_disposable_vm',
    budget: { maxMinutes: 5, maxAttempts: 1, maxCostUsd: 0, runEngine: 'openai_responses' }
  });
}

interface StructuredToolDbOptions {
  title?: string;
  promptMarkdown?: string;
  extraAssets?: ScopeAssetInput[];
}

function openStructuredToolDb(
  sandboxProfile = 'local_disposable_vm',
  options: StructuredToolDbOptions = {}
): { db: WorkspaceDatabase; context: CreatedRunContext; sourceFile: string; binaryFile: string; routeFile: string; targetDir: string; logPath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'beale-structured-tools-'));
  createdDirs.push(dir);
  const artifactRoot = join(dir, '.beale', 'artifacts');
  const targetDir = join(dir, 'target');
  mkdirSync(join(artifactRoot, 'sha256'), { recursive: true });
  mkdirSync(join(targetDir, 'src'), { recursive: true });
  mkdirSync(join(targetDir, 'bin'), { recursive: true });
  mkdirSync(join(targetDir, 'config'), { recursive: true });
  mkdirSync(join(targetDir, 'django_app'), { recursive: true });
  mkdirSync(join(targetDir, 'routes'), { recursive: true });

  const sourceFile = join(targetDir, 'src', 'access.c');
  const routeFile = join(targetDir, 'src', 'routes.js');
  const authFile = join(targetDir, 'src', 'auth.js');
  const frameworkFile = join(targetDir, 'src', 'framework-routes.js');
  const binaryFile = join(targetDir, 'bin', 'target.bin');
  const logPath = join(dir, 'vmctl.log');
  writeFileSync(sourceFile, 'int check_access(void) {\n  // authorization boundary\n  return 1;\n}\n');
  writeFileSync(authFile, "export function sharedGuard(req, res, next) {\n  authorize(req.user);\n  next();\n}\n");
  writeFileSync(
    routeFile,
    "import express from 'express';\nimport { sharedGuard } from './auth';\nconst db = require('./db');\nconst router = express.Router();\nrouter.get('/api/users', sharedGuard, listUsers);\nrouter.get('/api/admins', sharedGuard, listAdmins);\nfunction listUsers(req, res) {\n  authorize(req.user);\n  db.query(req.query.filter);\n  res.json([]);\n}\nfunction listAdmins(req, res) {\n  authorize(req.user);\n  db.query(req.query.filter);\n  res.json([]);\n}\nmodule.exports = { listUsers, listAdmins };\n"
  );
  writeFileSync(
    frameworkFile,
    "const fastify = require('fastify')();\nfastify.get('/api/orders', requireAuth, listOrders);\nfastify.route({ method: 'POST', url: '/api/orders', handler: createOrder });\nasync function listOrders(req, reply) {\n  const filter = req.query.filter;\n  const rows = await prisma.order.findMany({ where: filter });\n  return reply.send(rows);\n}\nasync function createOrder(request, reply) {\n  const body = request.body;\n  const row = await prisma.order.create({ data: body });\n  return reply.status(201).send(row);\n}\n"
  );
  writeFileSync(
    binaryFile,
    Buffer.from([
      0,
      1,
      2,
      ...Buffer.from('CRASH_SIG_NEAR_PARSE', 'utf8'),
      0,
      ...Buffer.from('https://example.com/api/mobile', 'utf8'),
      0,
      ...Buffer.from('android.permission.CAMERA', 'utf8'),
      0,
      ...Buffer.from('Java_com_example_Native', 'utf8'),
      0,
      3
    ])
  );
  writeFileSync(join(targetDir, 'package.json'), JSON.stringify({ dependencies: { bealetestdependency: '1.0.0' } }, null, 2));
  writeFileSync(join(targetDir, 'config', 'routes.rb'), "Rails.application.routes.draw do\n  get '/admin/users', to: 'users#index'\n  resources :orders\nend\n");
  writeFileSync(join(targetDir, 'django_app', 'urls.py'), "from django.urls import path\nfrom . import views\nurlpatterns = [\n  path('reports/', views.report_list, name='reports'),\n]\n");
  writeFileSync(join(targetDir, 'routes', 'web.php'), "<?php\nRoute::get('/accounts', [AccountController::class, 'index']);\n");
  writeFileSync(join(targetDir, 'AndroidManifest.xml'), '<manifest><uses-permission android:name="android.permission.CAMERA" /><activity android:name=".MainActivity" android:exported="true" /></manifest>\n');
  writeFileSync(join(targetDir, 'openapi.yaml'), "openapi: 3.0.0\npaths:\n  /v1/widgets:\n    get:\n      responses: {}\n");

  const db = new WorkspaceDatabase(join(dir, '.beale', 'beale.sqlite'), artifactRoot);
  db.initialize();
  db.saveProgramScope({
    programName: 'Structured Tool Program',
    organizationName: 'Example Org',
    descriptionMarkdown: 'Scoped structured tool test.',
    rulesMarkdown: 'Offline guest execution only.',
    networkProfile: 'offline',
    expiresAt: null,
    assets: [
      { direction: 'in_scope', kind: 'path', value: targetDir, sensitivity: 'internal', attributes: {} },
      ...(options.extraAssets ?? []),
      { direction: 'in_scope', kind: 'domain', value: 'live.example.test', sensitivity: 'public', attributes: { protocol: 'tcp', port: 443 } }
    ]
  });
  const context = db.createRun({
    scopeVersionId: db.getActiveScope().id,
    title: options.title ?? 'Structured tool smoke',
    promptMarkdown: options.promptMarkdown ?? '# Structured tool smoke',
    mode: 'open_discovery',
    model: 'gpt-5.5',
    reasoningEffort: 'xhigh',
    attemptStrategy: 'single_path',
    networkProfile: 'offline',
    sandboxProfile,
    budget: { maxMinutes: 5, maxAttempts: 1, maxCostUsd: 0, runEngine: 'openai_responses' }
  });
  return { db, context, sourceFile, binaryFile, routeFile, targetDir, logPath };
}

function hackerOneWildcard(value: string, instruction: string): ScopeAssetInput {
  return {
    direction: 'in_scope',
    kind: 'domain',
    value,
    sensitivity: 'public',
    attributes: {
      source: 'hackerone',
      assetType: 'WILDCARD',
      instruction,
      eligibleForBounty: true,
      eligibleForSubmission: true,
      maxSeverity: 'critical',
      url: 'https://hackerone.com/netflix/scopes/example/edit'
    }
  };
}

function configureVmctlFixture(logPath: string): void {
  process.env.BEALE_VMCTL_COMMAND = process.execPath;
  process.env.BEALE_VMCTL_ARGS_JSON = JSON.stringify([join(process.cwd(), 'tests/fixtures/vmctl-fixture.mjs'), logPath]);
}

function readVmctlEntries(logPath: string): Array<{ input: { action: string; payload: { operation?: { operationKind: string; networkPolicy?: { profile: string } } } } }> {
  const content = readFileSync(logPath, 'utf8').trim();
  if (!content) return [];
  return content.split('\n').map((line) => JSON.parse(line) as { input: { action: string; payload: { operation?: { operationKind: string } } } });
}
