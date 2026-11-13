import { describe, expect, it } from 'vitest';
import { ipFromFbi } from '../src/shared/fbi';

describe('the _fbi cookie in the browser', () => {
  it('reads IPv6 and IPv4, with or without the suffix, and URL-encoded', () => {
    expect(ipFromFbi('2401:4900:1c3a:abcd::1.AQYCAQMD')).toBe('2401:4900:1c3a:abcd::1');
    expect(ipFromFbi('2401%3A4900%3A%3A1.AQYCAQMD')).toBe('2401:4900::1');
    expect(ipFromFbi('49.36.10.2.AQYCAQMD')).toBe('49.36.10.2');
    expect(ipFromFbi('49.36.10.2')).toBe('49.36.10.2');
  });
  it('gives nothing for anything else', () => {
    for (const v of [undefined, '', '.AQYCAQMD', 'hello.AQ', '1.2.3.AQ']) expect(ipFromFbi(v)).toBe('');
  });
});
