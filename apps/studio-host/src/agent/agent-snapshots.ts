/** 에이전트 왕복 교체 직전 문서 바이트(스펙 §7). 창마다 최대 5개, n=1 이 가장 최근. */
export const MAX_AGENT_SNAPSHOTS = 5;

export type AgentSnapshotReason = 'replace' | 'restore';

export interface AgentSnapshotInfo {
  n: number;
  takenAt: string;
  reason: AgentSnapshotReason;
}

interface Snapshot {
  bytes: Uint8Array;
  takenAt: string;
  reason: AgentSnapshotReason;
}

export class AgentSnapshots {
  private readonly items: Snapshot[] = [];

  constructor(private readonly now: () => Date = () => new Date()) {}

  push(bytes: Uint8Array, reason: AgentSnapshotReason): void {
    this.items.unshift({ bytes, reason, takenAt: this.now().toISOString() });
    this.items.length = Math.min(this.items.length, MAX_AGENT_SNAPSHOTS);
  }

  list(): AgentSnapshotInfo[] {
    return this.items.map((item, index) => ({ n: index + 1, takenAt: item.takenAt, reason: item.reason }));
  }

  take(n: number): Uint8Array | undefined {
    return Number.isInteger(n) && n >= 1 ? this.items[n - 1]?.bytes : undefined;
  }

  /** 방금 쌓은 최신 스냅샷을 되돌린다(교체 실패 시). */
  dropLatest(): void {
    this.items.shift();
  }

  get size(): number {
    return this.items.length;
  }
}
