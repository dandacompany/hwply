const API_VERSION = '2026-03-10';

export function createGitHubApiClient(options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = normalizeApiUrl(options.apiUrl ?? 'https://api.github.com');
  return async (path) => {
    const headers = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': API_VERSION,
      'User-Agent': 'hwply-exact-sha-acceptance',
    };
    if (options.token) headers.Authorization = `Bearer ${options.token}`;
    const response = await fetchImpl(`${baseUrl}${path}`, { headers });
    if (!response.ok) throw new Error(`GitHub Actions metadata 요청이 실패했습니다: HTTP ${response.status}`);
    return response.json();
  };
}

function normalizeApiUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('GitHub API URL이 올바르지 않습니다.');
  }
  return url.href.replace(/\/$/, '');
}
