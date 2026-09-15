import {
    AppUpdateChannel,
    appUpdateRepository,
    NIGHTLY_PRERELEASE_TAG,
} from '@iptvnator/shared/interfaces';

export interface AppUpdateGitHubFeedOptions {
    provider: 'github';
    owner: string;
    repo: string;
}

/**
 * The slice of electron-updater's `AppUpdater` the channel switch touches.
 * Kept structural so the service spec can drive it with a fake.
 */
export interface AppUpdateFeedTarget {
    allowPrerelease: boolean;
    allowDowngrade: boolean;
    channel: string | null;
    setFeedURL(options: AppUpdateGitHubFeedOptions): void;
}

/**
 * Points electron-updater at the repository behind `channel` right before a
 * check. Applied on every check rather than once, because the channel can
 * change while the app runs.
 *
 * Two electron-updater quirks decide the shape of this function:
 *
 * - The `channel` setter throws once a string channel is replaced by `null`,
 *   so stable is written as the explicit `latest` (the default channel
 *   file name) instead of being cleared.
 * - Assigning `channel` silently flips `allowDowngrade` to `true`, and the
 *   constructor turns `allowPrerelease` on for any prerelease build. Both
 *   are reset afterwards: a nightly build on the stable channel must wait
 *   for the next stable release rather than downgrade onto one that may
 *   not understand its database schema.
 */
export function applyAppUpdateChannel(
    updater: AppUpdateFeedTarget,
    channel: AppUpdateChannel
): void {
    updater.setFeedURL({ provider: 'github', ...appUpdateRepository(channel) });
    updater.allowPrerelease = channel === 'nightly';
    updater.channel = channel === 'nightly' ? NIGHTLY_PRERELEASE_TAG : 'latest';
    updater.allowDowngrade = false;
}
