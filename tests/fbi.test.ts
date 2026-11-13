import { describe, expect, it } from 'vitest';
import { fbiAddress } from '../server/services/tracking';

describe('the _fbi cookie (Meta Parameter Builder)', () => {
  it('reads the IPv6 or IPv4 address, with or without Meta’s suffix', () => {
    expect(fbiAddress('2401:4900:1c3a:ABCD::1.AQYBAQMD')).toBe('2401:4900:1c3a:abcd::1');
    expect(fbiAddress('2401:4900:1c3a:abcd::1')).toBe('2401:4900:1c3a:abcd::1');
    expect(fbiAddress('49.36.10.2.AQYBAQMD')).toBe('49.36.10.2');
    expect(fbiAddress('49.36.10.2')).toBe('49.36.10.2');
  });
  it('ignores anything that is not an address', () => {
    for (const v of [undefined, '', 'AQYBAQMD', 'not-an-ip.AQ', '999.1.1.1.AQ', 'x'.repeat(300)]) expect(fbiAddress(v)).toBeNull();
  });
});
