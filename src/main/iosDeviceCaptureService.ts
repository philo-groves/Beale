import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, createConnection, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IosDeviceCaptureDevice, IosDeviceCaptureFrame, IosDeviceCaptureState } from '@shared/types';

const COMPANION_BUNDLE_ID = 'com.phillipgroves.BealeCaptureCompanion';
const DEVICE_PORT = 59_727;
const MAX_FRAME_BYTES = 8 * 1024 * 1024;
const MAX_BUFFER_BYTES = MAX_FRAME_BYTES * 2;
const COMPANION_SESSION_PATH = 'Library/Caches/beale-capture-session.json';
const COMPANION_SESSION_LIFETIME_MS = 15 * 60 * 1_000;
const COMPANION_OPEN_TIMEOUT_MS = 10 * 60 * 1_000;

type StateListener = (state: IosDeviceCaptureState) => void;
type FrameListener = (frame: IosDeviceCaptureFrame) => void;

function isActiveCapturePhase(phase: IosDeviceCaptureState['phase']): boolean {
  return phase === 'starting' || phase === 'waiting_for_consent' || phase === 'streaming';
}

interface DeviceCtlRecord {
  identifier?: unknown;
  properties?: {
    connection?: { state?: unknown; transportType?: unknown; pairingState?: unknown };
    hardware?: { deviceType?: unknown; marketingName?: unknown; reality?: unknown; udid?: unknown };
    software?: { osVersionNumber?: { stringValue?: unknown } };
    state?: { name?: unknown };
  };
}

interface DeviceCtlDocument {
  result?: { devices?: unknown };
}

export function iosCaptureSessionDocument(token: string, now = Date.now()): string {
  return `${JSON.stringify({
    version: 1,
    token,
    expiresAt: Math.floor((now + COMPANION_SESSION_LIFETIME_MS) / 1_000)
  })}\n`;
}

export function iosCaptureSessionCopyArgs(device: IosDeviceCaptureDevice, source: string): string[] {
  return [
    'devicectl', 'device', 'copy', 'to',
    '--device', device.udid,
    '--source', source,
    '--destination', COMPANION_SESSION_PATH,
    '--domain-type', 'appDataContainer',
    '--domain-identifier', COMPANION_BUNDLE_ID
  ];
}

export function isHumanDrivenIosDeviceCommand(args: readonly string[]): boolean {
  return (
    args[0] === 'devicectl'
    && args[1] === 'list'
    && args[2] === 'devices'
  ) || (
    args[0] === 'devicectl'
    && args[1] === 'device'
    && args[2] === 'copy'
    && args[3] === 'to'
  );
}

export function parseConnectedIosDevice(stdout: string): IosDeviceCaptureDevice | null {
  const jsonStart = stdout.indexOf('{');
  if (jsonStart < 0) return null;
  let document: DeviceCtlDocument;
  try {
    document = JSON.parse(stdout.slice(jsonStart)) as DeviceCtlDocument;
  } catch {
    return null;
  }
  if (!Array.isArray(document.result?.devices)) return null;

  for (const candidate of document.result.devices as DeviceCtlRecord[]) {
    const connection = candidate.properties?.connection;
    const hardware = candidate.properties?.hardware;
    const software = candidate.properties?.software;
    const reachableWiredDevice = connection?.transportType === 'wired' && (
      connection.state === 'connected'
      || (connection.state === 'disconnected' && connection.pairingState === 'paired')
    );
    if (!reachableWiredDevice) continue;
    if (hardware?.deviceType !== 'iPhone' || hardware.reality !== 'physical') continue;
    if (typeof hardware.udid !== 'string' || typeof candidate.identifier !== 'string') continue;
    const osVersion = software?.osVersionNumber?.stringValue;
    if (typeof osVersion !== 'string' || Number.parseInt(osVersion, 10) < 27) continue;
    return {
      id: candidate.identifier,
      udid: hardware.udid,
      name: typeof candidate.properties?.state?.name === 'string' ? candidate.properties.state.name : 'Connected iPhone',
      model: typeof hardware.marketingName === 'string' ? hardware.marketingName : 'iPhone',
      osVersion
    };
  }
  return null;
}

export class IosFrameProtocolParser {
  private buffer = Buffer.alloc(0);
  private authenticated = false;

