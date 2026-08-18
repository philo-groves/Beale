import { describe, expect, it } from 'vitest';
import { IosFrameProtocolParser, parseConnectedIosDevice } from '../src/main/iosDeviceCaptureService';

describe('iOS device capture service boundaries', () => {
  it('selects only a wired, connected, physical iOS 27 iPhone', () => {
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
});
