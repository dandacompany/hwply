/** Insert beside one upstream command without depending on translated label markup. */
export function insertStudioMenuItem(html: string, command: string, addition: string): string {
  const escaped = command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const anchor = new RegExp(`<div\\b(?=[^>]*\\bdata-cmd="${escaped}")[^>]*>[^]*?<\\/div>`, 'g');
  const matches = [...html.matchAll(anchor)];
  if (matches.length !== 1) {
    throw new Error(`upstream HTML ${command} marker count must be 1, got ${matches.length}`);
  }
  const row = matches[0][0];
  // Current menu rows contain spans only; reject a changed nested row boundary.
  if (/<div\b/.test(row.slice(1))) throw new Error(`upstream HTML ${command} nested menu row`);
  return html.replace(anchor, () => `${row}\n${addition}`);
}
