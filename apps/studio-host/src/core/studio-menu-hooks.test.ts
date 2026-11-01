import { describe, expect, it } from 'vitest';
import { insertStudioMenuItem } from '../../studio-menu-hooks';

const addition = '<div class="md-item" data-cmd="file:new-window">새 창</div>';
describe('upstream command menu anchors', () => {
  it.each(['', ' data-i18n="command.file.newDoc.label"'])('preserves old/new translated label metadata (%s)', attr => {
    const row = `<div class="md-item disabled" data-cmd="file:new-doc"><span class="md-icon icon-new-doc"></span><span class="md-label"${attr}>새로 만들기</span></div>`;
    expect(insertStudioMenuItem(`before${row}after`, 'file:new-doc', addition))
      .toBe(`before${row}\n${addition}after`);
  });
  it('keeps reordered attributes, translated content and shortcuts intact', () => {
    const row = '<div data-cmd="tool:options" class="md-item"><span data-i18n="command.tool.options.label">Settings</span><span class="md-shortcut">F8</span></div>';
    expect(insertStudioMenuItem(row, 'tool:options', addition)).toBe(`${row}\n${addition}`);
  });
  it('rejects missing, duplicate and nested command rows', () => {
    const row = '<div class="md-item" data-cmd="file:new-doc"><span>New</span></div>';
    expect(() => insertStudioMenuItem('', 'file:new-doc', addition)).toThrow('got 0');
    expect(() => insertStudioMenuItem(row + row, 'file:new-doc', addition)).toThrow('got 2');
    expect(() => insertStudioMenuItem(row.replace('<span>', '<div><span>'), 'file:new-doc', addition)).toThrow('nested');
    expect(() => insertStudioMenuItem(row, 'file:new', addition)).toThrow('got 0');
  });
});
