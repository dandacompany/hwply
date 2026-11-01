import { describe, expect, it, vi } from 'vitest';
import { DocumentAgentError } from '@upstream/document-agent/types';
import { AgentAdapter, type AgentAdapterDeps, type AgentRequest } from './agent-adapter';
import { AgentBridgeError } from './agent-errors';
import { AgentSnapshots } from './agent-snapshots';

const STATE = {
  schemaVersion: 1 as const,
  format: 'hwp' as const,
  documentEpoch: 2,
  changeSeq: 5,
  dirty: false,
  pageCount: 1,
  documentSha256: 'sha-a',
};
const EXPECTED = { documentEpoch: 2, changeSeq: 5, documentSha256: 'sha-a' };

/** collectTargetEvidence 가 읽는 최소 WASM. 문단 3개, 모두 같은 서식. */
function fakeWasm(options: { fieldAt?: [number, number] } = {}) {
  const texts = [['첫 문단', '둘째 문단', '셋째']];
  return {
    requiresPasswordForSave: false,
    documentGeneration: 2,
    pageCount: 1,
    getSourceFormat: () => 'hwp',
    getSectionCount: () => 1,
    getParagraphCount: () => texts[0].length,
    getParagraphLength: (s: number, p: number) => texts[s][p].length,
    getTextRange: (s: number, p: number, offset: number, count: number) =>
      texts[s][p].slice(offset, offset + count),
    getControlTextPositions: () => [],
    getCharPropertiesAt: () => ({ charShapeId: 1 }),
    getParaPropertiesAt: () => ({ paraShapeId: 2 }),
    getStyleAt: () => ({ id: 0, name: '바탕글' }),
    getFieldInfoAt: (pos: { sectionIndex: number; paragraphIndex: number }) => ({
      inField: options.fieldAt?.[0] === pos.sectionIndex && options.fieldAt?.[1] === pos.paragraphIndex,
    }),
  };
}

function setup(overrides: { wasm?: ReturnType<typeof fakeWasm>; states?: typeof STATE[] } = {}) {
  const wasm = overrides.wasm ?? fakeWasm();
  const states = [...(overrides.states ?? [])];
  const handlers = {
    getDocumentState: vi.fn(async () => states.shift() ?? STATE),
    exportHwp: vi.fn(async () => new Uint8Array([1, 2, 3])),
    exportHwpx: vi.fn(async () => new Uint8Array([4, 5])),
    exportHml: vi.fn(async () => new Uint8Array([6])),
    getSelectionContext: vi.fn(async () => ({ schemaVersion: 1, page: 0 })),
    applyTextCommand: vi.fn(async (command: { commandId: string }) => ({ commandId: command.commandId, afterChangeSeq: 6 })),
    focusTarget: vi.fn(async () => ({ focused: true, page: 0 })),
  };
  const responses: { id: string; reply: { result?: unknown; error?: { code: string; message: string; state?: unknown } } }[] = [];
  const host = {
    saveForAgent: vi.fn(async () => ({ state: { docId: 'd1' }, path: '/docs/a.hwp', warnings: [] as string[] })),
    reloadForAgent: vi.fn(async () => undefined),
  };
  const files = new Map<string, Uint8Array>([['/stage/in.hwp', new Uint8Array([9, 9])]]);
  const snapshots = new AgentSnapshots();
  const notify = vi.fn();
  const deps: AgentAdapterDeps = {
    handlers: async () => handlers as never,
    wasm: () => wasm as never,
    host,
    readFile: vi.fn(async (path: string) => {
      const bytes = files.get(path);
      if (!bytes) throw new Error(`no file ${path}`);
      return bytes;
    }),
    writeFile: vi.fn(async (path: string, bytes: Uint8Array) => { files.set(path, bytes); }),
    respond: vi.fn(async (id, reply) => { responses.push({ id, reply }); }),
    snapshots,
    notify,
    confirm: vi.fn(async () => true),
  };
  return { deps, adapter: new AgentAdapter(deps), handlers, host, files, snapshots, notify, responses, wasm };
}

function request(method: string, params: Record<string, unknown> = {}): AgentRequest {
  return { requestId: 'r1', method, params };
}

