/**
 * Desktop update channel. Electron only.
 *
 * `stable` follows the tagged releases of `4gray/iptvnator`; `nightly`
 * follows the prereleases that every master merge publishes to
 * `4gray/iptvnator-nightly`. The value is persisted with the other settings
 * in the renderer and mirrored into the main-process config by the
 * `SETTINGS_UPDATE` handler, because the startup update check runs before
 * any renderer exists to ask.
 *
 * Channel switches are forward-only on purpose: a nightly build stays
 * installed until the next stable version is newer than it. A downgrade
 * could land on a release that does not understand the database schema a
 * nightly migration already applied.
 */
export type AppUpdateChannel = 'stable' | 'nightly';

export const APP_UPDATE_CHANNELS: readonly AppUpdateChannel[] = [
    'stable',
    'nightly',
];

export const DEFAULT_APP_UPDATE_CHANNEL: AppUpdateChannel = 'stable';

/**
 * Prerelease identifier every nightly version carries
 * (`0.23.1-nightly.20260915.1234`). The nightly build sets the same name as
 * electron-builder's publish channel, which names the updater metadata
 * (`nightly-mac.yml`, `nightly.yml`, `nightly-linux.yml`), and
 * electron-updater matches release tags on the same identifier.
 */
export const NIGHTLY_PRERELEASE_TAG = 'nightly';

/** Collapses anything that is not a known channel to `stable`. */
export function normalizeAppUpdateChannel(value: unknown): AppUpdateChannel {
    return APP_UPDATE_CHANNELS.includes(value as AppUpdateChannel)
        ? (value as AppUpdateChannel)
        : DEFAULT_APP_UPDATE_CHANNEL;
}

interface AppUpdateRepository {
    owner: string;
    repo: string;
}

const APP_UPDATE_REPOSITORIES: Record<AppUpdateChannel, AppUpdateRepository> = {
    stable: { owner: '4gray', repo: 'iptvnator' },
    nightly: { owner: '4gray', repo: 'iptvnator-nightly' },
};

export function appUpdateRepository(
    channel: AppUpdateChannel
): AppUpdateRepository {
    return { ...APP_UPDATE_REPOSITORIES[channel] };
}

/**
 * Page a user can open to install by hand. `/releases/latest` never resolves
 * to a prerelease, and the nightly repository holds nothing else, so that
 * channel links to the release list instead.
 */
export function appUpdateReleasesPageUrl(channel: AppUpdateChannel): string {
    const { owner, repo } = APP_UPDATE_REPOSITORIES[channel];
    const base = `https://github.com/${owner}/${repo}/releases`;

    return channel === 'stable' ? `${base}/latest` : base;
}

/** The channel's release list; the page to browse when one version is missing. */
export function appUpdateReleasesListUrl(channel: AppUpdateChannel): string {
    const { owner, repo } = APP_UPDATE_REPOSITORIES[channel];

    return `https://github.com/${owner}/${repo}/releases`;
}

export function appUpdateReleasesApiUrl(channel: AppUpdateChannel): string {
    const { owner, repo } = APP_UPDATE_REPOSITORIES[channel];

    return `https://api.github.com/repos/${owner}/${repo}/releases`;
}

const VERSION_PATTERN =
    /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

interface ParsedAppVersion {
    core: [number, number, number];
    prerelease: string[];
}

export function parseAppVersion(
    value: string | null | undefined
): ParsedAppVersion | null {
    const match = (value ?? '').trim().match(VERSION_PATTERN);

    if (!match) {
        return null;
    }

    return {
        core: [Number(match[1]), Number(match[2]), Number(match[3])],
        prerelease: match[4] ? match[4].split('.') : [],
    };
}

/** The channel a build belongs to, read from its version string. */
export function appVersionChannel(
    version: string | null | undefined
): AppUpdateChannel {
    return parseAppVersion(version)?.prerelease[0] === NIGHTLY_PRERELEASE_TAG
        ? 'nightly'
        : 'stable';
}

function compareIdentifiers(left: string, right: string): number {
    const leftNumeric = /^\d+$/.test(left);
    const rightNumeric = /^\d+$/.test(right);

    if (leftNumeric && rightNumeric) {
        return Math.sign(Number(left) - Number(right));
    }

    // Semver: numeric identifiers always have lower precedence.
    if (leftNumeric !== rightNumeric) {
        return leftNumeric ? -1 : 1;
    }

    return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Semver precedence for the version strings the updater sees: core
 * numbers first, then a release outranks its own prereleases, then the
 * prerelease identifiers left to right. Unparseable input compares as
 * equal so a junk version can never look like an update.
 */
export function compareAppVersions(left: string, right: string): number {
    const parsedLeft = parseAppVersion(left);
    const parsedRight = parseAppVersion(right);

    if (!parsedLeft || !parsedRight) {
        return 0;
    }

    for (let index = 0; index < 3; index += 1) {
        const difference = parsedLeft.core[index] - parsedRight.core[index];

        if (difference !== 0) {
            return Math.sign(difference);
        }
    }

    if (parsedLeft.prerelease.length === 0) {
        return parsedRight.prerelease.length === 0 ? 0 : 1;
    }

    if (parsedRight.prerelease.length === 0) {
        return -1;
    }

    const length = Math.max(
        parsedLeft.prerelease.length,
        parsedRight.prerelease.length
    );

    for (let index = 0; index < length; index += 1) {
        const leftIdentifier = parsedLeft.prerelease[index];
        const rightIdentifier = parsedRight.prerelease[index];

        if (leftIdentifier === undefined) {
            return -1;
        }

        if (rightIdentifier === undefined) {
            return 1;
        }

        const difference = compareIdentifiers(leftIdentifier, rightIdentifier);

        if (difference !== 0) {
            return difference;
        }
    }

    return 0;
}

/**
 * Marker the main process puts into the release-notes rejection when a
 * version has no published GitHub release. `ipcRenderer.invoke` strips every
 * custom property off a rejection and wraps the message, so the renderer can
 * only recognise the case by this text.
 */
export const APP_UPDATE_RELEASE_NOTES_NOT_FOUND_MARKER =
    'Release notes were not found for';

export function buildAppUpdateReleaseNotesNotFoundMessage(
    version: string | undefined
): string {
    return `${APP_UPDATE_RELEASE_NOTES_NOT_FOUND_MARKER} ${version ?? 'latest release'}`;
}

export function isAppUpdateReleaseNotesNotFoundMessage(
    message: string | null | undefined
): boolean {
    return Boolean(
        message?.includes(APP_UPDATE_RELEASE_NOTES_NOT_FOUND_MARKER)
    );
}
