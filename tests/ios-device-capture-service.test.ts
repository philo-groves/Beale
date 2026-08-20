import { describe, expect, it } from 'vitest';
import {
  IosFrameProtocolParser,
  iosCaptureSessionCopyArgs,
  iosCaptureSessionDocument,
  parseConnectedIosDevice
} from '../src/main/iosDeviceCaptureService';

describe('iOS device capture service boundaries', () => {
  it('selects a wired, connected, physical iOS 27 iPhone', () => {
    const stdout = `diagnostic prefix\n${JSON.stringify({
      result: {
        devices: [
          {
            identifier: 'core-device-id',
            properties: {
              connection: { state: 'connected', transportType: 'wired' },
              hardware: {
                deviceType: 'iPhone',
                reality: 'physical',
                marketingName: 'iPhone 15 Pro Max',
                udid: 'device-udid'
              },
              software: { osVersionNumber: { stringValue: '27.0' } },
              state: { name: 'Research iPhone' }
            }
          }
        ]
      }
    })}`;

    expect(parseConnectedIosDevice(stdout)).toEqual({
      id: 'core-device-id',
      udid: 'device-udid',
      name: 'Research iPhone',
      model: 'iPhone 15 Pro Max',
      osVersion: '27.0'
    });
  });

  it('accepts Xcode 27 wired paired devices while their CoreDevice tunnel is idle', () => {
    const stdout = JSON.stringify({
      result: {
        devices: [{
          identifier: 'core-device-id',
          properties: {
            connection: { state: 'disconnected', transportType: 'wired', pairingState: 'paired' },
            hardware: { deviceType: 'iPhone', reality: 'physical', marketingName: 'iPhone 15 Pro Max', udid: 'device-udid' },
            software: { osVersionNumber: { stringValue: '27.0' } },
            state: { name: 'Research iPhone' }
          }
        }]
      }
    });

    expect(parseConnectedIosDevice(stdout)?.udid).toBe('device-udid');
  });

  it('rejects network-connected and pre-iOS 27 devices', () => {
    const document = (transportType: string, version: string): string => JSON.stringify({
      result: {
        devices: [{
          identifier: 'id',
          properties: {
            connection: { state: 'connected', transportType },
            hardware: { deviceType: 'iPhone', reality: 'physical', udid: 'udid' },
            software: { osVersionNumber: { stringValue: version } }
          }
        }]
      }
    });
    expect(parseConnectedIosDevice(document('network', '27.0'))).toBeNull();
    expect(parseConnectedIosDevice(document('wired', '26.6'))).toBeNull();
    expect(parseConnectedIosDevice(JSON.stringify({
      result: {
        devices: [{
          identifier: 'id',
          properties: {
            connection: { state: 'disconnected', transportType: 'wired', pairingState: 'unpaired' },
            hardware: { deviceType: 'iPhone', reality: 'physical', udid: 'udid' },
            software: { osVersionNumber: { stringValue: '27.0' } }
          }
        }]
      }
    }))).toBeNull();
  });

  it('parses authenticated length-prefixed JPEG frames across chunks', () => {
    const parser = new IosFrameProtocolParser();
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(jpeg.length);
    const packet = Buffer.concat([Buffer.from('BEALE/1 OK\n'), length, jpeg]);

    expect(parser.push(packet.subarray(0, 8))).toEqual([]);
    expect(parser.push(packet.subarray(8, 15))).toEqual([]);
    expect(parser.push(packet.subarray(15))).toEqual([jpeg]);
    expect(parser.isAuthenticated()).toBe(true);
  });

  it('fails closed on a rejected session or oversized frame', () => {
    expect(() => new IosFrameProtocolParser().push(Buffer.from('BEALE/1 NO\n'))).toThrow('rejected');
    const invalid = Buffer.alloc(4);
    invalid.writeUInt32BE(9 * 1024 * 1024);
    expect(() => new IosFrameProtocolParser().push(Buffer.concat([Buffer.from('BEALE/1 OK\n'), invalid]))).toThrow('invalid frame');
  });

  it('stages a short-lived session token without launching the companion', () => {
    const device = {
      id: 'core-device-id',
      udid: 'device-udid',
      name: 'Research iPhone',
      model: 'iPhone 15 Pro Max',
      osVersion: '27.0'
    };
    const document = JSON.parse(iosCaptureSessionDocument('a'.repeat(64), 1_000)) as {
      version: number;
      token: string;
      expiresAt: number;
    };
    const args = iosCaptureSessionCopyArgs(device, '/private/tmp/beale-capture-session.json');

    expect(document).toEqual({ version: 1, token: 'a'.repeat(64), expiresAt: 901 });
    expect(args).toEqual([
      'devicectl', 'device', 'copy', 'to',
      '--device', 'device-udid',
      '--source', '/private/tmp/beale-capture-session.json',
      '--destination', 'Library/Caches/beale-capture-session.json',
      '--domain-type', 'appDataContainer',
      '--domain-identifier', 'com.phillipgroves.BealeCaptureCompanion'
    ]);
    expect(args).not.toContain('launch');
  });
});
