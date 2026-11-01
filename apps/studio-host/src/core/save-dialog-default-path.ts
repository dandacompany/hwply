interface SaveDialogPathApi {
  dirname(path: string): Promise<string>;
  documentDir(): Promise<string>;
  homeDir(): Promise<string>;
  isAbsolute(path: string): Promise<boolean>;
  join(...paths: string[]): Promise<string>;
}

export async function resolveSaveDialogDefaultPath(
  fileName: string,
  sourcePath: string | null,
  injectedPathApi?: SaveDialogPathApi,
): Promise<string> {
  const pathApi = injectedPathApi ?? await import('@tauri-apps/api/path');
  const sourceDirectory = await absoluteSourceDirectory(sourcePath, pathApi);
  const baseDirectory = sourceDirectory ?? await preferredUserDirectory(pathApi);
  const defaultPath = await pathApi.join(baseDirectory, fileName);
  if (!await pathApi.isAbsolute(defaultPath)) {
    throw new Error(`저장 기본 경로가 절대 경로가 아닙니다: ${defaultPath}`);
  }
  return defaultPath;
}

async function absoluteSourceDirectory(
  sourcePath: string | null,
  pathApi: SaveDialogPathApi,
): Promise<string | null> {
  if (!sourcePath) return null;
  try {
    if (!await pathApi.isAbsolute(sourcePath)) return null;
    const directory = await pathApi.dirname(sourcePath);
    return await pathApi.isAbsolute(directory) ? directory : null;
  } catch {
    return null;
  }
}

async function preferredUserDirectory(pathApi: SaveDialogPathApi): Promise<string> {
  for (const resolveDirectory of [pathApi.documentDir, pathApi.homeDir]) {
    try {
      const directory = await resolveDirectory();
      if (await pathApi.isAbsolute(directory)) return directory;
    } catch {
      // Continue to the next user-owned directory.
    }
  }
  throw new Error('저장 기본 경로로 사용할 사용자 폴더를 찾을 수 없습니다');
}