  push(chunk: Buffer): Buffer[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    if (this.buffer.length > MAX_BUFFER_BYTES) throw new Error('The iPhone frame stream exceeded its buffer limit.');

    if (!this.authenticated) {
      const newline = this.buffer.indexOf(0x0a);
      if (newline < 0) return [];
      const response = this.buffer.subarray(0, newline).toString('utf8');
      if (response !== 'BEALE/1 OK') throw new Error('The iPhone companion rejected the USB session.');
      this.buffer = this.buffer.subarray(newline + 1);
      this.authenticated = true;
    }

    const frames: Buffer[] = [];
    while (this.buffer.length >= 4) {
      const length = this.buffer.readUInt32BE(0);
      if (length === 0 || length > MAX_FRAME_BYTES) throw new Error('The iPhone companion sent an invalid frame length.');
      if (this.buffer.length < length + 4) break;
      frames.push(Buffer.from(this.buffer.subarray(4, length + 4)));
      this.buffer = this.buffer.subarray(length + 4);
    }
    return frames;
  }

  isAuthenticated(): boolean {
    return this.authenticated;
  }
}

export class IosDeviceCaptureService {
  private state: IosDeviceCaptureState = {
    supported: process.platform === 'darwin',
    phase: 'idle',
    device: null,
    detail: 'Connect an iOS 27 iPhone over USB-C.'
  };
  private socket: Socket | null = null;
  private proxy: ChildProcess | null = null;
  private sessionToken: string | null = null;
  private sequence = 0;
  private generation = 0;

  constructor(private readonly onState: StateListener, private readonly onFrame: FrameListener) {}

  async getState(): Promise<IosDeviceCaptureState> {
    if (isActiveCapturePhase(this.state.phase)) return this.state;
    if (process.platform !== 'darwin') return this.state;
    const generation = this.generation;
    try {
      const device = await this.discoverDevice();
      if (generation !== this.generation || isActiveCapturePhase(this.state.phase)) return this.state;
      this.setState(device
        ? { supported: true, phase: 'ready', device, detail: 'Ready for you to open Beale Capture on the iPhone.' }
        : { supported: true, phase: 'idle', device: null, detail: 'Connect and unlock an iOS 27 iPhone over USB-C.' });
    } catch (error) {
      if (generation !== this.generation) return this.state;
      this.setState({
        supported: true,
        phase: 'error',
        device: null,
        detail: errorMessage(error)
      });
    }
    return this.state;
  }

  async start(): Promise<IosDeviceCaptureState> {
    await this.stop(false);
    const generation = this.generation;
    const device = await this.discoverDevice();
    if (generation !== this.generation) return this.state;
    if (!device) {
      this.setState({ supported: true, phase: 'error', device: null, detail: 'No wired iOS 27 iPhone is connected.' });
      return this.state;
    }
    const iproxy = findIproxy();
    if (!iproxy) {
      this.setState({ supported: true, phase: 'error', device, detail: 'iproxy is required for the local USB frame tunnel.' });
      return this.state;
    }

    this.setState({ supported: true, phase: 'starting', device, detail: 'Open Beale Capture on the iPhone to connect.' });
    try {
      const localPort = await reserveLoopbackPort();
      const token = randomBytes(32).toString('hex');
      this.sessionToken = token;
      await provisionSessionToken(device, token);
      if (generation !== this.generation) return this.state;
      const proxy = spawn(iproxy, ['--udid', device.udid, '--local', `${localPort}:${DEVICE_PORT}`], {
        stdio: ['ignore', 'pipe', 'pipe']
      });
      this.proxy = proxy;
      proxy.once('exit', () => {
        if (this.proxy === proxy) this.fail('The USB tunnel to the iPhone closed.');
      });
      const socket = await connectWithRetry(localPort, COMPANION_OPEN_TIMEOUT_MS);
      if (generation !== this.generation) {
        socket.destroy();
        return this.state;
      }
      this.socket = socket;
      this.attachSocket(socket, token, device);
      this.setState({
        supported: true,
        phase: 'waiting_for_consent',
        device,
        detail: 'On the iPhone, tap Share iPhone Screen and choose Entire Screen.'
      });
    } catch (error) {
      if (generation !== this.generation) return this.state;
      await this.stop(false);
      this.setState({ supported: true, phase: 'error', device, detail: captureStartError(error) });
    }
    return this.state;
  }

  async stop(notify = true): Promise<IosDeviceCaptureState> {
    this.generation += 1;
    const device = this.state.device;
    const socket = this.socket;
    const proxy = this.proxy;
    this.socket = null;
    this.proxy = null;
    this.sessionToken = null;
    socket?.destroy();
    proxy?.kill();
    if (notify) {
      this.setState({
        supported: process.platform === 'darwin',
        phase: device ? 'ready' : 'idle',
        device,
        detail: device ? 'Capture stopped. Ready to start again.' : 'Connect an iOS 27 iPhone over USB-C.'
      });
    }
    return this.state;
  }

