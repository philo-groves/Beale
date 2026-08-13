import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  codexDesktopCommandFromInstallLocation,
  findCodexDesktopBinCommand,
  OPENAI_SUBSCRIPTION_LOGIN_ARGS,
  OPENAI_SUBSCRIPTION_LOGIN_COMMAND,
  OpenAiAuthService
} from '../src/main/openaiAuth';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('OpenAiAuthService subscription forgetting', () => {
  it('uses standard browser callback login instead of device authorization', () => {
    expect(OPENAI_SUBSCRIPTION_LOGIN_COMMAND).toBe('codex login');
    expect(OPENAI_SUBSCRIPTION_LOGIN_ARGS).toEqual(['login']);
    expect(OPENAI_SUBSCRIPTION_LOGIN_COMMAND).not.toContain('device');
    expect(OPENAI_SUBSCRIPTION_LOGIN_ARGS).not.toContain('--device-auth');
  });

  it('resolves the CLI path inside a Windows Codex Desktop package', () => {
    expect(codexDesktopCommandFromInstallLocation('C:\\Program Files\\WindowsApps\\OpenAI.Codex_1.2.3')).toBe(
      'C:\\Program Files\\WindowsApps\\OpenAI.Codex_1.2.3\\app\\resources\\codex.exe'
    );
  });

  it('selects an executable from the per-user Codex Desktop bin directory', () => {
    const directory = mkdtempSync(join(tmpdir(), 'beale-codex-bin-'));
    temporaryDirectories.push(directory);
    const buildDirectory = join(directory, 'desktop-build');
    mkdirSync(buildDirectory);
    const command = join(buildDirectory, 'codex.exe');
    writeFileSync(command, 'test executable');

    expect(findCodexDesktopBinCommand(directory)).toBe(command);
  });

  it('cancels an active subscription login process', () => {
    const auth = new OpenAiAuthService();
    const kill = vi.fn();
    const internals = auth as unknown as {
      oauthLoginProcess: { kill: () => void } | null;
      latestOAuthStart: unknown;
    };
    internals.oauthLoginProcess = { kill };
    internals.latestOAuthStart = { started: true };

    auth.cancelOAuthLogin();

    expect(kill).toHaveBeenCalledOnce();
    expect(internals.oauthLoginProcess).toBeNull();
    expect(internals.latestOAuthStart).toBeNull();
  });

  it('removes a validated Codex OAuth file when the CLI is unavailable', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'beale-openai-auth-'));
    temporaryDirectories.push(directory);
    const authPath = join(directory, 'auth.json');
    writeFileSync(authPath, JSON.stringify({
      auth_mode: 'chatgpt',
      tokens: {
        access_token: 'header.payload.signature'
      }
    }));
    const auth = new OpenAiAuthService({
      codexAuthPath: authPath,
      codexCommand: `beale-missing-codex-${Date.now()}`
    });

    expect(auth.getStatus().subscriptionConfigured).toBe(true);
    await auth.forgetSubscription();

    expect(existsSync(authPath)).toBe(false);
    expect(auth.getStatus().subscriptionConfigured).toBe(false);
  });

  it('does not remove a non-ChatGPT Codex auth file', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'beale-openai-auth-'));
    temporaryDirectories.push(directory);
    const authPath = join(directory, 'auth.json');
    writeFileSync(authPath, JSON.stringify({
      auth_mode: 'apikey',
      OPENAI_API_KEY: 'host-owned-key'
    }));
    const auth = new OpenAiAuthService({
      codexAuthPath: authPath,
      codexCommand: `beale-missing-codex-${Date.now()}`
    });

    await auth.forgetSubscription();

    expect(existsSync(authPath)).toBe(true);
  });
});
