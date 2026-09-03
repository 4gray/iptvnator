import type { DownloadPlatform } from './platforms';

/**
 * Latest-release resolution for the download pages.
 *
 * At build time the pages ask the GitHub Releases API for the latest
 * *published* release so that every direct link points at an asset that
 * exists, and so file sizes and the publish date can be shown. When the API
 * is unreachable (offline build, rate limit, `WEBSITE_SKIP_RELEASE_FETCH=1`)
 * the pages fall back to the repository version from the root `package.json`
 * — injected as `__IPTVNATOR_VERSION__` by `astro.config.mjs`, since a
 * relative import of the root manifest violates the Nx module boundaries —
 * and the known asset naming pattern from `electron-builder.json`.
 */

const FALLBACK_VERSION = __IPTVNATOR_VERSION__;

export const GITHUB_REPO = '4gray/iptvnator';
export const REPO_URL = `https://github.com/${GITHUB_REPO}`;
export const RELEASES_URL = `${REPO_URL}/releases`;
export const LATEST_RELEASE_URL = `${RELEASES_URL}/latest`;

const LATEST_RELEASE_API_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
const FETCH_TIMEOUT_MS = 8000;
const VERSION_TAG_PATTERN = /^v(\d+\.\d+\.\d+)$/;

export interface ReleaseAsset {
  name: string;
  url: string;
  /** Bytes, or `null` when the size is unknown (fallback mode). */
  size: number | null;
}

export interface ResolvedRelease {
  version: string;
  tag: string;
  /** Release page on GitHub. */
  url: string;
  publishedAt: Date | null;
  assets: ReleaseAsset[];
  /** Where the data came from; the fallback cannot promise that the files exist yet. */
  source: 'github-api' | 'package-json';
}

export interface DownloadOption {
  id: string;
  platform: DownloadPlatform;
  /** Short human label, e.g. "Apple Silicon". */
  label: string;
  /** One-line qualifier, e.g. "M1–M4 · .dmg". */
  detail: string;
  /** Matches the asset file name inside the release. */
  matcher: RegExp;
  /** Expected file name when the asset list is unavailable. */
  fallbackName: (version: string) => string;
  /** Preferred choice for the platform; rendered as the primary button. */
  recommended?: boolean;
}

export interface ResolvedDownload extends Omit<DownloadOption, 'matcher' | 'fallbackName'> {
  fileName: string;
  url: string;
  size: number | null;
}

export const DOWNLOAD_OPTIONS: Record<DownloadPlatform, DownloadOption[]> = {
  windows: [
    {
      id: 'windows-x64-setup',
      platform: 'windows',
      label: 'Download for Windows',
      detail: 'Windows 10 / 11 · 64-bit installer',
      matcher: /-windows-x64-setup\.exe$/,
      fallbackName: (v) => `iptvnator-${v}-windows-x64-setup.exe`,
      recommended: true,
    },
  ],
  macos: [
    {
      id: 'mac-arm64-dmg',
      platform: 'macos',
      label: 'Apple Silicon',
      detail: 'M1 – M4 Macs · .dmg',
      matcher: /-mac-arm64\.dmg$/,
      fallbackName: (v) => `iptvnator-${v}-mac-arm64.dmg`,
      recommended: true,
    },
    {
      id: 'mac-x64-dmg',
      platform: 'macos',
      label: 'Intel',
      detail: 'Intel Macs · .dmg',
      matcher: /-mac-x64\.dmg$/,
      fallbackName: (v) => `iptvnator-${v}-mac-x64.dmg`,
    },
  ],
  linux: [
    {
      id: 'linux-x86_64-appimage',
      platform: 'linux',
      label: 'AppImage',
      detail: 'Any distribution · x86_64',
      matcher: /-linux-x86_64\.AppImage$/,
      fallbackName: (v) => `iptvnator-${v}-linux-x86_64.AppImage`,
      recommended: true,
    },
    {
      id: 'linux-amd64-deb',
      platform: 'linux',
      label: 'Debian / Ubuntu',
      detail: '.deb · amd64',
      matcher: /-linux-amd64\.deb$/,
      fallbackName: (v) => `iptvnator-${v}-linux-amd64.deb`,
    },
    {
      id: 'linux-x86_64-rpm',
      platform: 'linux',
      label: 'Fedora / openSUSE',
      detail: '.rpm · x86_64',
      matcher: /-linux-x86_64\.rpm$/,
      fallbackName: (v) => `iptvnator-${v}-linux-x86_64.rpm`,
    },
    {
      id: 'linux-x64-pacman',
      platform: 'linux',
      label: 'Arch / Manjaro',
      detail: '.pacman · x64',
      matcher: /-linux-x64\.pacman$/,
      fallbackName: (v) => `iptvnator-${v}-linux-x64.pacman`,
    },
    {
      id: 'linux-x86_64-flatpak',
      platform: 'linux',
      label: 'Flatpak bundle',
      detail: '.flatpak · x86_64',
      matcher: /-linux-x86_64\.flatpak$/,
      fallbackName: (v) => `iptvnator-${v}-linux-x86_64.flatpak`,
    },
    {
      id: 'linux-amd64-snap',
      platform: 'linux',
      label: 'Snap',
      detail: '.snap · amd64',
      matcher: /-linux-amd64\.snap$/,
      fallbackName: (v) => `iptvnator-${v}-linux-amd64.snap`,
    },
    {
      id: 'linux-arm64-appimage',
      platform: 'linux',
      label: 'AppImage',
      detail: 'arm64 (aarch64)',
      matcher: /-linux-arm64\.AppImage$/,
      fallbackName: (v) => `iptvnator-${v}-linux-arm64.AppImage`,
    },
    {
      id: 'linux-arm64-deb',
      platform: 'linux',
      label: 'Debian / Ubuntu',
      detail: '.deb · arm64',
      matcher: /-linux-arm64\.deb$/,
      fallbackName: (v) => `iptvnator-${v}-linux-arm64.deb`,
    },
    {
      id: 'linux-armv7l-appimage',
      platform: 'linux',
      label: 'AppImage',
      detail: 'armv7l (32-bit ARM)',
      matcher: /-linux-armv7l\.AppImage$/,
      fallbackName: (v) => `iptvnator-${v}-linux-armv7l.AppImage`,
    },
    {
      id: 'linux-armv7l-deb',
      platform: 'linux',
      label: 'Debian / Ubuntu',
      detail: '.deb · armv7l',
      matcher: /-linux-armv7l\.deb$/,
      fallbackName: (v) => `iptvnator-${v}-linux-armv7l.deb`,
    },
    {
      id: 'linux-armhf-snap',
      platform: 'linux',
      label: 'Snap',
      detail: '.snap · armhf',
      matcher: /-linux-armhf\.snap$/,
      fallbackName: (v) => `iptvnator-${v}-linux-armhf.snap`,
    },
  ],
};