  dispose(): void {
    void this.stop(false);
  }

  private async discoverDevice(): Promise<IosDeviceCaptureDevice | null> {
    const result = await runXcrun(['devicectl', 'list', 'devices', '--quiet', '--json-output', '-'], 15_000);
    return parseConnectedIosDevice(result.stdout);
  }

  private attachSocket(socket: Socket, token: string, device: IosDeviceCaptureDevice): void {
    const parser = new IosFrameProtocolParser();
    socket.setNoDelay(true);
    socket.write(`BEALE/1 ${token}\n`);
    socket.on('data', (chunk) => {
      try {
        const frames = parser.push(chunk);
        if (parser.isAuthenticated() && this.state.phase === 'starting') {
          this.setState({ supported: true, phase: 'waiting_for_consent', device, detail: 'Approve Entire Screen capture on the iPhone.' });
        }
        for (const jpeg of frames) {
          this.sequence += 1;
          if (this.state.phase !== 'streaming') {
            this.setState({ supported: true, phase: 'streaming', device, detail: 'Live iPhone screen over USB-C.' });
          }
          this.onFrame({ sequence: this.sequence, capturedAt: new Date().toISOString(), jpegData: new Uint8Array(jpeg) });
        }
      } catch (error) {
        this.fail(errorMessage(error));
      }
    });
    socket.once('error', (error) => this.fail(`The iPhone frame connection failed: ${error.message}`));
    socket.once('close', () => {
      if (this.socket === socket) this.fail('The iPhone frame connection closed.');
    });
  }

  private fail(detail: string): void {
    const device = this.state.device;
    void this.stop(false);
    this.setState({ supported: process.platform === 'darwin', phase: 'error', device, detail });
  }

  private setState(state: IosDeviceCaptureState): void {
    this.state = state;
    this.onState(state);
  }
}

function xcodeDeveloperDir(): string | undefined {
  const configured = process.env.BEALE_XCODE_DEVELOPER_DIR;
  if (configured && existsSync(configured)) return configured;
  const beta = '/Applications/Xcode-27-beta.app/Contents/Developer';
  return existsSync(beta) ? beta : undefined;
}

function findIproxy(): string | null {
  const candidates = [
    process.env.BEALE_IPROXY_PATH,
    '/opt/homebrew/bin/iproxy',
    '/usr/local/bin/iproxy'
  ].filter((candidate): candidate is string => Boolean(candidate));
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function runXcrun(args: string[], timeout: number): Promise<{ stdout: string; stderr: string }> {
  if (!isHumanDrivenIosDeviceCommand(args)) {
    return Promise.reject(new Error('Beale blocked a device command that could control or launch the iOS companion.'));
  }
  return new Promise((resolve, reject) => {
    execFile('/usr/bin/xcrun', args, {
      encoding: 'utf8',
      timeout,
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, ...(xcodeDeveloperDir() ? { DEVELOPER_DIR: xcodeDeveloperDir() } : {}) }
    }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr.trim() || error.message));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function provisionSessionToken(device: IosDeviceCaptureDevice, token: string): Promise<void> {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'beale-ios-capture-'));
  const source = join(temporaryDirectory, 'beale-capture-session.json');
  try {
    writeFileSync(source, iosCaptureSessionDocument(token), { encoding: 'utf8', mode: 0o600 });
    await runXcrun(iosCaptureSessionCopyArgs(device, source), 30_000);
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

function reserveLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not allocate a local USB tunnel port.'));
        return;
      }
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

function connectWithRetry(port: number, timeoutMs: number): Promise<Socket> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = (): void => {
      const socket = createConnection({ host: '127.0.0.1', port });
      socket.once('connect', () => resolve(socket));
      socket.once('error', (error) => {
        socket.destroy();
        if (Date.now() >= deadline) reject(error);
        else setTimeout(attempt, 150);
      });
    };
    attempt();
  });
}

function captureStartError(error: unknown): string {
  const message = errorMessage(error);
  if (/Application not found|failed to find|bundle identifier/iu.test(message)) {
    return 'Beale Capture is not installed on the connected iPhone.';
  }
  if (/license|agreement|provision/iu.test(message)) {
    return `The iOS companion is not provisioned for this device: ${message}`;
  }
  return message;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'The iPhone capture operation failed.';
}