describe('agent adapter', () => {
  it('responds exactly once even when the handler throws', async () => {
    const t = setup();
    t.handlers.getSelectionContext.mockRejectedValue(new Error('boom'));
    await t.adapter.handle(request('selection'));
    expect(t.responses).toHaveLength(1);
    expect(t.responses[0].reply.error).toMatchObject({ code: 'INTERNAL_ERROR', message: 'boom' });
  });

  it('export writes bytes to stagedPath and returns the state seen after export', async () => {
    const t = setup();
    await t.adapter.handle(request('export', { format: 'hwpx', stagedPath: '/stage/out.hwpx' }));
    expect(t.files.get('/stage/out.hwpx')).toEqual(new Uint8Array([4, 5]));
    expect(t.responses[0].reply).toEqual({ result: { state: STATE } });
  });

  it('export retries when state changes during export and gives DOCUMENT_CHANGED after 3 tries', async () => {
    const changing = [1, 2, 3, 4, 5, 6].map((changeSeq) => ({ ...STATE, changeSeq }));
    const t = setup({ states: changing });
    await t.adapter.handle(request('export', { format: 'hwp', stagedPath: '/stage/out.hwp' }));
    expect(t.handlers.exportHwp).toHaveBeenCalledTimes(3);
    expect(t.responses[0].reply.error?.code).toBe('DOCUMENT_CHANGED');
    expect(t.files.has('/stage/out.hwp')).toBe(false);
  });

  it('paragraph reports evidence for a plain paragraph', async () => {
    const t = setup();
    await t.adapter.handle(request('paragraph', { section: 0, paragraph: 1 }));
    const result = t.responses[0].reply.result as Record<string, unknown>;
    expect(result).toMatchObject({ section: 0, paragraph: 1, length: 5, text: '둘째 문단', editable: true, state: STATE });
    expect(result.evidence).toEqual({
      beforeSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      formatSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      adjacentContextSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });

  it('paragraph reports editable:false with reason for a field paragraph', async () => {
    const t = setup({ wasm: fakeWasm({ fieldAt: [0, 0] }) });
    await t.adapter.handle(request('paragraph', { section: 0, paragraph: 0 }));
    const result = t.responses[0].reply.result as Record<string, unknown>;
    expect(result).toMatchObject({ editable: false, text: '첫 문단' });
    expect(result.reason).toContain('필드');
    expect(result.evidence).toBeUndefined();
  });

  it('paragraph outside the document is TARGET_NOT_FOUND', async () => {
    const t = setup();
    await t.adapter.handle(request('paragraph', { section: 0, paragraph: 9 }));
    expect(t.responses[0].reply.error?.code).toBe('TARGET_NOT_FOUND');
  });

  it('text rejects stale expected with DOCUMENT_CHANGED and current state', async () => {
    const t = setup();
    await t.adapter.handle(request('text', {
      section: 0, paragraph: 1, length: 5, replacement: 'x',
      expected: { ...EXPECTED, changeSeq: 4 },
      evidence: { beforeSha256: 'a', formatSha256: 'b', adjacentContextSha256: 'c' },
    }));
    expect(t.handlers.applyTextCommand).not.toHaveBeenCalled();
    expect(t.responses[0].reply.error).toMatchObject({ code: 'DOCUMENT_CHANGED', state: STATE });
  });

  it('text builds the upstream command from expected and evidence', async () => {
    const t = setup();
    await t.adapter.handle(request('text', {
      section: 0, paragraph: 1, length: 5, replacement: '새 문단',
      expected: EXPECTED,
      evidence: { beforeSha256: 'a', formatSha256: 'b', adjacentContextSha256: 'c' },
    }));
    expect(t.handlers.applyTextCommand).toHaveBeenCalledWith(expect.objectContaining({
      schemaVersion: 1,
      expectedDocumentEpoch: 2,
      expectedChangeSeq: 5,
      expectedDocumentSha256: 'sha-a',
      target: { kind: 'body_paragraph', section: 0, paragraph: 1, charOffset: 0, length: 5 },
      expectedBeforeSha256: 'a',
      expectedFormatSha256: 'b',
      expectedAdjacentContextSha256: 'c',
      replacement: '새 문단',
    }));
    expect(t.notify).toHaveBeenCalledWith({ kind: 'live' });
  });

  it('text passes upstream error codes through', async () => {
    const t = setup();
    t.handlers.applyTextCommand.mockRejectedValue(new DocumentAgentError('TARGET_PREIMAGE_MISMATCH', '본문이 다릅니다'));
    await t.adapter.handle(request('text', {
      section: 0, paragraph: 1, length: 5, replacement: 'x', expected: EXPECTED,
      evidence: { beforeSha256: 'a', formatSha256: 'b', adjacentContextSha256: 'c' },
    }));
    expect(t.responses[0].reply.error).toMatchObject({ code: 'TARGET_PREIMAGE_MISMATCH', message: '본문이 다릅니다' });
  });

  it('replace rejects stale expected and leaves document untouched', async () => {
    const t = setup();
    await t.adapter.handle(request('replace', { stagedPath: '/stage/in.hwp', expected: { ...EXPECTED, documentSha256: 'old' } }));
    expect(t.responses[0].reply.error?.code).toBe('DOCUMENT_CHANGED');
    expect(t.host.reloadForAgent).not.toHaveBeenCalled();
    expect(t.snapshots.list()).toHaveLength(0);
  });

  it('replace snapshots current bytes, reloads the staged bytes and reports the new state', async () => {
    const after = { ...STATE, documentEpoch: 3, changeSeq: 0 };
    // 사전조건 확인, 내보낸 뒤 재확인, 교체 뒤 상태.
    const t = setup({ states: [STATE, STATE, after] });
    await t.adapter.handle(request('replace', { stagedPath: '/stage/in.hwp', expected: EXPECTED }));
    expect(t.snapshots.take(1)).toEqual(new Uint8Array([1, 2, 3]));
    expect(t.host.reloadForAgent).toHaveBeenCalledWith(new Uint8Array([9, 9]));
    expect(t.responses[0].reply).toEqual({ result: { state: after } });
    expect(t.notify).toHaveBeenCalledWith({ kind: 'roundtrip' });
  });

  it('replace restores previous bytes when reload fails', async () => {
    const t = setup();
    t.host.reloadForAgent.mockRejectedValueOnce(new Error('parse failed'));
    await t.adapter.handle(request('replace', { stagedPath: '/stage/in.hwp', expected: EXPECTED }));
    expect(t.host.reloadForAgent).toHaveBeenLastCalledWith(new Uint8Array([1, 2, 3]));
    expect(t.snapshots.list()).toHaveLength(0);
    expect(t.responses[0].reply.error).toMatchObject({ message: 'parse failed' });
  });

  it('replace rejects a human edit that lands while the staged file is read', async () => {
    const t = setup();
    const edited = { ...STATE, changeSeq: 6 };
    let read = false;
    t.handlers.getDocumentState.mockImplementation(async () => (read ? edited : STATE));
    (t.adapter as unknown as { deps: AgentAdapterDeps }).deps.readFile = vi.fn(async () => {
      read = true;
      return new Uint8Array([9, 9]);
    });
    await t.adapter.handle(request('replace', { stagedPath: '/stage/in.hwp', expected: EXPECTED }));
    expect(t.responses[0].reply.error?.code).toBe('DOCUMENT_CHANGED');
    expect(t.host.reloadForAgent).not.toHaveBeenCalled();
    expect(t.snapshots.list()).toHaveLength(0);
  });

  it('replace rejects a human edit that lands while the current bytes are exported', async () => {
    const t = setup();
    let exported = false;
    t.handlers.getDocumentState.mockImplementation(async () => (exported ? { ...STATE, changeSeq: 6 } : STATE));
    t.handlers.exportHwp.mockImplementation(async () => {
      exported = true;
      return new Uint8Array([1, 2, 3]);
    });
    await t.adapter.handle(request('replace', { stagedPath: '/stage/in.hwp', expected: EXPECTED }));
    expect(t.responses[0].reply.error?.code).toBe('DOCUMENT_CHANGED');
    expect(t.host.reloadForAgent).not.toHaveBeenCalled();
    expect(t.snapshots.list()).toHaveLength(0);
  });

  it('encrypted documents refuse export, text, replace, save and restore with DOCUMENT_ENCRYPTED', async () => {
    const t = setup();
    t.wasm.requiresPasswordForSave = true;
    for (const method of ['export', 'text', 'replace', 'save', 'restore']) {
      await t.adapter.handle({ requestId: method, method, params: { n: 1, expected: EXPECTED } });
    }
    expect(t.responses.map((r) => r.reply.error?.code)).toEqual(Array(5).fill('DOCUMENT_ENCRYPTED'));
    expect(t.handlers.exportHwp).not.toHaveBeenCalled();
    expect(t.host.saveForAgent).not.toHaveBeenCalled();
  });

  it('restore of a missing snapshot gives SNAPSHOT_NOT_FOUND', async () => {
    const t = setup();
    await t.adapter.handle(request('restore', { n: 1 }));
    expect(t.responses[0].reply.error?.code).toBe('SNAPSHOT_NOT_FOUND');
  });

  it('runs one request at a time per window', async () => {
    const t = setup();
    let release!: () => void;
    t.handlers.getSelectionContext.mockImplementationOnce(() => new Promise((resolve) => {
      release = () => resolve({ schemaVersion: 1, page: 0 });
    }));
    const first = t.adapter.handle(request('selection'));
    const second = t.adapter.handle({ requestId: 'r2', method: 'snapshots', params: {} });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(t.responses).toHaveLength(0);
    release();
    await Promise.all([first, second]);
    expect(t.responses.map((r) => r.id)).toEqual(['r1', 'r2']);
  });

  it('restoreLatest waits for an in-flight agent request', async () => {
    const t = setup();
    t.snapshots.push(new Uint8Array([7]), 'replace');
    let release!: () => void;
    t.handlers.getSelectionContext.mockImplementationOnce(() => new Promise((resolve) => {
      release = () => resolve({ schemaVersion: 1, page: 0 });
    }));
    const inFlight = t.adapter.handle(request('selection'));
    const restore = t.adapter.restoreLatest();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(t.host.reloadForAgent).not.toHaveBeenCalled();
    release();
    await Promise.all([inFlight, restore]);
    expect(t.host.reloadForAgent).toHaveBeenCalledWith(new Uint8Array([7]));
  });

  it('restoreLatest asks before discarding edits made after the agent change', async () => {
    const after = { ...STATE, documentEpoch: 3, changeSeq: 0 };
    const t = setup({ states: [STATE, STATE, after] });
    await t.adapter.handle(request('replace', { stagedPath: '/stage/in.hwp', expected: EXPECTED }));
    t.host.reloadForAgent.mockClear();
    t.handlers.getDocumentState.mockResolvedValue({ ...after, changeSeq: 4 });
    vi.mocked(t.deps.confirm).mockResolvedValueOnce(false);
    await t.adapter.restoreLatest();
    expect(t.deps.confirm).toHaveBeenCalledTimes(1);
    expect(vi.mocked(t.deps.confirm).mock.calls[0][0]).toContain('사람이 고친');
    expect(t.host.reloadForAgent).not.toHaveBeenCalled();
  });

  it('restoreLatest does not ask when nothing changed since the agent change', async () => {
    const after = { ...STATE, documentEpoch: 3, changeSeq: 0 };
    const t = setup({ states: [STATE, STATE, after] });
    await t.adapter.handle(request('replace', { stagedPath: '/stage/in.hwp', expected: EXPECTED }));
    t.host.reloadForAgent.mockClear();
    t.handlers.getDocumentState.mockResolvedValue(after);
    await t.adapter.restoreLatest();
    expect(t.deps.confirm).not.toHaveBeenCalled();
    expect(t.host.reloadForAgent).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]));
  });

  it('restoreLatest snapshots current bytes before reloading the latest snapshot', async () => {
    const t = setup();
    t.snapshots.push(new Uint8Array([7]), 'replace');
    await t.adapter.restoreLatest();
    expect(t.host.reloadForAgent).toHaveBeenCalledWith(new Uint8Array([7]));
    expect(t.snapshots.take(1)).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('save maps bridge errors and returns state, path and warnings', async () => {
    const t = setup();
    t.host.saveForAgent.mockRejectedValueOnce(new AgentBridgeError('FILE_CHANGED_ON_DISK', '밖에서 바뀜'));
    await t.adapter.handle(request('save', { force: false }));
    expect(t.responses[0].reply.error?.code).toBe('FILE_CHANGED_ON_DISK');
    await t.adapter.handle({ requestId: 'r2', method: 'save', params: { path: '/docs/b.hwp', force: true } });
    expect(t.host.saveForAgent).toHaveBeenLastCalledWith({ targetPath: '/docs/b.hwp', force: true });
    expect(t.responses[1].reply.result).toEqual({ state: STATE, path: '/docs/a.hwp', warnings: [] });
  });

  it('unknown methods are BAD_REQUEST', async () => {
    const t = setup();
    await t.adapter.handle(request('format-disk'));
    expect(t.responses[0].reply.error?.code).toBe('BAD_REQUEST');
  });
});
