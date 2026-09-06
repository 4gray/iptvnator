import { GITHUB_REPO } from './downloads';

/**
 * Project numbers for the home page hero, resolved once per build from the
 * GitHub API. The hero used to embed shields.io badges for these; rendering
 * them as text keeps the page self-contained and lets the numbers sit in the
 * page's own typography. Any number the API cannot supply (offline build,
 * rate limit, `WEBSITE_SKIP_RELEASE_FETCH=1`) is `null` and simply not shown —
 * a stale or invented figure would be worse than a missing one.
 */
export interface GitHubStats {
  stars: number | null;
  /** Sum of asset download counts over the newest 100 releases. */
  downloads: number | null;
}

const API_ROOT = `https://api.github.com/repos/${GITHUB_REPO}`;
const FETCH_TIMEOUT_MS = 8000;
const EMPTY: GitHubStats = { stars: null, downloads: null };

let statsPromise: Promise<GitHubStats> | undefined;

/** Resolves once per build; every page shares the same answer. */
export function getGitHubStats(): Promise<GitHubStats> {
  statsPromise ??= resolveStats();
  return statsPromise;
}

/** `7013` → `7.0k`, `1_134_000` → `1.1M`. */
export function formatCompactCount(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 10_000) {
    return `${Math.round(value / 1_000)}k`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}k`;
  }
  return String(value);
}

async function resolveStats(): Promise<GitHubStats> {
  if (process.env.WEBSITE_SKIP_RELEASE_FETCH === '1') {
    return EMPTY;
  }
  const [repo, releases] = await Promise.all([fetchJson(API_ROOT), fetchJson(`${API_ROOT}/releases?per_page=100`)]);
  return { stars: readStars(repo), downloads: readDownloads(releases) };
}

async function fetchJson(url: string): Promise<unknown> {
  try {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'iptvnator-website-build',
    };
    const token = process.env.GITHUB_TOKEN;
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!response.ok) {
      console.warn(`[website] GitHub stats lookup failed (HTTP ${response.status}); the hero shows no counts.`);
      return null;
    }
    return await response.json();
  } catch (error) {
    console.warn(`[website] GitHub stats lookup failed (${error instanceof Error ? error.message : String(error)}); the hero shows no counts.`);
    return null;
  }
}

function readStars(payload: unknown): number | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const stars = (payload as Record<string, unknown>).stargazers_count;
  return typeof stars === 'number' && Number.isFinite(stars) ? stars : null;
}

function readDownloads(payload: unknown): number | null {
  if (!Array.isArray(payload) || payload.length === 0) {
    return null;
  }
  let total = 0;
  for (const release of payload) {
    const assets = release && typeof release === 'object' ? (release as Record<string, unknown>).assets : null;
    if (!Array.isArray(assets)) {
      continue;
    }
    for (const asset of assets) {
      const count = asset && typeof asset === 'object' ? (asset as Record<string, unknown>).download_count : null;
      if (typeof count === 'number' && Number.isFinite(count)) {
        total += count;
      }
    }
  }
  return total > 0 ? total : null;
}
