import { collectTargetEvidence, type DocumentAgentWasm } from '@upstream/document-agent/controller';
import { DocumentAgentError } from '@upstream/document-agent/types';
import type {
  RhwpBodyParagraphTargetV1,
  RhwpDocumentStateV1,
} from '@upstream/document-agent/types';
import type { DesktopStudioHandlers } from '../embed/desktop-runtime';
import { AgentBridgeError, toWireError, type WireError } from './agent-errors';
import type { AgentSnapshots } from './agent-snapshots';

/** Rust 브리지가 `hwply-agent-request` 로 보내는 요청. */
export interface AgentRequest {
  requestId: string;
  method: string;
  params: Record<string, unknown>;
}

export interface AgentReply {
  result?: unknown;
  error?: WireError;
}

export type AgentActivityEvent = { kind: 'live' | 'roundtrip' };

interface Expected {
  documentEpoch: number;
  changeSeq: number;
  documentSha256: string;
}

export interface AgentHostPort {
  saveForAgent(options: { targetPath?: string; force: boolean }): Promise<{
    state: unknown;
    path: string;
    warnings: string[];
  }>;
  reloadForAgent(bytes: Uint8Array): Promise<void>;
}

type AgentWasm = DocumentAgentWasm & { requiresPasswordForSave: boolean };

export interface AgentAdapterDeps {
  handlers(): Promise<DesktopStudioHandlers>;
  wasm(): AgentWasm;
  host: AgentHostPort;
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, bytes: Uint8Array): Promise<void>;
  respond(requestId: string, reply: AgentReply): Promise<void>;
  snapshots: AgentSnapshots;
  notify(event: AgentActivityEvent): void;
  /** 사람에게 묻는다(되돌리기 확인). */
  confirm(message: string): Promise<boolean>;
}

/** 내보내는 사이 사람이 편집하면 다시 시도하는 횟수. */
const EXPORT_ATTEMPTS = 3;
const ENCRYPTED_METHODS = new Set(['export', 'text', 'replace', 'save', 'restore']);

/**
 * 창 하나의 에이전트 요청 처리기(스펙 §8.4·§8.5). 상류 embed 핸들러를 페이지 안에서 직접 부른다.
 * 결과든 오류든 요청마다 `respond` 를 정확히 한 번 부른다.
 */
export class AgentAdapter {
  /** 창 안의 작업 줄. Rust 가 시한으로 잠금을 풀어도, 사람이 되돌리기를 눌러도 한 번에 하나만 돈다. */
  private queue: Promise<void> = Promise.resolve();
  /** 마지막 에이전트 변경 직후 상태. 되돌릴 때 그 뒤 사람 편집이 있었는지 본다. */
  private lastAgentState: RhwpDocumentStateV1 | null = null;

  constructor(private readonly deps: AgentAdapterDeps) {}

  handle(request: AgentRequest): Promise<void> {
    return this.enqueue(async () => {
      let reply: AgentReply;
      try {
        reply = { result: await this.dispatch(request.method, request.params ?? {}) };
      } catch (error) {
        reply = { error: toWireError(error) };
      }
      await this.deps.respond(request.requestId, reply);
    });
  }

