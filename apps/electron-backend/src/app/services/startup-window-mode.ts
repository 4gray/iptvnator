import {
    normalizeStartupWindowMode,
    StartupWindowMode,
} from '@iptvnator/shared/interfaces';

/**
 * Command-line switch that forces one fullscreen launch:
 * `iptvnator --fullscreen`. Meant for HTPC autostart scripts. It is read
 * through Electron's parsed command line, so it can sit anywhere in argv;
 * the playlist-path extractor already skips every `-`-prefixed argument.
 */
export const FULLSCREEN_LAUNCH_SWITCH = 'fullscreen';

/**
 * Decides how the main window is presented at launch.
 *
 * The switch wins over the stored setting but is never persisted — the next
 * launch without it falls back to whatever Settings say. The stored value is
 * whatever the SETTINGS_UPDATE mirror wrote (or nothing on a fresh profile)
 * and is normalized again here, so a hand-edited config file cannot pass an
 * unknown mode into the window options.
 */
export function resolveStartupWindowMode(input: {
    cliHasFullscreenSwitch: boolean;
    storedMode: unknown;
}): StartupWindowMode {
    if (input.cliHasFullscreenSwitch) {
        return 'fullscreen';
    }

    return normalizeStartupWindowMode(input.storedMode);
}
