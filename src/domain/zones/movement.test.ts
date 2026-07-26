import { describe, expect, it } from 'vitest';

import { type ZoneRestriction, assessMovement, isActive, isAlertable } from './movement';

const NOW = new Date('2026-07-26T10:00:00Z');

function fmdOutbreak(zoneId: string, direction: ZoneRestriction['direction'] = 'OUTBOUND'): ZoneRestriction {
  return {
    zoneId,
    kind: 'FMD_OUTBREAK',
    direction,
    reason: 'Confirmed FMD case at Matsiloje',
    effectiveAt: new Date('2026-07-20T00:00:00Z'),
    liftedAt: null,
  };
}

describe('unrestricted movement', () => {
  it('needs no permit within a zone', () => {
    const verdict = assessMovement({
      originZoneId: 'z6',
      destinationZoneId: 'z6',
      restrictions: [],
      asOf: NOW,
    });

    expect(verdict.feasibility).toBe('SAME_ZONE');
    expect(verdict.permitRequired).toBe(false);
    expect(verdict.blocked).toBe(false);
    expect(isAlertable(verdict)).toBe(true);
  });

  it('requires a permit across zones', () => {
    const verdict = assessMovement({
      originZoneId: 'z6',
      destinationZoneId: 'z3',
      restrictions: [],
      asOf: NOW,
    });

    expect(verdict.feasibility).toBe('CROSS_ZONE_PERMIT_REQUIRED');
    expect(verdict.permitRequired).toBe(true);
    expect(verdict.blocked).toBe(false);
    expect(verdict.estimatedPermitDays).toBeGreaterThan(0);
    expect(isAlertable(verdict)).toBe(true);
  });
});

describe('restricted movement', () => {
  it('blocks animals leaving a zone under outbreak', () => {
    const verdict = assessMovement({
      originZoneId: 'z6',
      destinationZoneId: 'z3',
      restrictions: [fmdOutbreak('z6')],
      asOf: NOW,
    });

    expect(verdict.feasibility).toBe('BLOCKED');
    expect(verdict.blocked).toBe(true);
    expect(verdict.detail).toMatch(/foot-and-mouth/);
    expect(verdict.blockingRestrictions).toHaveLength(1);
  });

  it('blocks animals entering a zone closed to inbound stock', () => {
    const verdict = assessMovement({
      originZoneId: 'z6',
      destinationZoneId: 'z3',
      restrictions: [fmdOutbreak('z3', 'INBOUND')],
      asOf: NOW,
    });
    expect(verdict.blocked).toBe(true);
  });

  it('lets intra-zone movement continue under an outbound-only restriction', () => {
    // An outbound restriction stops stock leaving the zone; it does not stop
    // two farmers inside the zone trading with each other.
    const verdict = assessMovement({
      originZoneId: 'z6',
      destinationZoneId: 'z6',
      restrictions: [fmdOutbreak('z6', 'OUTBOUND')],
      asOf: NOW,
    });
    expect(verdict.feasibility).toBe('SAME_ZONE');
    expect(verdict.blocked).toBe(false);
  });

  it('blocks intra-zone movement under a blanket restriction', () => {
    const verdict = assessMovement({
      originZoneId: 'z6',
      destinationZoneId: 'z6',
      restrictions: [fmdOutbreak('z6', null)],
      asOf: NOW,
    });
    expect(verdict.blocked).toBe(true);
  });

  it('ignores a restriction that has been lifted', () => {
    const lifted: ZoneRestriction = {
      ...fmdOutbreak('z6'),
      liftedAt: new Date('2026-07-25T00:00:00Z'),
    };
    const verdict = assessMovement({
      originZoneId: 'z6',
      destinationZoneId: 'z3',
      restrictions: [lifted],
      asOf: NOW,
    });
    expect(verdict.blocked).toBe(false);
  });

  it('ignores a restriction that has not taken effect yet', () => {
    const future: ZoneRestriction = {
      ...fmdOutbreak('z6'),
      effectiveAt: new Date('2026-08-01T00:00:00Z'),
    };
    expect(isActive(future, NOW)).toBe(false);
  });
});

describe('alertability', () => {
  it('does not push alerts for animals nobody can lawfully move', () => {
    const verdict = assessMovement({
      originZoneId: 'z6',
      destinationZoneId: 'z3',
      restrictions: [fmdOutbreak('z6')],
      asOf: NOW,
    });
    expect(isAlertable(verdict)).toBe(false);
  });

  it('does not push alerts when the zone is unknown', () => {
    const verdict = assessMovement({
      originZoneId: null,
      destinationZoneId: 'z3',
      restrictions: [],
      asOf: NOW,
    });
    expect(verdict.feasibility).toBe('UNKNOWN_ZONE');
    expect(isAlertable(verdict)).toBe(false);
  });
});
