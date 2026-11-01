/**
 * 스파이크 S3 — 같은 Studio 인스턴스에 문서 바이트를 다시 올리면(브리지의 "왕복 경로") 상태가 어떻게 되는가.
 * DOM 이 필요한 main.ts 경로(loadBytes → initializeDocument)는 코드로 읽고 노트에 적었다. 여기서는 DOM 없이 돌릴 수 있는
 * 핵심 사실만 실제 WASM 으로 고정한다: 문서 세대(documentGeneration)·에이전트 epoch·changeSeq·SHA·쪽수.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { initSync } from '@wasm/rhwp.js';
import { EventBus } from '@upstream/core/event-bus';
import { DocumentAgentController } from '@upstream/document-agent/controller';
import type { DocumentAgentInput } from '@upstream/document-agent/controller';
import { WasmBridge } from '../core/font-policy-wasm-bridge';

const here = fileURLToPath(new URL('.', import.meta.url));
const samplesDir = resolve(here, '../../../../third_party/rhwp/rhwp-studio/public/samples');
const wasmPath = resolve(here, '../../vendor/rhwp-core/rhwp_bg.wasm');
const sample = (name: string) => new Uint8Array(readFileSync(resolve(samplesDir, name)));

const stubInput = {
  getCursorPosition: () => ({ sectionIndex: 0, paragraphIndex: 0, charOffset: 0 }),
  getSelection: () => null,
  executeDocumentAgentOperation: () => { throw new Error('스파이크에서는 편집하지 않는다'); },
  focusBodyParagraph: () => false,
} as unknown as DocumentAgentInput;

describe('스파이크 S3: 같은 인스턴스에 문서를 다시 올리면', () => {
  beforeAll(() => {
    initSync({ module: readFileSync(wasmPath) });
  });

  it('문서 세대가 1 오르고, 에이전트 epoch 가 따라오며, changeSeq 는 0 으로 돌아가고, SHA·쪽수가 새 문서 것이 된다', () => {
    const wasm = new WasmBridge();
    const eventBus = new EventBus();
    wasm.loadDocument(sample('biz_plan.hwp'), 'biz_plan.hwp');
    const generation1 = wasm.documentGeneration;
    const controller = new DocumentAgentController({
      wasm, input: stubInput, eventBus, isDirty: () => false, render: async () => {},
    });
    const before = controller.getDocumentState();
    expect(before.documentEpoch).toBe(generation1);
    expect(before.pageCount).toBe(6);

    eventBus.emit('document-mutated', { reason: 'spike' });
    expect(controller.getDocumentState().changeSeq).toBe(1);

    wasm.loadDocument(sample('field-01.hwp'), 'field-01.hwp');
    const after = controller.getDocumentState();
    expect(wasm.documentGeneration).toBe(generation1 + 1);
    expect(after.documentEpoch).toBe(generation1 + 1);
    expect(after.changeSeq).toBe(0);
    expect(after.documentSha256).not.toBe(before.documentSha256);
    expect(after.pageCount).toBe(3);
    expect(wasm.fileName).toBe('field-01.hwp');
    controller.dispose();
  });

  it('같은 바이트를 다시 올려도 세대는 오르지만 SHA 는 같다 (낙관적 잠금은 epoch·changeSeq 가 먼저 걸린다)', () => {
    const wasm = new WasmBridge();
    const eventBus = new EventBus();
    wasm.loadDocument(sample('biz_plan.hwp'), 'biz_plan.hwp');
    const controller = new DocumentAgentController({
      wasm, input: stubInput, eventBus, isDirty: () => false, render: async () => {},
    });
    const before = controller.getDocumentState();
    wasm.loadDocument(sample('biz_plan.hwp'), 'biz_plan.hwp');
    const after = controller.getDocumentState();
    expect(after.documentEpoch).toBe(before.documentEpoch + 1);
    expect(after.documentSha256).toBe(before.documentSha256);
    controller.dispose();
  });
});
