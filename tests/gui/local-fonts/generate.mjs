import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HwpDocument, initSync } from '../../../apps/studio-host/vendor/rhwp-core/rhwp.js';

export const sampleText = 'HWPLY LOCAL FONT 0123456789 iii WWW Abel';
export function generateDocuments(output) {
  initSync({ module: readFileSync(new URL('../../../apps/studio-host/vendor/rhwp-core/rhwp_bg.wasm', import.meta.url)) });
  mkdirSync(output, { recursive: true });
  const doc = HwpDocument.createEmpty();
  try {
    doc.createBlankDocument();
    doc.insertText(0, 0, 0, sampleText);
    const fontId = doc.findOrCreateFontId('Abel');
    doc.applyCharFormat(0, 0, 0, sampleText.length, JSON.stringify({ fontId, fontSize: 2400 }));
    for (const [extension, bytes] of [['hwp', doc.exportHwp()], ['hwpx', doc.exportHwpx()]]) {
      const reopened = new HwpDocument(bytes);
      try {
        if (!JSON.parse(reopened.getDocumentInfo()).fontsUsed.includes('Abel')) throw new Error('fixture font missing');
        writeFileSync(resolve(output, `abel.${extension}`), bytes);
      } finally { reopened.free(); }
    }
  } finally { doc.free(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('생성 대상 디렉터리를 지정하세요');
  generateDocuments(resolve(process.argv[2]));
}
