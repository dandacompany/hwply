import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { browser, $, $$ } from '@wdio/globals';
import { readStudioStatus } from '../support/document-ux.ts';
import { readGuiHarnessInputs } from '../wdio.shared.conf.ts';

const inputs = readGuiHarnessInputs();
export const output = join(inputs.outputDir, 'local-fonts');
export const canvas = '#scroll-content > canvas[data-rhwp-rendered-zoom]';

// Public embed RPC already shipped in the exact installer; no development globals.
export async function rpc(method: string): Promise<unknown> {
  const response = await browser.executeAsync((method, done) => {
    const id = `font-acceptance-${Date.now()}-${Math.random()}`;
    const timer = setTimeout(() => { window.removeEventListener('message', listener); done({ error: 'RPC timeout' }); }, 15000);
    function listener(event: MessageEvent) {
      if (event.source !== window || event.data?.type !== 'rhwp-response' || event.data.id !== id) return;
      clearTimeout(timer); window.removeEventListener('message', listener); done(event.data);
    }
    window.addEventListener('message', listener);
    window.postMessage({ type: 'rhwp-request', id, method, params: { page: 0 } }, '*');
  }, method) as { error?: string; result?: unknown };
  if (response.error) throw new Error(response.error);
  return response.result;
}

export async function menu(command: string, title: string): Promise<void> {
  const titles = await $$('#menu-bar .menu-title');
  for (const element of titles) {
    if (await element.getText() === title) { await element.click(); break; }
  }
  const item = await $(`.md-item[data-cmd="${command}"]`);
  await item.waitForDisplayed();
  await item.click();
}

export async function settings(): Promise<string> {
  await menu('tool:local-font-settings', '도구');
  await $('.modal-overlay .dialog-body').waitForDisplayed();
  return browser.execute(() => document.querySelector('.modal-overlay .dialog-body')?.textContent ?? '');
}

export async function choose(choice: 'enabled' | 'disabled' | 'refresh'): Promise<void> {
  await browser.execute(() => {
    const state = window as Window & { __fontAcceptanceUpdated?: boolean };
    state.__fontAcceptanceUpdated = false;
    const observer = new MutationObserver(() => {
      state.__fontAcceptanceUpdated = true;
      observer.disconnect();
    });
    observer.observe(document.getElementById('sb-message')!, { childList: true, subtree: true, characterData: true });
  });
  if (choice === 'refresh') {
    const buttons = await $$('.modal-overlay .dialog-body button');
    for (const button of buttons) {
      if (await button.getText() === '다시 감지') { await button.click(); break; }
    }
  } else {
    await $(`input[name="hwply-local-font-choice"][value="${choice}"]`).click();
    await $('.modal-overlay .dialog-btn-primary').click();
  }
  await $('.modal-overlay').waitForExist({ reverse: true });
  await browser.waitUntil(async () => {
    if (!await browser.execute(() => (window as Window & { __fontAcceptanceUpdated?: boolean }).__fontAcceptanceUpdated === true)) return false;
    const status = await readStudioStatus(browser);
    return choice === 'disabled' ? status.includes('직접 공급을 사용하지 않습니다')
      : status.includes('감지 목록');
  }, { timeout: inputs.timeoutMs, timeoutMsg: `font setting ${choice} did not finish` });
}

export async function snapshot(name: string) {
  await $(canvas).waitForDisplayed();
  await browser.execute(async () => { await document.fonts.ready; });
  let previous = '';
  let stable = 0;
  await browser.waitUntil(async () => {
    const current = await $(canvas).getAttribute('width') + ':' + await pagePixels();
    stable = current === previous ? stable + 1 : 0;
    previous = current;
    return stable >= 2;
  }, { timeout: inputs.timeoutMs, interval: 500, timeoutMsg: 'document pixels did not settle' });
  const pixels = await pagePixels();
  const diagnostics = await rpc('getRendererDiagnostics') as { effectiveBackend: string; backendFallbackReason: string | null;
    page: { canvaskit: { localTypefaceCount: number; unregisteredFontFallbacks: number } | null } };
  const pageData = await browser.execute((selector) => document.querySelector<HTMLCanvasElement>(selector)!.toDataURL('image/png'), canvas);
  await writeFile(join(output, `${name}-page.png`), Buffer.from(pageData.split(',')[1], 'base64'));
  await browser.saveScreenshot(join(output, `${name}-window.png`));
  const fonts = await browser.execute(() => {
    const faces: { family: string; status: string }[] = [];
    document.fonts.forEach(face => { if (face.family.includes('Abel')) faces.push({ family: face.family, status: face.status }); });
    const context = document.createElement('canvas').getContext('2d')!;
    context.font = '32px Abel';
    return { faces, width: context.measureText('HWPLY LOCAL FONT 0123456789 iii WWW Abel').width };
  });
  const result = { name, title: await browser.getTitle(), pixelHash: pixels, diagnostics, fonts };
  await writeFile(join(output, `${name}.json`), JSON.stringify(result, null, 2));
  return result;
}

async function pagePixels(): Promise<string> {
  const data = await browser.execute((selector) => {
    const page = document.querySelector<HTMLCanvasElement>(selector)!;
    // Rendered page only: excludes blinking caret, menus, status, and pointer hover.
    return page.toDataURL('image/png');
  }, canvas);
  return createHash('sha256').update(data).digest('hex');
}
