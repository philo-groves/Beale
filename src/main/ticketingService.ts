import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
  HoneycrispReportDocument,
  HoneycrispReportSummary,
  TicketingMode,
  TicketingProviderId,
  TicketingSettings,
  TicketingTarget,
  TicketSubmissionResult
} from '@shared/types';

const GITHUB_API_URL = 'https://api.github.com';
const LINEAR_API_URL = 'https://api.linear.app/graphql';
const MAX_CREDENTIAL_LENGTH = 16_384;
const MAX_TICKET_BODY_LENGTH = 60_000;
const TICKETING_ENVIRONMENT_VARIABLES: Readonly<Record<TicketingProviderId, string>> = {
  github: 'GITHUB_TOKEN',
  linear: 'LINEAR_API_KEY'
};

interface TicketingEncryption {
  available(): boolean;
  encrypt(value: string): Buffer;
  decrypt(value: Buffer): string;
}

interface PersistedTicketSubmission {
  provider: TicketingProviderId;
  workspaceId: string;
  reportId: string;
  result: TicketSubmissionResult;
}

interface PersistedTicketingSettings {
  version: 1 | 2;
  provider: TicketingMode;
  targets: Partial<Record<TicketingProviderId, TicketingTarget>>;
  credentials: Partial<Record<TicketingProviderId, string>>;
  automation?: {
    humanInTheLoop: boolean;
    automaticSubmissionEnabledAt: string | null;
  };
  submissions?: PersistedTicketSubmission[];
}

interface TicketingServiceOptions {
  fetchImpl?: typeof fetch;
  environment?: NodeJS.ProcessEnv;
  now?: () => Date;
}

export class TicketingService {
  private provider: TicketingMode = 'local';
  private humanInTheLoop = true;
  private automaticSubmissionEnabledAt: string | null = null;
  private readonly targets = new Map<TicketingProviderId, TicketingTarget>();
  private readonly credentials = new Map<TicketingProviderId, string>();
  private readonly submissions = new Map<string, PersistedTicketSubmission>();
  private readonly submissionsInFlight = new Map<string, Promise<TicketSubmissionResult>>();
  private readonly fetchImpl: typeof fetch;
  private readonly environment: NodeJS.ProcessEnv;
  private readonly now: () => Date;

  public constructor(
    private readonly path: string | null,
    private readonly encryption: TicketingEncryption | null,
    options: TicketingServiceOptions = {}
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.environment = options.environment ?? process.env;
    this.now = options.now ?? (() => new Date());
    this.load();
  }

  public getSettings(): TicketingSettings {
    return {
      provider: this.provider,
      automation: { humanInTheLoop: this.humanInTheLoop },
      github: this.providerSettings('github'),
      linear: this.providerSettings('linear')
    };
  }

  public setProvider(provider: TicketingMode): TicketingSettings {
    if (!isTicketingMode(provider)) throw new Error('Unsupported ticketing system.');
    this.provider = provider;
    this.persist();
    return this.getSettings();
  }

  public setHumanInTheLoop(enabled: boolean): TicketingSettings {
    if (typeof enabled !== 'boolean') throw new Error('Human In The Loop must be enabled or disabled.');
    if (this.humanInTheLoop === enabled) return this.getSettings();
    this.humanInTheLoop = enabled;
    this.automaticSubmissionEnabledAt = enabled ? null : this.now().toISOString();
    this.persist();
    return this.getSettings();
  }

  public async configureCredential(provider: TicketingProviderId, apiKey: string): Promise<TicketingSettings> {
    requireTicketingProvider(provider);
    const normalized = apiKey.trim();
    if (!normalized) throw new Error('API token is required.');
    if (normalized.length > MAX_CREDENTIAL_LENGTH) throw new Error('API token is too long.');
    this.requireEncryption();
    await this.listTargetsWithToken(provider, normalized);
    this.credentials.set(provider, normalized);
    this.persist();
    return this.getSettings();
  }

  public removeCredential(provider: TicketingProviderId): TicketingSettings {
    requireTicketingProvider(provider);
    if (!this.credentials.has(provider) && this.environment[TICKETING_ENVIRONMENT_VARIABLES[provider]]?.trim()) {
      throw new Error(`This token comes from ${TICKETING_ENVIRONMENT_VARIABLES[provider]} and must be removed from the host environment.`);
    }
    this.credentials.delete(provider);
    this.targets.delete(provider);
    this.persist();
    return this.getSettings();
  }

