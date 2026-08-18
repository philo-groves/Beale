import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import type { RunDetail, TraceEventRecord, WorkspaceScopeVersion } from '@shared/types';
import {
  COMMENTARY_RENDER_WINDOW_SIZE,
  CommentaryView,
  commentaryFollowLatestAfterScroll,
  commentaryMessageIcon,
  commentaryMessageLabel,
  commentaryMessageSections,
  commentaryScrollFadeClasses,
  commentaryToolValueText,
  commentaryWindowStartForIndex,
  isRunWorkingStatus,
  runWorkingDurationMs,
  shouldAutoExpandToolMessage
} from '../src/renderer/features/commentary/CommentaryView';
import {
  commentaryMessagesForSession,
  commentaryRepositoryMetadataForScope,
  commentaryToolUsageText
} from '../src/renderer/view-models/commentary';
import type { TraceDisplayEvent } from '../src/renderer/view-models/traceDisplay';

describe('renderer commentary projection', () => {
  it('renders the commentary session loading state with a spinner and no composer', () => {
    const html = renderToStaticMarkup(
      createElement(CommentaryView, {
        busy: true,
        detail: null,
        events: [],
        providerModelCatalog: [],
        selectedRunId: 'run_loading',
        showBackToMain: false,
        searchHighlightQuery: '',
        onBackToMain: () => undefined,
        onSessionAction: () => undefined,
        onSteerInstruction: () => undefined
      })
    );

    expect(html).toContain('main-trace-view main-commentary-view is-loading');
    expect(html).toContain('class="centered-loading-state main-session-loading"');
    expect(html).toContain('class="centered-loading-state-spinner"');
    expect(html).not.toContain('lucide-loader-circle');
    expect(html).toContain('Loading session');
    expect(html).not.toContain('Loading session.');
    expect(html).not.toContain('class="main-trace-footer"');
  });

  it('keeps the working disclosure aligned to the commentary text width', () => {
    const styles = readFileSync(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');
    const messageStyles = styles.match(/\.main-commentary-message\s*\{([^}]*)\}/)?.[1] ?? '';
    const disclosureStyles = styles.match(/\.run-work-disclosure\s*\{([^}]*)\}/)?.[1] ?? '';

    expect(messageStyles).toContain('max-width: var(--trace-content-max-width)');
    expect(disclosureStyles).toContain('max-width: var(--trace-content-max-width)');
    expect(disclosureStyles).toContain('margin-inline: auto');
  });

  it('labels subagent assignments by lifecycle action', () => {
    expect(commentaryMessageLabel('user')).toBeNull();
    expect(commentaryMessageLabel('commentary')).toBeNull();
    expect(commentaryMessageLabel('progress')).toBeNull();
    expect(commentaryMessageLabel('tool')).toBeNull();
    expect(commentaryMessageLabel('task', 'spawn')).toBe('Subagent Spawn');
    expect(commentaryMessageLabel('task', 'followup')).toBe('Subagent Follow-up');
    expect(commentaryMessageLabel('final_answer')).toBeNull();
    expect(commentaryMessageLabel('error')).toBeNull();
  });

  it('uses distinct icons for reasoning and each tool family', () => {
    const progressIcon = commentaryMessageIcon('progress');
    expect(progressIcon).not.toBeNull();
    if (progressIcon) expect(renderToStaticMarkup(progressIcon)).toContain('lucide-brain');
    expect(renderToStaticMarkup(commentaryMessageIcon('tool', 'list_agents')!)).toContain('lucide-bot');
    expect(renderToStaticMarkup(commentaryMessageIcon('tool', 'wait_agent')!)).toContain('lucide-bot');
    expect(renderToStaticMarkup(commentaryMessageIcon('tool', 'runbook.get')!)).toContain('lucide-book-open');
    expect(renderToStaticMarkup(commentaryMessageIcon('tool', 'memory.search')!)).toContain('lucide-database');
    expect(renderToStaticMarkup(commentaryMessageIcon('tool', 'shell.run')!)).toContain('lucide-terminal');
    expect(renderToStaticMarkup(commentaryMessageIcon('tool', 'experiment.run')!)).toContain('lucide-terminal');
    expect(renderToStaticMarkup(commentaryMessageIcon('tool', 'file.read')!)).toContain('lucide-wrench');
    expect(renderToStaticMarkup(commentaryMessageIcon('error')!)).toContain('lucide-circle-alert');
    expect(commentaryMessageIcon('commentary')).toBeNull();
    expect(commentaryMessageIcon('final_answer')).toBeNull();
  });

  it('uses concise sentence-case singular and plural copy for known and fallback tools', () => {
    expect(commentaryToolUsageText('list_agents', 1)).toBe('Checking subagents');
    expect(commentaryToolUsageText('list_agents', 2)).toBe('Checking subagents 2 times');
    expect(commentaryToolUsageText('file.read', 1)).toBe('Reading a file');
    expect(commentaryToolUsageText('file.read', 1, 'src/Parser.ts')).toBe('Reading src/Parser.ts');
    expect(commentaryToolUsageText('file.read', 1, 'C:\\Users\\alice\\repo\\src\\Parser.ts'))
      .toBe('Reading ~/repo/src/Parser.ts');
    expect(commentaryToolUsageText('file.read', 1, '/home/alice/repo/src/Parser.ts'))
      .toBe('Reading ~/repo/src/Parser.ts');
    expect(commentaryToolUsageText('file.read', 1, '/Users/alice/repo/src/Parser.ts'))
      .toBe('Reading ~/repo/src/Parser.ts');
    expect(commentaryToolUsageText('file.read', 1, '/root/repo/src/Parser.ts'))
      .toBe('Reading ~/repo/src/Parser.ts');
    expect(commentaryToolUsageText('file.read', 1, 'C:\\Users\\Public\\Parser.ts'))
      .toBe('Reading C:\\Users\\Public\\Parser.ts');
    expect(commentaryToolUsageText('file.read', 3)).toBe('Reading 3 files');
    expect(commentaryToolUsageText('memory.get', 3)).toBe('Reading 3 memories');
    expect(commentaryToolUsageText('memory.search', 3)).toBe('Searching memory with 3 queries');
    expect(commentaryToolUsageText('shell.run', 1)).toBe('Running a command');
    expect(commentaryToolUsageText('shell.run', 1, 'npm run Check')).toBe('Running npm run Check');
    expect(commentaryToolUsageText('shell.run', 4)).toBe('Running 4 commands');
    expect(commentaryToolUsageText('mcp.browser.snapshot', 1)).toBe('Using snapshot');
    expect(commentaryToolUsageText('custom.scan', 2)).toBe('Using custom scan 2 times');
  });

  it('shows one activity row per tool call, coalesces repeats, and suppresses paired results', () => {
    const messages = commentaryMessagesForSession(runDetail('Inspect the parser.'), [
      toolEvent('agents-request', 'tool.requested', 'list_agents', 'agents', {}),
      toolEvent('agents-result', 'tool.observed', 'list_agents', 'agents', {}, { agents: [{ path: '/root/parser' }] }),
      toolEvent('read-one-request', 'tool.requested', 'file.read', 'read-one', { path: 'src/parser.ts' }),
      toolEvent('read-one-result', 'tool.observed', 'file.read', 'read-one', { path: 'src/parser.ts' }, { text: 'first file' }),
      toolEvent('read-two-request', 'tool.requested', 'file.read', 'read-two', { path: 'src/token.ts' }),
      toolEvent('read-two-result', 'tool.observed', 'file.read', 'read-two', { path: 'src/token.ts' }, { text: 'second file' }),
      toolEvent('shell-request', 'tool.requested', 'shell.run', 'shell', { utility: 'npm', args: ['test'] }),
      toolEvent('repository-result', 'tool.observed', 'repository.search', 'repository-only', { query: 'decodeToken', path: '/work/parser' }, { matches: 2 }),
      toolEvent('spawn-request', 'tool.requested', 'spawn_agent', 'spawn'),
      displayEvent('spawn', {
        type: 'subagent.activity',
        action: 'spawned',
        agentPath: '/root/parser_review',
        message: 'Inspect the parser boundary.'
      }, { source: 'system' })
    ]);

    expect(messages.map(({ kind, toolName, toolCount, contentMarkdown }) => [
      kind,
      toolName,
      toolCount,
      contentMarkdown
    ])).toEqual([
      ['user', undefined, undefined, 'Inspect the parser.'],
      ['tool', 'list_agents', 1, 'Checking subagents'],
      ['tool', 'file.read', 2, 'Reading 2 files'],
      ['tool', 'shell.run', 1, 'Running npm test'],
      ['tool', 'repository.search', 1, 'Querying parser for "decodeToken"'],
      ['task', undefined, undefined, 'Inspect the parser boundary.']
    ]);

    expect(messages.find((message) => message.toolName === 'file.read')?.toolCalls).toEqual([
      {
        id: 'read-one-request',
        traceEventId: 'read-one-result',
        label: 'src/parser.ts',
        input: { path: 'src/parser.ts' },
        output: { text: 'first file' }
      },
      {
        id: 'read-two-request',
        traceEventId: 'read-two-result',
        label: 'src/token.ts',
        input: { path: 'src/token.ts' },
        output: { text: 'second file' }
      }
    ]);
    expect(messages.find((message) => message.toolName === 'shell.run')?.toolCalls).toEqual([
      {
        id: 'shell-request',
        traceEventId: 'shell-request',
        label: 'npm test',
        input: { utility: 'npm', args: ['test'] },
        output: 'Waiting for output.'
      }
    ]);
    expect(messages.find((message) => message.toolName === 'repository.search')?.toolCalls).toEqual([
      {
        id: 'repository-result',
        traceEventId: 'repository-result',
        label: 'Querying parser for "decodeToken"',
        repositorySearch: {
          repositories: ['/work/parser'],
          repositoryNames: ['parser'],
          query: 'decodeToken'
        },
        input: { query: 'decodeToken', path: '/work/parser' },
        output: { matches: 2 }
      }
    ]);
  });

  it('formats tool input and output values for expanded details', () => {
    expect(commentaryToolValueText({ path: 'src/parser.ts', lines: [1, 2] })).toBe(
      '{\n  "path": "src/parser.ts",\n  "lines": [\n    1,\n    2\n  ]\n}'
    );
    expect(commentaryToolValueText('Waiting for output.')).toBe('Waiting for output.');
    expect(commentaryToolValueText(null)).toBe('null');
  });

  it('shows the actual one-line shell command before its details are expanded', () => {
    const messages = commentaryMessagesForSession(runDetail('Run the checks.'), [
      toolEvent('shell-command-request', 'tool.requested', 'shell.run', 'shell-command', {
        command: 'npm test\n  -- --runInBand'
      })
    ]);

    expect(messages.find((message) => message.toolName === 'shell.run')?.toolCalls?.[0]?.label)
      .toBe('npm test -- --runInBand');
    expect(messages.find((message) => message.toolName === 'shell.run')?.contentMarkdown)
      .toBe('Running npm test -- --runInBand');
  });

  it('labels singular and grouped repository searches from repositories and query calls', () => {
    const detail = runDetail('Search the repositories.');
    const repositoryMetadata = commentaryRepositoryMetadataForScope({
      assets: [
        {
          id: 'repository-source',
          direction: 'in_scope',
          kind: 'repo',
          value: 'https://github.com/example/parser.git',
          attributes: {
            displayName: 'Parser Metadata Name',
            repositoryUrl: 'https://github.com/example/parser.git'
          }
        },
        {
          id: 'repository-checkout',
          direction: 'in_scope',
          kind: 'repo',
          value: 'C:\\Users\\alice\\work\\parser.git',
          attributes: {
            repositoryUrl: 'https://github.com/example/parser.git',
            sourceAssetId: 'repository-source'
          }
        },
        {
          id: 'runtime-checkout',
          direction: 'in_scope',
          kind: 'repo',
          value: 'C:\\Users\\alice\\.honeycrisp\\repositories\\github.com_example_runtime\\default',
          attributes: {
            repositoryUrl: 'https://github.com/example/runtime.git'
          }
        }
      ]
    } as unknown as WorkspaceScopeVersion);
    const singular = commentaryMessagesForSession(detail, [
      toolEvent('repo-one-request', 'tool.requested', 'repository.search', 'repo-one', {
        query: 'decodeToken'
      }),
      toolEvent('repo-one-result', 'tool.observed', 'repository.search', 'repo-one', {
        query: 'decodeToken'
      }, {
        roots: ['C:\\Users\\alice\\work\\parser.git'],
        query: 'decodeToken',
        matches: []
      })
    ], { repositoryMetadata }).find((message) => message.toolName === 'repository.search');
    expect(singular?.contentMarkdown).toBe('Querying Parser Metadata Name for "decodeToken"');
    expect(singular?.toolCalls?.[0]?.label).toBe('Querying Parser Metadata Name for "decodeToken"');

    const urlNamed = commentaryMessagesForSession(detail, [
      toolEvent('repo-url-request', 'tool.requested', 'repository.search', 'repo-url', {
        query: 'loadConfig'
      }),
      toolEvent('repo-url-result', 'tool.observed', 'repository.search', 'repo-url', {
        query: 'loadConfig'
      }, {
        roots: ['C:\\Users\\alice\\.honeycrisp\\repositories\\github.com_example_runtime\\default\\app'],
        query: 'loadConfig',
        matches: []
      })
    ], { repositoryMetadata }).find((message) => message.toolName === 'repository.search');
    expect(urlNamed?.contentMarkdown).toBe('Querying runtime for "loadConfig"');
    expect(urlNamed?.toolCalls?.[0]?.label).toBe('Querying runtime for "loadConfig"');

    const grouped = commentaryMessagesForSession(detail, [
      toolEvent('repo-parser-one-request', 'tool.requested', 'repository.search', 'repo-parser-one', {
        query: 'decodeToken'
      }),
      toolEvent('repo-parser-one-result', 'tool.observed', 'repository.search', 'repo-parser-one', {
        query: 'decodeToken'
      }, { roots: ['/work/parser'], query: 'decodeToken', matches: [] }),
      toolEvent('repo-parser-two-request', 'tool.requested', 'repository.search', 'repo-parser-two', {
        query: 'encodeToken'
      }),
      toolEvent('repo-parser-two-result', 'tool.observed', 'repository.search', 'repo-parser-two', {
        query: 'encodeToken'
      }, { roots: ['/work/parser/'], query: 'encodeToken', matches: [] }),
      toolEvent('repo-runtime-request', 'tool.requested', 'repository.search', 'repo-runtime', {
        query: 'token boundary'
      }),
      toolEvent('repo-runtime-result', 'tool.observed', 'repository.search', 'repo-runtime', {
        query: 'token boundary'
      }, { roots: ['/work/runtime'], query: 'token boundary', matches: [] })
    ]).find((message) => message.toolName === 'repository.search');
    expect(grouped).toMatchObject({
      toolCount: 3,
      contentMarkdown: 'Searching 2 repositories with 3 queries'
    });
    expect(grouped?.toolCalls).toHaveLength(3);
    expect(grouped?.toolCalls?.map((toolCall) => toolCall.label)).toEqual([
      'Querying parser for "decodeToken"',
      'Querying parser for "encodeToken"',
      'Querying runtime for "token boundary"'
    ]);

    const sameRepository = commentaryMessagesForSession(detail, [
      toolEvent('repo-same-one', 'tool.requested', 'repository.search', 'repo-same-one', {
        path: '/work/parser',
        query: 'decodeToken'
      }),
      toolEvent('repo-same-two', 'tool.requested', 'repository.search', 'repo-same-two', {
        path: '/work/parser',
        query: 'encodeToken'
      })
    ]).find((message) => message.toolName === 'repository.search');
    expect(sameRepository?.contentMarkdown).toBe('Searching 1 repository with 2 queries');
  });

  it('labels singular and grouped memory searches with their queries', () => {
    const detail = runDetail('Search memory.');
    const singular = commentaryMessagesForSession(detail, [
      toolEvent('memory-one', 'tool.requested', 'memory.search', 'memory-one', {
        query: 'parser boundary'
      })
    ]).find((message) => message.toolName === 'memory.search');
    expect(singular).toMatchObject({
      toolCount: 1,
      contentMarkdown: 'Searching memory for "parser boundary"'
    });
    expect(singular?.toolCalls?.[0]?.label).toBe('Searching memory for "parser boundary"');

    const grouped = commentaryMessagesForSession(detail, [
      toolEvent('memory-parser', 'tool.requested', 'memory.search', 'memory-parser', {
        query: 'parser boundary'
      }),
      toolEvent('memory-runtime', 'tool.requested', 'memory.search', 'memory-runtime', {
        query: 'runtime assumptions'
      })
    ]).find((message) => message.toolName === 'memory.search');
    expect(grouped).toMatchObject({
      toolCount: 2,
      contentMarkdown: 'Searching memory with 2 queries'
    });
    expect(grouped?.toolCalls?.map((toolCall) => toolCall.label)).toEqual([
      'Searching memory for "parser boundary"',
      'Searching memory for "runtime assumptions"'
    ]);
    const styles = readFileSync(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');
    const summaryTextStyles = styles.match(/\.main-commentary-tool-summary\s*>\s*span\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(summaryTextStyles).toContain('min-width: 0');
    expect(summaryTextStyles).toContain('overflow: hidden');
    expect(summaryTextStyles).toContain('text-overflow: ellipsis');
    expect(summaryTextStyles).toContain('white-space: nowrap');
  });

  it('renders singular commands and file reads inline while keeping grouped calls expandable', () => {
    const detail = runDetail('Run the checks.');
    const singleHtml = renderToStaticMarkup(createElement(CommentaryView, {
      busy: false,
      detail,
      events: [toolEvent('single-shell', 'tool.requested', 'shell.run', 'single-shell', { command: 'npm test' })],
      providerModelCatalog: [],
      selectedRunId: detail.run.id,
      showBackToMain: true,
      searchHighlightQuery: '',
      onBackToMain: () => undefined,
      onSessionAction: () => undefined,
      onSteerInstruction: () => undefined
    }));
    expect(singleHtml).toContain('aria-expanded="false" class="main-commentary-tool-call-summary main-commentary-single-tool"');
    expect(singleHtml).toContain('<span class="main-commentary-single-tool-label">Running npm test</span>');
    expect(singleHtml).not.toContain('main-commentary-tool-summary');
    expect(singleHtml).toContain('lucide-chevron-right main-commentary-single-tool-chevron');
    const styles = readFileSync(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');
    const singleToolChevronStyles = styles.match(/\.main-commentary-single-tool-chevron\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(singleToolChevronStyles).toContain('opacity: 0');
    expect(singleToolChevronStyles).toContain('opacity 120ms ease');
    expect(styles).toContain('.main-commentary-message.kind-tool:hover .main-commentary-single-tool-chevron');

    const fileEvents = [
      toolEvent('file-one', 'tool.requested', 'file.read', 'file-one', { path: 'C:\\Users\\alice\\repo\\src\\Parser.ts' })
    ];
    expect(commentaryMessagesForSession(detail, fileEvents).find((message) => message.toolName === 'file.read'))
      .toMatchObject({ toolCount: 1, contentMarkdown: 'Reading ~/repo/src/Parser.ts' });
    const fileHtml = renderToStaticMarkup(createElement(CommentaryView, {
      busy: false,
      detail,
      events: fileEvents,
      providerModelCatalog: [],
      selectedRunId: detail.run.id,
      showBackToMain: true,
      searchHighlightQuery: '',
      onBackToMain: () => undefined,
      onSessionAction: () => undefined,
      onSteerInstruction: () => undefined
    }));
    expect(fileHtml).toContain('<span class="main-commentary-single-tool-label">Reading ~/repo/src/Parser.ts</span>');
    expect(fileHtml).toContain('lucide-chevron-right main-commentary-single-tool-chevron');
    expect(commentaryMessagesForSession(detail, fileEvents).find((message) => message.toolName === 'file.read')?.toolCalls?.[0]?.input)
      .toEqual({ path: 'C:\\Users\\alice\\repo\\src\\Parser.ts' });

    const multipleEvents = [
      toolEvent('shell-one', 'tool.requested', 'shell.run', 'shell-one', { command: 'npm test' }),
      toolEvent('shell-two', 'tool.requested', 'shell.run', 'shell-two', { command: 'npm run typecheck' })
    ];
    const multipleMessages = commentaryMessagesForSession(detail, multipleEvents);
    const shellMessage = multipleMessages.find((message) => message.toolName === 'shell.run');
    expect(shellMessage).toMatchObject({ toolCount: 2, contentMarkdown: 'Running 2 commands' });
    expect(shellMessage?.toolCalls).toHaveLength(2);
    const multipleHtml = renderToStaticMarkup(createElement(CommentaryView, {
      busy: false,
      detail,
      events: multipleEvents,
      providerModelCatalog: [],
      selectedRunId: detail.run.id,
      showBackToMain: true,
      searchHighlightQuery: '',
      onBackToMain: () => undefined,
      onSessionAction: () => undefined,
      onSteerInstruction: () => undefined
    }));
    expect(multipleHtml).toContain('class="main-commentary-tool-summary"');
    expect(multipleHtml).toContain('<span>Running 2 commands</span>');
    expect(multipleHtml).toContain('main-commentary-tool-summary-chevron');
  });

  it('unwraps the executed shell result when the requested utility is null', () => {
    const messages = commentaryMessagesForSession(runDetail('Run the local helper.'), [
      toolEvent('shell-null-request', 'tool.requested', 'shell.run', 'shell-null', {
        utility: null,
        args: []
      }),
      toolEvent('shell-null-result', 'tool.observed', 'shell.run', 'shell-null', {
        utility: null,
        args: []
      }, {
        utility: '/bin/sh',
        args: ['-lc', 'tools/rr ping']
      })
    ]);

    expect(messages.find((message) => message.toolName === 'shell.run')?.toolCalls?.[0]?.label)
      .toBe('tools/rr ping');
  });

  it('auto-expands a tool summary only while it is the latest chat item', () => {
    const trailingToolMessages = commentaryMessagesForSession(runDetail('Inspect the parser.'), [
      toolEvent('read-request', 'tool.requested', 'file.read', 'read', { path: 'src/parser.ts' })
    ]);
    expect(shouldAutoExpandToolMessage(trailingToolMessages, 0)).toBe(false);
    expect(shouldAutoExpandToolMessage(trailingToolMessages, 1)).toBe(true);

    const followedToolMessages = commentaryMessagesForSession(runDetail('Inspect the parser.'), [
      toolEvent('read-request', 'tool.requested', 'file.read', 'read', { path: 'src/parser.ts' }),
      displayEvent('commentary-after-tool', {
        agentPath: '/root',
        transcriptRole: 'assistant',
        transcriptSource: 'honeycrisp_commentary',
        messagePhase: 'commentary',
        text: 'The parser is ready for the next check.'
      })
    ]);
    expect(shouldAutoExpandToolMessage(followedToolMessages, 1)).toBe(false);
    expect(shouldAutoExpandToolMessage(followedToolMessages, 2)).toBe(false);
  });

  it('shows chat scroll fades only where more content remains', () => {
    expect(commentaryScrollFadeClasses({ scrollHeight: 100, clientHeight: 100, scrollTop: 0 })).toEqual({
      'has-top-fade': false,
      'has-bottom-fade': false
    });
    expect(commentaryScrollFadeClasses({ scrollHeight: 300, clientHeight: 100, scrollTop: 0 })).toEqual({
      'has-top-fade': false,
      'has-bottom-fade': true
    });
    expect(commentaryScrollFadeClasses({ scrollHeight: 300, clientHeight: 100, scrollTop: 100 })).toEqual({
      'has-top-fade': true,
      'has-bottom-fade': true
    });
    expect(commentaryScrollFadeClasses({ scrollHeight: 300, clientHeight: 100, scrollTop: 200 })).toEqual({
      'has-top-fade': true,
      'has-bottom-fade': false
    });
  });

  it('preserves bottom stickiness across layout-driven tool expansion and collapse', () => {
    expect(commentaryFollowLatestAfterScroll({
      wasFollowingLatest: true,
      distanceFromBottom: 180,
      userInitiated: false
    })).toBe(true);
    expect(commentaryFollowLatestAfterScroll({
      wasFollowingLatest: true,
      distanceFromBottom: 180,
      userInitiated: true
    })).toBe(false);
    expect(commentaryFollowLatestAfterScroll({
      wasFollowingLatest: false,
      distanceFromBottom: 180,
      userInitiated: false
    })).toBe(false);
    expect(commentaryFollowLatestAfterScroll({
      wasFollowingLatest: false,
      distanceFromBottom: 12,
      userInitiated: false
    })).toBe(true);
  });

  it('centers selected history within a bounded commentary render window', () => {
    expect(commentaryWindowStartForIndex(140, 0)).toBe(0);
    expect(commentaryWindowStartForIndex(140, 70)).toBe(50);
    expect(commentaryWindowStartForIndex(140, 139)).toBe(80);
  });

  it('renders only the latest bounded window for long commentary histories', () => {
    const detail = runDetail('Review the target.');
    const events = Array.from({ length: 100 }, (_, index) => displayEvent(`commentary-${index}`, {
      agentPath: '/root',
      transcriptRole: 'assistant',
      transcriptSource: 'honeycrisp_commentary',
      messagePhase: 'commentary',
      text: `Commentary message ${index}`
    }, { sequence: index }));

    const html = renderToStaticMarkup(
      createElement(CommentaryView, {
        busy: false,
        detail,
        events,
        providerModelCatalog: [],
        selectedRunId: detail.run.id,
        showBackToMain: true,
        searchHighlightQuery: '',
        onBackToMain: () => undefined,
        onSessionAction: () => undefined,
        onSteerInstruction: () => undefined
      })
    );

    expect(html.match(/data-commentary-event-id=/g)).toHaveLength(COMMENTARY_RENDER_WINDOW_SIZE);
    expect(html).toContain('Commentary message 99');
    expect(html).not.toContain('Commentary message 0<');
    expect(html).toContain('main-commentary-spacer');
  });

  it('shows user, native commentary, and final messages while suppressing paired reasoning fallback', () => {
    const messages = commentaryMessagesForSession(runDetail('Inspect the parser.'), [
      displayEvent('prompt', {
        transcriptRole: 'user',
        transcriptSource: 'run_prompt',
        text: 'Inspect the parser.'
      }),
      displayEvent('reasoning', {
        agentPath: '/root',
        responseId: 'response_one',
        transcriptRole: 'assistant',
        transcriptSource: 'openai_reasoning_summary',
        text: 'Checking parser entrypoints.'
      }),
      displayEvent('commentary', {
        agentPath: '/root',
        responseId: 'response_one',
        messagePhase: 'commentary',
        transcriptRole: 'assistant',
        transcriptSource: 'honeycrisp_commentary',
        text: 'I found two parser entrypoints and am checking their shared guard.'
      }),
      displayEvent('tool', { agentPath: '/root', text: 'Raw shell output.' }, { source: 'tool', type: 'tool_result' }),
      displayEvent('final', {
        agentPath: '/root',
        responseId: 'response_two',
        messagePhase: 'final_answer',
        transcriptRole: 'assistant',
        transcriptSource: 'honeycrisp',
        text: 'The shared guard rejects the boundary safely.'
      })
    ]);

    expect(messages.map(({ kind, contentMarkdown }) => [kind, contentMarkdown])).toEqual([
      ['user', 'Inspect the parser.'],
      ['commentary', 'I found two parser entrypoints and am checking their shared guard.'],
      ['final_answer', 'The shared guard rejects the boundary safely.']
    ]);
  });

  it('projects failed final Honeycrisp results as error messages', () => {
    const messages = commentaryMessagesForSession(runDetail('Inspect the parser.'), [
      displayEvent('final-error', {
        agentPath: '/root',
        transcriptRole: 'assistant',
        transcriptSource: 'honeycrisp',
        messagePhase: 'final_answer',
        finalResultKind: 'error',
        outputText: 'Unexpected error'
      })
    ], { includeInitialPrompt: false });

    expect(messages.map(({ kind, contentMarkdown }) => [kind, contentMarkdown])).toEqual([
      ['error', 'Unexpected error']
    ]);
  });

  it('normalizes legacy terminated Honeycrisp final text as an unexpected error', () => {
    const messages = commentaryMessagesForSession(runDetail('Inspect the parser.'), [
      displayEvent('legacy-final-error', {
        agentPath: '/root',
        transcriptRole: 'assistant',
        transcriptSource: 'honeycrisp',
        messagePhase: 'final_answer',
        text: 'terminated'
      })
    ], { includeInitialPrompt: false });

    expect(messages.map(({ kind, contentMarkdown }) => [kind, contentMarkdown])).toEqual([
      ['error', 'Unexpected error']
    ]);
  });

  it('adds an unexpected-error final message for legacy interrupted restart recovery', () => {
    const detail = runDetail('Inspect the parser.');
    detail.run.status = 'paused';
    detail.attempts = [{ id: 'attempt_one' }] as RunDetail['attempts'];
    const messages = commentaryMessagesForSession(detail, [
      displayEvent('commentary', {
        agentPath: '/root',
        transcriptRole: 'assistant',
        transcriptSource: 'honeycrisp_commentary',
        messagePhase: 'commentary',
        text: 'I am inspecting the parser.'
      }),
      displayEvent('recovery', { interruptedByRecovery: true }, {
        sequence: 2,
        source: 'system',
        type: 'research_event',
        summary: 'Workspace recovery paused interrupted run after app restart.'
      })
    ], { includeInitialPrompt: false });

    expect(messages.map(({ kind, contentMarkdown }) => [kind, contentMarkdown])).toEqual([
      ['commentary', 'I am inspecting the parser.'],
      ['error', 'Unexpected error']
    ]);
  });

  it('preserves legacy wrapped Honeycrisp error details when present', () => {
    const messages = commentaryMessagesForSession(runDetail('Inspect the parser.'), [
      displayEvent('legacy-wrapped-error', {
        agentPath: '/root',
        transcriptRole: 'assistant',
        transcriptSource: 'honeycrisp',
        messagePhase: 'final_answer',
        text: 'Research agent failed: Provider request failed with status 500.'
      })
    ], { includeInitialPrompt: false });

    expect(messages.map(({ kind, contentMarkdown }) => [kind, contentMarkdown])).toEqual([
      ['error', 'Provider request failed with status 500.']
    ]);
  });

  it('retains newer fallback progress after native commentary and coalesces its snapshots', () => {
    const messages = commentaryMessagesForSession(runDetail('Continue the review.'), [
      displayEvent('paired-reasoning', {
        agentPath: '/root',
        responseId: 'response_native',
        transcriptRole: 'assistant',
        transcriptSource: 'openai_reasoning_summary',
        itemId: 'reasoning_native',
        text: 'Paired provider reasoning.'
      }),
      displayEvent('native', {
        agentPath: '/root',
        responseId: 'response_native',
        transcriptRole: 'assistant',
        transcriptSource: 'honeycrisp_commentary',
        messagePhase: 'commentary',
        text: 'Native commentary for the first response.'
      }),
      displayEvent('progress-first', {
        agentPath: '/root',
        responseId: 'response_fallback',
        transcriptRole: 'assistant',
        transcriptSource: 'openai_reasoning_summary',
        itemId: 'reasoning_fallback',
        text: 'Initial fallback snapshot.'
      }),
      displayEvent('progress-completed', {
        agentPath: '/root',
        responseId: 'response_fallback',
        transcriptRole: 'assistant',
        transcriptSource: 'openai_reasoning_summary',
        itemId: 'reasoning_fallback',
        text: 'Completed fallback snapshot.'
      })
    ]);

    expect(messages.map(({ kind, contentMarkdown }) => [kind, contentMarkdown])).toEqual([
      ['user', 'Continue the review.'],
      ['commentary', 'Native commentary for the first response.'],
      ['progress', 'Completed fallback snapshot.']
    ]);
  });

  it('keeps the prompt and terminal result outside the collapsible work history', () => {
    const messages = commentaryMessagesForSession(runDetail('Inspect the parser.'), [
      displayEvent('commentary', {
        agentPath: '/root',
        transcriptRole: 'assistant',
        transcriptSource: 'honeycrisp_commentary',
        messagePhase: 'commentary',
        text: 'Checking parser entrypoints.'
      }),
      displayEvent('final', {
        agentPath: '/root',
        transcriptRole: 'assistant',
        transcriptSource: 'honeycrisp',
        messagePhase: 'final_answer',
        text: 'The parser boundary is safe.'
      })
    ]);

    const sections = commentaryMessageSections(messages, true);
    expect(sections.leading.map((message) => message.kind)).toEqual(['user']);
    expect(sections.activity.map((message) => message.kind)).toEqual(['commentary']);
    expect(sections.trailing.map((message) => message.kind)).toEqual(['final_answer']);
  });

  it('sums execution-attempt time for the run work duration', () => {
    const detail = runDetail('Inspect the parser.');
    detail.run.startedAt = '2026-08-03T10:00:00.000Z';
    detail.run.endedAt = '2026-08-03T10:04:00.000Z';
    detail.attempts = [
      { startedAt: '2026-08-03T10:00:00.000Z', endedAt: '2026-08-03T10:01:00.000Z' },
      { startedAt: '2026-08-03T10:03:00.000Z', endedAt: null }
    ] as RunDetail['attempts'];

    expect(runWorkingDurationMs(detail, Date.parse('2026-08-03T10:04:30.000Z'))).toBe(150_000);
  });

  it('treats only an active run as currently working', () => {
    expect(isRunWorkingStatus('active')).toBe(true);
    expect(isRunWorkingStatus('queued')).toBe(false);
    expect(isRunWorkingStatus('paused')).toBe(false);
    expect(isRunWorkingStatus('blocked')).toBe(false);
    expect(isRunWorkingStatus('completed')).toBe(false);
    expect(isRunWorkingStatus('failed')).toBe(false);
    expect(isRunWorkingStatus('stopped')).toBe(false);
  });

  it('caps an unfinished attempt at its last recorded activity when the run is no longer active', () => {
    const detail = runDetail('Inspect the parser.');
    detail.run.status = 'paused';
    detail.run.budget = { modelProvider: 'openai-codex' };
    detail.run.model = 'gpt-5.6-sol';
    detail.run.reasoningEffort = 'medium';
    detail.run.startedAt = '2026-08-03T09:00:00.000Z';
    detail.run.endedAt = null;
    detail.attempts = [{
      startedAt: detail.run.startedAt,
      endedAt: null
    }] as RunDetail['attempts'];
    const commentary = displayEvent('commentary', {
      agentPath: '/root',
      transcriptRole: 'assistant',
      transcriptSource: 'honeycrisp_commentary',
      messagePhase: 'commentary',
      text: 'Checking parser entrypoints.'
    }, { createdAt: '2026-08-03T11:00:00.000Z' });
    detail.traceEvents = [commentary];

    const html = renderToStaticMarkup(
      createElement(CommentaryView, {
        busy: false,
        detail,
        events: [commentary],
        providerModelCatalog: [],
        selectedRunId: detail.run.id,
        showBackToMain: false,
        searchHighlightQuery: '',
        onBackToMain: () => undefined,
        onSessionAction: () => undefined,
        onSteerInstruction: () => undefined
      })
    );

    expect(html).toContain('Worked for 02:00:00');
    expect(html).toContain('aria-expanded="false"');
  });

  it('collapses stopped commentary and tool work behind a Worked header', () => {
    const detail = runDetail('Inspect the parser.');
    detail.run.status = 'stopped';
    detail.run.budget = { modelProvider: 'openai-codex' };
    detail.run.model = 'gpt-5.6-sol';
    detail.run.reasoningEffort = 'medium';
    detail.run.startedAt = '2026-08-03T10:00:00.000Z';
    detail.run.endedAt = '2026-08-03T10:02:30.000Z';
    detail.attempts = [{
      startedAt: detail.run.startedAt,
      endedAt: detail.run.endedAt
    }] as RunDetail['attempts'];
    const events = [
      displayEvent('commentary', {
        agentPath: '/root',
        transcriptRole: 'assistant',
        transcriptSource: 'honeycrisp_commentary',
        messagePhase: 'commentary',
        text: 'Checking parser entrypoints.'
      }),
      displayEvent('final', {
        agentPath: '/root',
        transcriptRole: 'assistant',
        transcriptSource: 'honeycrisp',
        messagePhase: 'final_answer',
        text: 'The parser boundary is safe.'
      })
    ];

    const html = renderToStaticMarkup(
      createElement(CommentaryView, {
        busy: false,
        detail,
        events,
        providerModelCatalog: [],
        selectedRunId: detail.run.id,
        showBackToMain: false,
        searchHighlightQuery: '',
        onBackToMain: () => undefined,
        onSessionAction: () => undefined,
        onSteerInstruction: () => undefined
      })
    );

    expect(html).toContain('Worked for 00:02:30');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('The parser boundary is safe.');
    expect(html).not.toContain('Checking parser entrypoints.');
  });

  it('renders xAI reasoning summaries as ordinary commentary while retaining their trace source', () => {
    const events = [
      displayEvent('grok-reasoning', {
        agentPath: '/root',
        responseId: 'response_grok',
        provider: 'xai',
        model: 'grok-4.6',
        transcriptRole: 'assistant',
        transcriptSource: 'openai_reasoning_summary',
        text: 'The redirect strips the original path, so I am checking the destination surface.'
      })
    ];
    const detail = runDetail('Inspect the redirect boundary.');
    const messages = commentaryMessagesForSession(detail, events);

    expect(messages.map(({ kind, contentMarkdown }) => [kind, contentMarkdown])).toEqual([
      ['user', 'Inspect the redirect boundary.'],
      ['commentary', 'The redirect strips the original path, so I am checking the destination surface.']
    ]);

    const html = renderToStaticMarkup(
      createElement(CommentaryView, {
        busy: true,
        detail,
        events,
        providerModelCatalog: [],
        selectedRunId: detail.run.id,
        showBackToMain: true,
        searchHighlightQuery: '',
        onBackToMain: () => undefined,
        onSessionAction: () => undefined,
        onSteerInstruction: () => undefined
      })
    );

    expect(html).toContain('The redirect strips the original path');
    expect(html).not.toContain('lucide-brain');
  });

  it('preserves each coalesced reasoning trace as its own commentary line', () => {
    const messages = commentaryMessagesForSession(runDetail('Review the parser.'), [
      displayEvent('reasoning-group', {
        agentPath: '/root',
        responseId: 'response_group',
        transcriptRole: 'assistant',
        transcriptSource: 'openai_reasoning_summary',
        text: '**Inspecting the parser**\n\n**Checking bounds**',
        reasoningSummaryTexts: ['**Inspecting the parser**', '**Checking bounds**']
      })
    ]);

    expect(messages.find((message) => message.kind === 'progress')?.reasoningTraceLines).toEqual([
      '**Inspecting the parser**',
      '**Checking bounds**'
    ]);
  });

  it('renders a brain icon for every plain-text fixture reasoning line', () => {
    const fixtureReasoning = displayEvent('fixture-reasoning', {
      fixtureOnly: true,
      text: 'Planning synthetic fixture mode\nDesigning password input via stdin'
    });
    const detail = runDetail('Exercise the fixture.');
    const messages = commentaryMessagesForSession(detail, [fixtureReasoning]);

    expect(messages.find((message) => message.kind === 'progress')?.reasoningTraceLines).toEqual([
      'Planning synthetic fixture mode',
      'Designing password input via stdin'
    ]);

    const html = renderToStaticMarkup(
      createElement(CommentaryView, {
        busy: false,
        detail,
        events: [fixtureReasoning],
        providerModelCatalog: [],
        selectedRunId: detail.run.id,
        showBackToMain: true,
        searchHighlightQuery: '',
        onBackToMain: () => undefined,
        onSessionAction: () => undefined,
        onSteerInstruction: () => undefined
      })
    );

    expect(html.match(/lucide-brain/g)).toHaveLength(2);
  });

  it('pairs native commentary with reasoning by turn when a provider omits the response ID', () => {
    const messages = commentaryMessagesForSession(runDetail('Inspect the parser.'), [
      displayEvent('reasoning', {
        agentPath: '/root',
        turn: 3,
        provider: 'openai-codex',
        model: 'gpt-5.6-sol',
        transcriptRole: 'assistant',
        transcriptSource: 'openai_reasoning_summary',
        text: 'Private provider summary.'
      }),
      displayEvent('commentary', {
        agentPath: '/root',
        turn: 3,
        provider: 'openai-codex',
        model: 'gpt-5.6-sol',
        messagePhase: 'commentary',
        transcriptRole: 'assistant',
        transcriptSource: 'honeycrisp_commentary',
        text: 'I found the parser boundary and am testing its guard.'
      })
    ]);

    expect(messages.map(({ kind, contentMarkdown }) => [kind, contentMarkdown])).toEqual([
      ['user', 'Inspect the parser.'],
      ['commentary', 'I found the parser boundary and am testing its guard.']
    ]);
  });

  it('keeps only the latest message in a consecutive legacy progress burst', () => {
    const messages = commentaryMessagesForSession(runDetail('Review the target.'), [
      displayEvent('progress-one', {
        agentPath: '/root',
        responseId: 'response_one',
        transcriptRole: 'assistant',
        transcriptSource: 'openai_reasoning_summary',
        itemId: 'reasoning_one',
        text: 'Reading the entrypoint.'
      }),
      displayEvent('tool', { agentPath: '/root', text: 'Raw shell output.' }, { source: 'tool', type: 'tool_result' }),
      displayEvent('progress-two', {
        agentPath: '/root',
        responseId: 'response_two',
        transcriptRole: 'assistant',
        transcriptSource: 'openai_reasoning_summary',
        itemId: 'reasoning_two',
        text: 'Confirmed the input reaches the parser.'
      })
    ]);

    expect(messages.map(({ kind, contentMarkdown }) => [kind, contentMarkdown])).toEqual([
      ['user', 'Review the target.'],
      ['progress', 'Confirmed the input reaches the parser.']
    ]);
  });

  it('shows spawned and follow-up tasks in a selected subagent feed', () => {
    const messages = commentaryMessagesForSession(runDetail('Root prompt.'), [
      displayEvent('spawn', {
        type: 'subagent.activity',
        action: 'spawned',
        agentPath: '/root/parser_review',
        message: 'Inspect the parser boundary.'
      }, { source: 'system' }),
      displayEvent('followup', {
        type: 'subagent.activity',
        action: 'followup',
        agentPath: '/root/parser_review',
        message: 'Also check the length conversion.'
      }, { source: 'system' }),
      displayEvent('message', {
        type: 'subagent.activity',
        action: 'message',
        agentPath: '/root/parser_review',
        message: 'Compare the result with the caller contract.'
      }, { source: 'system' })
    ], { includeInitialPrompt: false });

    expect(messages.map(({ kind, taskAction, contentMarkdown }) => [kind, taskAction, contentMarkdown])).toEqual([
      ['task', 'spawn', 'Inspect the parser boundary.'],
      ['task', 'followup', 'Also check the length conversion.'],
      ['task', 'followup', 'Compare the result with the caller contract.']
    ]);
  });

  it('shows subagent failures as terminal Commentary messages', () => {
    const messages = commentaryMessagesForSession(runDetail('Root prompt.'), [
      displayEvent('commentary', {
        agentPath: '/root/parser_review',
        transcriptRole: 'assistant',
        transcriptSource: 'honeycrisp_commentary',
        messagePhase: 'commentary',
        text: 'I am checking the parser boundary.'
      }),
      displayEvent('error', {
        type: 'subagent.activity',
        action: 'errored',
        agentPath: '/root/parser_review',
        message: 'Provider request failed.'
      }, { source: 'system' })
    ], { includeInitialPrompt: false });

    expect(messages.map(({ kind, contentMarkdown }) => [kind, contentMarkdown])).toEqual([
      ['commentary', 'I am checking the parser boundary.'],
      ['error', 'Provider request failed.']
    ]);
  });
});

function displayEvent(
  id: string,
  payload: Record<string, unknown>,
  overrides: Partial<TraceEventRecord> = {}
): TraceDisplayEvent {
  return {
    id,
    runId: 'run_commentary',
    attemptId: 'attempt_one',
    sequence: 1,
    source: 'model',
    type: 'model_message',
    summary: 'Event.',
    payload,
    sensitivity: 'internal',
    modelVisible: true,
    createdAt: '2026-08-03T10:00:00.000Z',
    artifactId: null,
    toolCallId: null,
    approvalId: null,
    ...overrides
  };
}

function toolEvent(
  id: string,
  kind: 'tool.requested' | 'tool.observed',
  toolName: string,
  toolActionId: string,
  normalizedInputs: Record<string, unknown> = {},
  result?: unknown
): TraceDisplayEvent {
  return displayEvent(id, {
    honeycrispKind: kind,
    agentPath: '/root',
    toolName,
    payload: {
      toolName,
      toolActionId,
      normalizedInputs,
      ...(kind === 'tool.observed' ? { status: 'complete' } : {}),
      ...(result !== undefined ? { result } : {})
    }
  }, {
    source: 'system',
    type: 'research_event',
    summary: `Honeycrisp ${kind}: ${toolName}.`
  });
}

function runDetail(promptMarkdown: string): RunDetail {
  return {
    run: {
      id: 'run_commentary',
      promptMarkdown,
      createdAt: '2026-08-03T09:59:00.000Z'
    },
    traceEvents: [],
    transcriptMessages: []
  } as unknown as RunDetail;
}
