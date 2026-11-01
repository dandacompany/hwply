import { describe, expect, it } from 'vitest';
import { AgentSnapshots } from './agent-snapshots';

describe('agent snapshots', () => {
  it('keeps at most five, newest first', () => {
    const snapshots = new AgentSnapshots(() => new Date('2026-10-31T00:00:00Z'));
    for (let i = 1; i <= 6; i += 1) snapshots.push(new Uint8Array([i]), 'replace');
    const list = snapshots.list();
    expect(list.map((s) => s.n)).toEqual([1, 2, 3, 4, 5]);
    expect(snapshots.take(1)).toEqual(new Uint8Array([6]));
    expect(snapshots.take(5)).toEqual(new Uint8Array([2]));
    expect(list[0]).toMatchObject({ reason: 'replace', takenAt: '2026-10-31T00:00:00.000Z' });
  });

  it('take returns undefined for 0 and 6', () => {
    const snapshots = new AgentSnapshots();
    snapshots.push(new Uint8Array([1]), 'restore');
    expect(snapshots.take(0)).toBeUndefined();
    expect(snapshots.take(6)).toBeUndefined();
  });
});