  /** 사람이 토스트·배지에서 누르는 "에이전트 변경 전으로 되돌리기". 그 뒤 사람 편집이 있으면 먼저 묻는다. */
  restoreLatest(): Promise<void> {
    return this.enqueue(async () => {
      const handlers = await this.deps.handlers();
      const now = await handlers.getDocumentState();
      if (this.lastAgentState && !sameState(this.lastAgentState, now)) {
        const ok = await this.deps.confirm(
          '에이전트 변경 뒤에 사람이 고친 내용이 있습니다. 되돌리면 그 내용도 화면에서 사라집니다'
          + '(되돌리기 직전 상태는 스냅샷으로 남습니다). 되돌릴까요?',
        );
        if (!ok) return;
      }
      await this.restore(1, undefined);
    });
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async dispatch(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (ENCRYPTED_METHODS.has(method) && this.deps.wasm().requiresPasswordForSave) {
      throw new AgentBridgeError(
        'DOCUMENT_ENCRYPTED',
        '암호 문서는 에이전트가 내보내거나 바꿀 수 없습니다. hwply 에서 직접 저장하세요.',
      );
    }
    const handlers = await this.deps.handlers();
    switch (method) {
      case 'state':
        return handlers.getDocumentState();
      case 'export':
        return this.export(handlers, stringParam(params, 'format'), stringParam(params, 'stagedPath'));
      case 'selection':
        return handlers.getSelectionContext();
      case 'paragraph':
        return this.paragraph(handlers, numberParam(params, 'section'), numberParam(params, 'paragraph'));
      case 'text':
        return this.text(handlers, params);
      case 'replace':
        return this.replace(handlers, stringParam(params, 'stagedPath'), expectedParam(params, true));
      case 'save':
        return this.save(handlers, params);
      case 'focus':
        return this.focus(handlers, numberParam(params, 'section'), numberParam(params, 'paragraph'));
      case 'snapshots':
        return { snapshots: this.deps.snapshots.list() };
      case 'restore':
        return this.restore(numberParam(params, 'n'), expectedParam(params, false));
      default:
        throw new AgentBridgeError('BAD_REQUEST', `알 수 없는 요청입니다: ${method}`);
    }
  }

  private async export(handlers: DesktopStudioHandlers, format: string, stagedPath: string) {
    for (let attempt = 0; attempt < EXPORT_ATTEMPTS; attempt += 1) {
      const before = await handlers.getDocumentState();
      const bytes = await exportBytes(handlers, format);
      const after = await handlers.getDocumentState();
      if (sameState(before, after)) {
        await this.deps.writeFile(stagedPath, bytes);
        return { state: after };
      }
    }
    throw new AgentBridgeError(
      'DOCUMENT_CHANGED',
      '내보내는 동안 문서가 계속 바뀌었습니다. 잠시 뒤 다시 시도하세요.',
      await handlers.getDocumentState(),
    );
  }

  private async paragraph(handlers: DesktopStudioHandlers, section: number, paragraph: number) {
    const wasm = this.deps.wasm();
    const state = await handlers.getDocumentState();
    if (section < 0 || section >= wasm.getSectionCount()
        || paragraph < 0 || paragraph >= wasm.getParagraphCount(section)) {
      throw new DocumentAgentError('TARGET_NOT_FOUND', `문단 ${section}.${paragraph} 이 없습니다.`);
    }
    const length = wasm.getParagraphLength(section, paragraph);
    const text = wasm.getTextRange(section, paragraph, 0, length);
    const base = { section, paragraph, length, text, state };
    try {
      const evidence = collectTargetEvidence(wasm, bodyTarget(section, paragraph, length));
      return {
        ...base,
        editable: true,
        evidence: {
          beforeSha256: evidence.textSha256,
          formatSha256: evidence.formatSha256,
          adjacentContextSha256: evidence.adjacentContextSha256,
        },
      };
    } catch (error) {
      if (error instanceof DocumentAgentError && error.code === 'TARGET_FORMAT_MISMATCH') {
        return { ...base, editable: false, reason: error.message };
      }
      throw error;
    }
  }

  private async text(handlers: DesktopStudioHandlers, params: Record<string, unknown>) {
    const expected = expectedParam(params, true)!;
    await this.assertExpected(handlers, expected);
    const evidence = objectParam(params, 'evidence');
    const receipt = await handlers.applyTextCommand({
      schemaVersion: 1,
      commandId: crypto.randomUUID(),
      expectedDocumentEpoch: expected.documentEpoch,
      expectedChangeSeq: expected.changeSeq,
      expectedDocumentSha256: expected.documentSha256,
      target: bodyTarget(numberParam(params, 'section'), numberParam(params, 'paragraph'), numberParam(params, 'length')),
      expectedBeforeSha256: stringParam(evidence, 'beforeSha256'),
      expectedFormatSha256: stringParam(evidence, 'formatSha256'),
      expectedAdjacentContextSha256: stringParam(evidence, 'adjacentContextSha256'),
      replacement: stringParam(params, 'replacement'),
    });
    this.lastAgentState = await handlers.getDocumentState();
    this.deps.notify({ kind: 'live' });
    return receipt;
  }

  private async replace(handlers: DesktopStudioHandlers, stagedPath: string, expected: Expected | undefined) {
    // 파일 읽기(IPC 여러 번)를 사전조건 확인보다 먼저 한다. 확인과 재적재 사이에 사람이 칠 틈을 줄인다.
    const incoming = await this.deps.readFile(stagedPath);
    const current = await this.assertExpected(handlers, expected);
    await this.swapIn(handlers, current, incoming, 'replace');
    const state = await handlers.getDocumentState();
    this.lastAgentState = state;
    this.deps.notify({ kind: 'roundtrip' });
    return { state };
  }

  private async restore(n: number, expected: Expected | undefined) {
    const snapshot = this.deps.snapshots.take(n);
    if (!snapshot) throw new AgentBridgeError('SNAPSHOT_NOT_FOUND', `스냅샷 ${n} 이 없습니다.`);
    const handlers = await this.deps.handlers();
    const current = await this.assertExpected(handlers, expected);
    await this.swapIn(handlers, current, snapshot, 'restore');
    return { state: await handlers.getDocumentState() };
  }

  /** 지금 바이트를 스냅샷으로 쌓고 새 바이트를 같은 창에 올린다. 실패하면 원래 바이트로 되돌린다. */
  private async swapIn(
    handlers: DesktopStudioHandlers,
    current: RhwpDocumentStateV1,
    incoming: Uint8Array,
    reason: 'replace' | 'restore',
  ): Promise<void> {
    const previous = await exportBytes(handlers, current.format);
    // 내보내는 사이 사람이 고쳤으면 그 편집은 스냅샷에도 없다. 바꾸지 않고 거절한다.
    const after = await handlers.getDocumentState();
    if (!sameState(current, after)) {
      throw new AgentBridgeError('DOCUMENT_CHANGED', '문서가 그 사이 바뀌었습니다. 다시 읽고 다시 보내세요.', after);
    }
    this.deps.snapshots.push(previous, reason);
    try {
      await this.deps.host.reloadForAgent(incoming);
    } catch (error) {
      this.deps.snapshots.dropLatest();
      await this.deps.host.reloadForAgent(previous).catch((restoreError) => {
        console.error('[agent] 교체 실패 후 원래 문서로 되돌리지 못했습니다:', restoreError);
      });
      throw error;
    }
  }

  private async save(handlers: DesktopStudioHandlers, params: Record<string, unknown>) {
    await this.assertExpected(handlers, expectedParam(params, false));
    const path = params.path;
    if (path !== undefined && path !== null && typeof path !== 'string') {
      throw new AgentBridgeError('BAD_REQUEST', 'path 는 문자열이어야 합니다');
    }
    const saved = await this.deps.host.saveForAgent({
      ...(typeof path === 'string' ? { targetPath: path } : {}),
      force: params.force === true,
    });
    return { state: await handlers.getDocumentState(), path: saved.path, warnings: saved.warnings };
  }

  private async focus(handlers: DesktopStudioHandlers, section: number, paragraph: number) {
    const wasm = this.deps.wasm();
    const length = wasm.getParagraphLength(section, paragraph);
    return handlers.focusTarget(bodyTarget(section, paragraph, length));
  }

  private async assertExpected(
    handlers: DesktopStudioHandlers,
    expected: Expected | undefined,
  ): Promise<RhwpDocumentStateV1> {
    const state = await handlers.getDocumentState();
    if (expected && (expected.documentEpoch !== state.documentEpoch
        || expected.changeSeq !== state.changeSeq
        || expected.documentSha256 !== state.documentSha256)) {
      throw new AgentBridgeError(
        'DOCUMENT_CHANGED',
        '문서가 그 사이 바뀌었습니다. 다시 읽고 다시 보내세요.',
        state,
      );
    }
    return state;
  }
}

function exportBytes(handlers: DesktopStudioHandlers, format: string): Promise<Uint8Array> {
  if (format === 'hwp') return handlers.exportHwp();
  if (format === 'hwpx') return handlers.exportHwpx();
  if (format === 'hml') return handlers.exportHml();
  throw new AgentBridgeError('BAD_REQUEST', `알 수 없는 형식입니다: ${format}`);
}

function sameState(a: RhwpDocumentStateV1, b: RhwpDocumentStateV1): boolean {
  return a.documentEpoch === b.documentEpoch
    && a.changeSeq === b.changeSeq
    && a.documentSha256 === b.documentSha256;
}

function bodyTarget(section: number, paragraph: number, length: number): RhwpBodyParagraphTargetV1 {
  return { kind: 'body_paragraph', section, paragraph, charOffset: 0, length };
}

function stringParam(params: Record<string, unknown>, key: string): string {
  const value = params[key];
  if (typeof value !== 'string') throw new AgentBridgeError('BAD_REQUEST', `${key} 가 필요합니다`);
  return value;
}

function numberParam(params: Record<string, unknown>, key: string): number {
  const value = params[key];
  if (!Number.isSafeInteger(value)) throw new AgentBridgeError('BAD_REQUEST', `${key} 는 정수여야 합니다`);
  return value as number;
}

function objectParam(params: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = params[key];
  if (!value || typeof value !== 'object') throw new AgentBridgeError('BAD_REQUEST', `${key} 가 필요합니다`);
  return value as Record<string, unknown>;
}

function expectedParam(params: Record<string, unknown>, required: boolean): Expected | undefined {
  const value = params.expected;
  if (value === undefined || value === null) {
    if (required) throw new AgentBridgeError('BAD_REQUEST', 'expected 가 필요합니다');
    return undefined;
  }
  const expected = value as Record<string, unknown>;
  return {
    documentEpoch: numberParam(expected, 'documentEpoch'),
    changeSeq: numberParam(expected, 'changeSeq'),
    documentSha256: stringParam(expected, 'documentSha256'),
  };
}