  public listTargets(provider: TicketingProviderId): Promise<TicketingTarget[]> {
    requireTicketingProvider(provider);
    return this.listTargetsWithToken(provider, this.requireCredential(provider));
  }

  public async setTarget(provider: TicketingProviderId, target: TicketingTarget): Promise<TicketingSettings> {
    requireTicketingProvider(provider);
    const availableTargets = await this.listTargets(provider);
    const selected = availableTargets.find((candidate) => candidate.id === target.id);
    if (!selected) throw new Error('The selected ticket destination is not available to this credential.');
    this.targets.set(provider, selected);
    this.persist();
    return this.getSettings();
  }

  public async submit(report: HoneycrispReportSummary, document: HoneycrispReportDocument): Promise<TicketSubmissionResult> {
    if (this.provider === 'local') throw new Error('Ticketing is set to Local Reports Only.');
    if (report.status !== 'complete') throw new Error('Only complete reports can be submitted to ticketing systems.');
    const provider = this.provider;
    const submissionKey = ticketSubmissionKey(provider, report.workspaceId, report.id);
    const existing = this.submissions.get(submissionKey);
    if (existing) return existing.result;
    const inFlight = this.submissionsInFlight.get(submissionKey);
    if (inFlight) return inFlight;
    const target = this.targets.get(provider);
    if (!target) throw new Error(`Choose a ${provider === 'github' ? 'GitHub repository' : 'Linear team'} in Ticketing settings first.`);
    const body = document.content.trim();
    if (!body) throw new Error('The report is empty.');
    if (body.length > MAX_TICKET_BODY_LENGTH) {
      throw new Error('The report is too large to submit as a ticket body. Reduce it below 60,000 characters and try again.');
    }
    const submission = (provider === 'github'
      ? this.submitGitHubIssue(target.id, report.title, body, this.requireCredential(provider))
      : this.submitLinearIssue(target.id, report.title, body, this.requireCredential(provider)))
      .then((result) => {
        this.submissions.set(submissionKey, {
          provider,
          workspaceId: report.workspaceId,
          reportId: report.id,
          result
        });
        this.persist();
        return result;
      })
      .finally(() => this.submissionsInFlight.delete(submissionKey));
    this.submissionsInFlight.set(submissionKey, submission);
    return submission;
  }

  public async submitAutomatically(
    reports: readonly HoneycrispReportSummary[],
    getDocument: (report: HoneycrispReportSummary) => HoneycrispReportDocument | Promise<HoneycrispReportDocument>
  ): Promise<void> {
    if (this.humanInTheLoop || this.provider === 'local' || !this.automaticSubmissionEnabledAt) return;
    const provider = this.provider;
    const providerSettings = this.providerSettings(provider);
    if (!providerSettings.credentialConfigured || !providerSettings.targetId) return;
    const enabledAt = Date.parse(this.automaticSubmissionEnabledAt);
    const eligible = reports.filter((report) => {
      const updatedAt = Date.parse(report.updatedAt);
      return report.status === 'complete'
        && Number.isFinite(updatedAt)
        && updatedAt >= enabledAt
        && !this.submissions.has(ticketSubmissionKey(provider, report.workspaceId, report.id));
    });
    await Promise.allSettled(eligible.map(async (report) => this.submit(report, await getDocument(report))));
  }

  private providerSettings(provider: TicketingProviderId): TicketingSettings[TicketingProviderId] {
    const managed = this.credentials.has(provider);
    const environment = Boolean(this.environment[TICKETING_ENVIRONMENT_VARIABLES[provider]]?.trim());
    const target = this.targets.get(provider);
    return {
      credentialConfigured: managed || environment,
      credentialSource: managed ? 'managed' : environment ? 'environment' : null,
      targetId: target?.id ?? null,
      targetLabel: target?.label ?? null
    };
  }

  private requireCredential(provider: TicketingProviderId): string {
    const credential = this.credentials.get(provider)
      ?? this.environment[TICKETING_ENVIRONMENT_VARIABLES[provider]]?.trim();
    if (!credential) throw new Error(`Configure a ${provider === 'github' ? 'GitHub' : 'Linear'} API token first.`);
    return credential;
  }

  private async listTargetsWithToken(provider: TicketingProviderId, token: string): Promise<TicketingTarget[]> {
    return provider === 'github' ? this.listGitHubRepositories(token) : this.listLinearTeams(token);
  }

