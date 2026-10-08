/**
 * Which settings page each top-level form control is edited on. The save
 * bar counts staged changes and the navigation marks their pages with it.
 */
export const SETTINGS_CONTROL_SECTIONS: Readonly<Record<string, string>> = {
    language: 'general',
    theme: 'general',
    coverSize: 'general',
    showCoverTitles: 'general',
    startupBehavior: 'general',
    startupWindowMode: 'general',
    stripCountryPrefix: 'general',
    portalConnectivityGuard: 'general',
    player: 'playback',
    streamFormat: 'playback',
    showCaptions: 'playback',
    webPlayerSharedControls: 'playback',
    playerAmbientMode: 'playback',
    playerUpNextRail: 'playback',
    playerUpNextCard: 'playback',
    detailTrailerBackdrop: 'playback',
    fullscreenChannelPanel: 'playback',
    vodAutoFailover: 'playback',
    openStreamOnDoubleClick: 'playback',
    showExternalPlaybackBar: 'playback',
    embeddedMpvFrameCopy: 'playback',
    embeddedMpvExtraOptions: 'playback',
    embeddedMpvAutoReconnect: 'playback',
    recordingFolder: 'playback',
    mpvPlayerPath: 'playback',
    mpvPlayerArguments: 'playback',
    mpvReuseInstance: 'playback',
    vlcPlayerPath: 'playback',
    vlcPlayerArguments: 'playback',
    vlcReuseInstance: 'playback',
    epgUrl: 'epg',
    epgViewMode: 'epg',
    epgOffsetMinutes: 'epg',
    preferUploadedEpgOverXtream: 'epg',
    showDashboard: 'dashboard',
    dashboardRails: 'dashboard',
    remoteControl: 'remote-control',
    remoteControlPort: 'remote-control',
    tmdb: 'tmdb',
    m3uVodDetails: 'tmdb',
    updateChannel: 'about',
};

/**
 * Controls whose saved value only takes effect after the app restarts,
 * with the label of the row that carries the restart chip.
 */
export const SETTINGS_RESTART_CONTROLS: Readonly<Record<string, string>> = {
    startupWindowMode: 'SETTINGS.STARTUP_WINDOW_MODE',
    embeddedMpvFrameCopy: 'SETTINGS.EMBEDDED_MPV_FRAME_COPY',
};

/**
 * Dotted paths of the leaf values that differ between the staged form value
 * and the saved one. Nested groups (dashboard rails, TMDB) count per leaf,
 * so "3 unsaved changes" means three switches, not one group.
 */
export function diffSettingsValues(
    current: unknown,
    saved: unknown,
    path = ''
): string[] {
    if (isPlainObject(current) && isPlainObject(saved)) {
        const keys = new Set([...Object.keys(current), ...Object.keys(saved)]);
        const changed: string[] = [];
        for (const key of keys) {
            changed.push(
                ...diffSettingsValues(
                    current[key],
                    saved[key],
                    path ? `${path}.${key}` : key
                )
            );
        }
        return changed;
    }
    return JSON.stringify(current ?? null) === JSON.stringify(saved ?? null)
        ? []
        : [path];
}

/** Section page of a changed path, `null` for an unmapped control. */
export function sectionOfSettingsPath(path: string): string | null {
    return SETTINGS_CONTROL_SECTIONS[path.split('.')[0]] ?? null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return (
        typeof value === 'object' && value !== null && !Array.isArray(value)
    );
}