let releasePromise: Promise<ResolvedRelease> | undefined;

/** Resolves once per build; every page shares the same answer. */
export function getLatestRelease(): Promise<ResolvedRelease> {
  releasePromise ??= resolveLatestRelease();
  return releasePromise;
}

export function assetUrl(tag: string, fileName: string): string {
  return `${RELEASES_URL}/download/${tag}/${fileName}`;
}

/**
 * Downloads for one platform, in the declared order. When the release came
 * from the API, options whose asset is missing are dropped so a page never
 * links to a 404; the fallback assumes the full asset set.
 */
export function resolveDownloads(release: ResolvedRelease, platform: DownloadPlatform): ResolvedDownload[] {
  return DOWNLOAD_OPTIONS[platform].flatMap((option) => {
    const asset = release.assets.find((candidate) => option.matcher.test(candidate.name));
    if (!asset) {
      return [];
    }
    const { matcher: _matcher, fallbackName: _fallbackName, ...rest } = option;
    return [{ ...rest, fileName: asset.name, url: asset.url, size: asset.size }];
  });
}

export function formatAssetSize(bytes: number | null): string | null {
  if (bytes === null || !Number.isFinite(bytes) || bytes <= 0) {
    return null;
  }
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

export function formatReleaseDate(date: Date | null): string | null {
  if (!date) {
    return null;
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

async function resolveLatestRelease(): Promise<ResolvedRelease> {
  const published = await fetchPublishedRelease();
  return published ?? fallbackRelease();
}

async function fetchPublishedRelease(): Promise<ResolvedRelease | null> {
  if (process.env.WEBSITE_SKIP_RELEASE_FETCH === '1') {
    return null;
  }
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
    const response = await fetch(LATEST_RELEASE_API_URL, {
      headers,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      warnFallback(`GitHub API answered HTTP ${response.status}`);
      return null;
    }
    const release = normalizeRelease(await response.json());
    if (!release) {
      warnFallback('GitHub API response had an unexpected shape');
    }
    return release;
  } catch (error) {
    warnFallback(error instanceof Error ? error.message : String(error));
    return null;
  }
}

function normalizeRelease(payload: unknown): ResolvedRelease | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const record = payload as Record<string, unknown>;
  const tag = typeof record.tag_name === 'string' ? record.tag_name : '';
  const versionMatch = VERSION_TAG_PATTERN.exec(tag);
  if (!versionMatch) {
    return null;
  }
  const assets = Array.isArray(record.assets) ? record.assets.flatMap(normalizeAsset) : [];
  if (assets.length === 0) {
    return null;
  }
  const publishedAt = typeof record.published_at === 'string' ? new Date(record.published_at) : null;
  return {
    version: versionMatch[1],
    tag,
    url: typeof record.html_url === 'string' ? record.html_url : `${RELEASES_URL}/tag/${tag}`,
    publishedAt: publishedAt && !Number.isNaN(publishedAt.getTime()) ? publishedAt : null,
    assets,
    source: 'github-api',
  };
}

function normalizeAsset(value: unknown): ReleaseAsset[] {
  if (!value || typeof value !== 'object') {
    return [];
  }
  const record = value as Record<string, unknown>;
  const name = typeof record.name === 'string' ? record.name : '';
  const url = typeof record.browser_download_url === 'string' ? record.browser_download_url : '';
  if (!name || !url.startsWith(`${REPO_URL}/`)) {
    return [];
  }
  const size = typeof record.size === 'number' && Number.isFinite(record.size) ? record.size : null;
  return [{ name, url, size }];
}

function fallbackRelease(): ResolvedRelease {
  const version = FALLBACK_VERSION;
  const tag = `v${version}`;
  const assets = Object.values(DOWNLOAD_OPTIONS)
    .flat()
    .map((option) => {
      const name = option.fallbackName(version);
      return { name, url: assetUrl(tag, name), size: null };
    });
  return {
    version,
    tag,
    url: `${RELEASES_URL}/tag/${tag}`,
    publishedAt: null,
    assets,
    source: 'package-json',
  };
}

function warnFallback(reason: string): void {
  console.warn(`[website] Latest release lookup failed (${reason}); using package.json version ${FALLBACK_VERSION}.`);
}