  private async listGitHubRepositories(token: string): Promise<TicketingTarget[]> {
    const response = await this.fetchImpl(`${GITHUB_API_URL}/user/repos?per_page=100&sort=full_name&direction=asc`, {
      headers: githubHeaders(token)
    });
    if (!response.ok) throw new Error(await responseError('GitHub repository lookup', response));
    const repositories = await response.json() as unknown;
    if (!Array.isArray(repositories)) throw new Error('GitHub repository lookup returned an invalid response.');
    return repositories.flatMap((repository): TicketingTarget[] => {
      const record = objectRecord(repository);
      const fullName = stringValue(record?.full_name);
      if (!fullName || record?.has_issues === false || record?.archived === true) return [];
      return [{ id: fullName, label: fullName }];
    });
  }

  private async listLinearTeams(token: string): Promise<TicketingTarget[]> {
    const payload = await this.linearRequest<{
      teams?: { nodes?: Array<{ id?: unknown; name?: unknown; key?: unknown }> };
    }>(token, 'query TicketingTeams { teams { nodes { id name key } } }');
    return (payload.teams?.nodes ?? []).flatMap((team): TicketingTarget[] => {
      const id = stringValue(team.id);
      const name = stringValue(team.name);
      const key = stringValue(team.key);
      if (!id || !name) return [];
      return [{ id, label: key ? `${name} (${key})` : name }];
    }).sort((left, right) => left.label.localeCompare(right.label));
  }

  private async submitGitHubIssue(repository: string, title: string, body: string, token: string): Promise<TicketSubmissionResult> {
    const [owner, repo, ...rest] = repository.split('/');
    if (!owner || !repo || rest.length > 0) throw new Error('The configured GitHub repository is invalid.');
    const response = await this.fetchImpl(`${GITHUB_API_URL}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`, {
      method: 'POST',
      headers: githubHeaders(token),
      body: JSON.stringify({ title: ticketTitle(title), body })
    });
    if (!response.ok) throw new Error(await responseError('GitHub issue creation', response));
    const created = objectRecord(await response.json());
    const url = stringValue(created?.html_url);
    const number = typeof created?.number === 'number' ? created.number : null;
    const createdTitle = stringValue(created?.title) ?? ticketTitle(title);
    if (!url || number === null) throw new Error('GitHub issue creation returned an invalid response.');
    return { provider: 'github', ticketId: `#${number}`, title: createdTitle, url };
  }

  private async submitLinearIssue(teamId: string, title: string, body: string, token: string): Promise<TicketSubmissionResult> {
    const payload = await this.linearRequest<{
      issueCreate?: { success?: unknown; issue?: { id?: unknown; identifier?: unknown; title?: unknown; url?: unknown } };
    }>(token, `mutation TicketingIssueCreate($input: IssueCreateInput!) {
      issueCreate(input: $input) { success issue { id identifier title url } }
    }`, { input: { teamId, title: ticketTitle(title), description: body } });
    const issue = payload.issueCreate?.issue;
    const success = payload.issueCreate?.success === true;
    const id = stringValue(issue?.identifier) ?? stringValue(issue?.id);
    const url = stringValue(issue?.url);
    const createdTitle = stringValue(issue?.title) ?? ticketTitle(title);
    if (!success || !id || !url) throw new Error('Linear issue creation returned an invalid response.');
    return { provider: 'linear', ticketId: id, title: createdTitle, url };
  }

