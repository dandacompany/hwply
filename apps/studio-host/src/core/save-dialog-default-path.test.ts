import { describe, expect, it, vi } from 'vitest';
import { resolveSaveDialogDefaultPath } from './save-dialog-default-path';

describe('save dialog default path', () => {
  it('uses the absolute source directory for an existing document', async () => {
    const pathApi = linuxPathApi();

    await expect(resolveSaveDialogDefaultPath(
      'source.pdf',
      '/home/user/Documents/source.hwp',
      pathApi,
    )).resolves.toBe('/home/user/Documents/source.pdf');

    expect(pathApi.documentDir).not.toHaveBeenCalled();
  });

  it('uses the user document directory instead of resolving a relative source from app cwd', async () => {
    const pathApi = linuxPathApi();

    await expect(resolveSaveDialogDefaultPath(
      'source.hwpx',
      'source.hwp',
      pathApi,
    )).resolves.toBe('/home/user/Documents/source.hwpx');

    expect(pathApi.dirname).not.toHaveBeenCalled();
  });

  it('falls back to the absolute home directory when the document directory is unavailable', async () => {
    const pathApi = linuxPathApi();
    pathApi.documentDir.mockRejectedValue(new Error('XDG documents directory unavailable'));

    await expect(resolveSaveDialogDefaultPath('document.pdf', null, pathApi))
      .resolves.toBe('/home/user/document.pdf');
  });
});

function linuxPathApi() {
  return {
    dirname: vi.fn(async (path: string) => path.slice(0, path.lastIndexOf('/')) || '/'),
    documentDir: vi.fn(async () => '/home/user/Documents'),
    homeDir: vi.fn(async () => '/home/user'),
    isAbsolute: vi.fn(async (path: string) => path.startsWith('/')),
    join: vi.fn(async (...paths: string[]) => paths.join('/').replace(/\/+/g, '/')),
  };
}
