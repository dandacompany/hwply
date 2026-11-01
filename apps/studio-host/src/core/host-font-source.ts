import { copyHostSnapshot, type HostFontData, type HostFontProvider,
  type HostFontReference, type HostFontSnapshot } from './host-font-contract';

/** Optional host transport; metadata is indexed by the existing product catalog. */
export class HostFontSource {
  private provider: HostFontProvider | null = null;
  private off: (() => void) | null = null;
  private connection = 0;
  private epoch = 0;
  private controller = new AbortController();
  private snapshot: HostFontSnapshot | null = null;
  private refs = new Map<string, HostFontReference>();
  private pending: Promise<readonly HostFontReference[]> | null = null;
  private reads = new Map<string, Promise<HostFontData | null>>();
  private error: string | null = null;

  constructor(private readonly changed: () => void) {}
  get active(): boolean { return this.provider !== null; }
  get lastError(): string | null { return this.error; }

  reset(): void {
    this.controller.abort();
    this.controller = new AbortController();
    this.epoch += 1;
    this.snapshot = null;
    this.refs.clear();
    this.pending = null;
    this.reads.clear();
    this.error = null;
  }

  setProvider(provider: HostFontProvider | null): void {
    const connection = ++this.connection;
    const off = this.off;
    this.off = null;
    this.provider = provider;
    this.changed();
    try { off?.(); } catch { /* A replaced transport cannot affect the new catalog. */ }
    if (!provider || connection !== this.connection) return;
    try {
      const unsubscribe = provider.subscribe(() => {
        if (connection === this.connection) this.changed();
      });
      if (typeof unsubscribe !== 'function') throw new Error('Missing host font disposer');
      this.off = unsubscribe;
    } catch { this.error = '호스트 글꼴 변경 구독을 시작하지 못했습니다.'; }
  }

  references(): Promise<readonly HostFontReference[]> {
    if (!this.provider || this.error) return Promise.resolve([]);
    if (this.snapshot) return Promise.resolve([...this.refs.values()]);
    if (this.pending) return this.pending;
    const provider = this.provider;
    const generation = this.epoch;
    const signal = this.controller.signal;
    const pending = Promise.resolve().then(() => provider.getSnapshot(signal)).then(value => {
      if (signal.aborted || generation !== this.epoch) return [];
      this.snapshot = copyHostSnapshot(value);
      this.refs = new Map(this.snapshot.faces.map(face => {
        const ref = Object.freeze({ key: JSON.stringify(['host', generation, this.snapshot!.revision, face.id]),
          face, revision: this.snapshot!.revision, generation });
        return [ref.key, ref];
      }));
      return [...this.refs.values()];
    }).catch(() => {
      if (!signal.aborted && generation === this.epoch) this.error = '호스트 글꼴 목록을 읽지 못했습니다.';
      return [];
    }).finally(() => { if (this.pending === pending) this.pending = null; });
    this.pending = pending;
    return pending;
  }

  read(ref: HostFontReference): Promise<HostFontData | null> {
    if (!this.provider || this.refs.get(ref.key) !== ref || ref.generation !== this.epoch) {
      return Promise.resolve(null);
    }
    const signal = this.controller.signal;
    const provider = this.provider;
    let pending = this.reads.get(ref.key);
    if (!pending) {
      pending = Promise.resolve().then(() => provider.readFace(ref.face.id, ref.revision, signal))
        .then(data => {
          if (signal.aborted || ref.generation !== this.epoch || !(data?.bytes instanceof ArrayBuffer)
            || !data.bytes.byteLength || data.bytes.byteLength > 64 * 1024 * 1024
            || !Number.isSafeInteger(data.faceIndex ?? 0) || (data.faceIndex ?? 0) < 0) return null;
          return { bytes: data.bytes.slice(0), faceIndex: data.faceIndex ?? 0 };
        }, () => null).finally(() => { if (this.reads.get(ref.key) === pending) this.reads.delete(ref.key); });
      this.reads.set(ref.key, pending);
    }
    return pending.then(data => signal.aborted || !data ? null : { ...data, bytes: data.bytes.slice(0) });
  }
}