  private async linearRequest<T>(token: string, query: string, variables?: Record<string, unknown>): Promise<T> {
    const response = await this.fetchImpl(LINEAR_API_URL, {
      method: 'POST',
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, ...(variables ? { variables } : {}) })
    });
    if (!response.ok) throw new Error(await responseError('Linear API request', response));
    const envelope = objectRecord(await response.json());
    const errors = Array.isArray(envelope?.errors) ? envelope.errors : [];
    if (errors.length > 0) {
      const message = stringValue(objectRecord(errors[0])?.message) ?? 'Unknown GraphQL error.';
      throw new Error(`Linear API request failed: ${message}`);
    }
    const data = envelope?.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Linear API returned an invalid response.');
    return data as T;
  }

  private load(): void {
    if (!this.path || !existsSync(this.path)) return;
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as PersistedTicketingSettings;
      if ((parsed.version !== 1 && parsed.version !== 2) || !isTicketingMode(parsed.provider)) return;
      this.provider = parsed.provider;
      if (parsed.version === 2 && parsed.automation?.humanInTheLoop === false) {
        this.humanInTheLoop = false;
        this.automaticSubmissionEnabledAt = validTimestamp(parsed.automation.automaticSubmissionEnabledAt)
          ?? this.now().toISOString();
      }
      for (const provider of ticketingProviders()) {
        const target = parsed.targets?.[provider];
        if (target && typeof target.id === 'string' && typeof target.label === 'string') this.targets.set(provider, target);
      }
      const encryptedCredentials = ticketingProviders()
        .map((provider) => [provider, parsed.credentials?.[provider]] as const)
        .filter((entry): entry is readonly [TicketingProviderId, string] => typeof entry[1] === 'string' && entry[1].length > 0);
      if (encryptedCredentials.length > 0 && this.encryption?.available()) {
        for (const [provider, encrypted] of encryptedCredentials) {
          const credential = this.encryption.decrypt(Buffer.from(encrypted, 'base64')).trim();
          if (credential) this.credentials.set(provider, credential);
        }
      }
      for (const submission of parsed.submissions ?? []) {
        if (!validPersistedSubmission(submission)) continue;
        this.submissions.set(ticketSubmissionKey(submission.provider, submission.workspaceId, submission.reportId), submission);
      }
    } catch {
      this.provider = 'local';
      this.humanInTheLoop = true;
      this.automaticSubmissionEnabledAt = null;
      this.targets.clear();
      this.credentials.clear();
      this.submissions.clear();
    }
  }

  private persist(): void {
    if (!this.path) return;
    const targets = Object.fromEntries(this.targets) as Partial<Record<TicketingProviderId, TicketingTarget>>;
    const credentials: Partial<Record<TicketingProviderId, string>> = {};
    if (this.credentials.size > 0) this.requireEncryption();
    for (const [provider, credential] of this.credentials) {
      credentials[provider] = this.encryption?.encrypt(credential).toString('base64');
    }
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify({
      version: 2,
      provider: this.provider,
      targets,
      credentials,
      automation: {
        humanInTheLoop: this.humanInTheLoop,
        automaticSubmissionEnabledAt: this.automaticSubmissionEnabledAt
      },
      submissions: [...this.submissions.values()]
    } satisfies PersistedTicketingSettings), {
      encoding: 'utf8',
      mode: 0o600
    });
  }

  private requireEncryption(): void {
    if (this.path && (!this.encryption || !this.encryption.available())) {
      throw new Error('Secure credential storage is unavailable on this system.');
    }
  }
}

function githubHeaders(token: string): Record<string, string> {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'User-Agent': 'Beale',
    'X-GitHub-Api-Version': '2022-11-28'
  };
}

async function responseError(action: string, response: Response): Promise<string> {
  let detail = '';
  try {
    const body = objectRecord(await response.json());
    detail = stringValue(body?.message) ?? '';
  } catch {
    detail = '';
  }
  return `${action} failed with HTTP ${response.status}${detail ? `: ${detail}` : '.'}`;
}

function ticketTitle(title: string): string {
  const normalized = title.trim() || 'Beale report';
  return normalized.length <= 240 ? normalized : `${normalized.slice(0, 237)}...`;
}

function ticketingProviders(): TicketingProviderId[] {
  return ['github', 'linear'];
}

function isTicketingMode(value: unknown): value is TicketingMode {
  return value === 'local' || value === 'github' || value === 'linear';
}

function requireTicketingProvider(value: unknown): asserts value is TicketingProviderId {
  if (value !== 'github' && value !== 'linear') throw new Error('Unsupported ticketing provider.');
}

function ticketSubmissionKey(provider: TicketingProviderId, workspaceId: string, reportId: string): string {
  return JSON.stringify([provider, workspaceId, reportId]);
}

function validTimestamp(value: unknown): string | null {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
}

function validPersistedSubmission(value: unknown): value is PersistedTicketSubmission {
  const submission = objectRecord(value);
  const result = objectRecord(submission?.result);
  const provider = submission?.provider;
  return (provider === 'github' || provider === 'linear')
    && typeof submission?.workspaceId === 'string'
    && typeof submission?.reportId === 'string'
    && result?.provider === provider
    && typeof result.ticketId === 'string'
    && typeof result.title === 'string'
    && typeof result.url === 'string';
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
