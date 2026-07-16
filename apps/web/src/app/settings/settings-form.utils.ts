import {
    FormArray,
    FormBuilder,
    FormControl,
    Validators,
} from '@angular/forms';
import {
    CoverSize,
    DEFAULT_DASHBOARD_RAILS_SETTINGS,
    DEFAULT_LOCAL_TIMESHIFT_SETTINGS,
    DEFAULT_TMDB_SETTINGS,
    EpgViewMode,
    Language,
    normalizeDashboardRailsSettings,
    normalizeExternalPlayerArguments,
    normalizeLocalTimeshiftSettings,
    Settings,
    StartupBehavior,
    StreamFormat,
    Theme,
    VideoPlayer,
} from '@iptvnator/shared/interfaces';

export const EPG_URL_PATTERN = /^(http|https|file):\/\/[^ "]+$/;

export function createEpgUrlControl(value = ''): FormControl<string | null> {
    return new FormControl(value, [Validators.pattern(EPG_URL_PATTERN)]);
}

export function createSettingsForm(
    formBuilder: FormBuilder,
    supportsEpg: boolean
) {
    return formBuilder.group({
        player: [VideoPlayer.VideoJs],
        ...(supportsEpg
            ? { epgUrl: new FormArray<FormControl<string | null>>([]) }
            : {}),
        streamFormat: StreamFormat.AutoStreamFormat,
        openStreamOnDoubleClick: false,
        language: Language.ENGLISH,
        showCaptions: false,
        showDashboard: true,
        dashboardRails: formBuilder.group({
            hero: DEFAULT_DASHBOARD_RAILS_SETTINGS.hero,
            continueWatching: DEFAULT_DASHBOARD_RAILS_SETTINGS.continueWatching,
            liveFavorites: DEFAULT_DASHBOARD_RAILS_SETTINGS.liveFavorites,
            recentlyWatchedLive:
                DEFAULT_DASHBOARD_RAILS_SETTINGS.recentlyWatchedLive,
            favoriteMoviesAndSeries:
                DEFAULT_DASHBOARD_RAILS_SETTINGS.favoriteMoviesAndSeries,
            recentSources: DEFAULT_DASHBOARD_RAILS_SETTINGS.recentSources,
            xtreamRecentlyAdded:
                DEFAULT_DASHBOARD_RAILS_SETTINGS.xtreamRecentlyAdded,
            tmdbTrending: DEFAULT_DASHBOARD_RAILS_SETTINGS.tmdbTrending,
        }),
        startupBehavior: StartupBehavior.FirstView,
        showExternalPlaybackBar: true,
        theme: Theme.SystemTheme,
        mpvPlayerPath: '',
        mpvPlayerArguments: '',
        mpvReuseInstance: false,
        vlcPlayerPath: '',
        vlcPlayerArguments: '',
        vlcReuseInstance: false,
        remoteControl: false,
        remoteControlPort: [
            8765,
            [
                Validators.required,
                Validators.min(1),
                Validators.max(65535),
                Validators.pattern(/^\d+$/),
            ],
        ],
        recordingFolder: '',
        embeddedMpvFrameCopy: false,
        localTimeshift: formBuilder.group({
            enabled: DEFAULT_LOCAL_TIMESHIFT_SETTINGS.enabled,
            maxDurationMinutes: [
                DEFAULT_LOCAL_TIMESHIFT_SETTINGS.maxDurationMinutes,
                [
                    Validators.required,
                    Validators.min(5),
                    Validators.max(180),
                    Validators.pattern(/^\d+$/),
                ],
            ],
            bufferDirectory: DEFAULT_LOCAL_TIMESHIFT_SETTINGS.bufferDirectory,
        }),
        coverSize: 'medium' as CoverSize,
        ...(supportsEpg
            ? {
                  preferUploadedEpgOverXtream: false,
                  epgViewMode: 'timeline' as EpgViewMode,
              }
            : {}),
        tmdb: formBuilder.group({
            enabled: DEFAULT_TMDB_SETTINGS.enabled,
            apiKey: DEFAULT_TMDB_SETTINGS.apiKey ?? '',
        }),
    });
}

export type SettingsForm = ReturnType<typeof createSettingsForm>;

export function applyEpgUrlsToFormArray(
    epgUrl: FormArray,
    epgUrls: string[] | string
): void {
    const urls = Array.isArray(epgUrls) ? epgUrls : [epgUrls];
    const filteredUrls = urls
        .map((url) => url.trim())
        .filter((url) => url !== '');

    filteredUrls.forEach((url) => {
        epgUrl.push(createEpgUrlControl(url));
    });
}

export function createSettingsFromFormValue(
    settingsForm: SettingsForm,
    currentSettings: Settings
): Settings {
    const value = settingsForm.getRawValue();
    const epgUrl = Array.isArray(value.epgUrl)
        ? value.epgUrl.filter((url): url is string => typeof url === 'string')
        : (currentSettings.epgUrl ?? []);

    return {
        player: value.player ?? VideoPlayer.VideoJs,
        streamFormat: value.streamFormat ?? StreamFormat.AutoStreamFormat,
        openStreamOnDoubleClick: value.openStreamOnDoubleClick ?? false,
        language: value.language ?? Language.ENGLISH,
        showCaptions: value.showCaptions ?? false,
        showDashboard: value.showDashboard ?? true,
        dashboardRails: normalizeDashboardRailsSettings(value.dashboardRails),
        startupBehavior: value.startupBehavior ?? StartupBehavior.FirstView,
        showExternalPlaybackBar: value.showExternalPlaybackBar ?? true,
        theme: value.theme ?? Theme.SystemTheme,
        mpvPlayerPath: normalizeExternalPlayerPath(value.mpvPlayerPath),
        mpvPlayerArguments: normalizeExternalPlayerArguments(
            value.mpvPlayerArguments
        ),
        mpvReuseInstance: value.mpvReuseInstance ?? false,
        vlcPlayerPath: normalizeExternalPlayerPath(value.vlcPlayerPath),
        vlcPlayerArguments: normalizeExternalPlayerArguments(
            value.vlcPlayerArguments
        ),
        vlcReuseInstance: value.vlcReuseInstance ?? false,
        remoteControl: value.remoteControl ?? false,
        remoteControlPort: Number(value.remoteControlPort ?? 8765),
        recordingFolder: value.recordingFolder ?? '',
        embeddedMpvFrameCopy: value.embeddedMpvFrameCopy ?? false,
        localTimeshift: normalizeLocalTimeshiftSettings(value.localTimeshift),
        coverSize: value.coverSize ?? 'medium',
        epgUrl,
        preferUploadedEpgOverXtream:
            value.preferUploadedEpgOverXtream ??
            currentSettings.preferUploadedEpgOverXtream ??
            false,
        epgViewMode:
            value.epgViewMode ?? currentSettings.epgViewMode ?? 'timeline',
        trustedPrivateNetworkEpgUrls:
            currentSettings.trustedPrivateNetworkEpgUrls ?? [],
        trustedInsecureTlsHosts: currentSettings.trustedInsecureTlsHosts ?? [],
        tmdb: {
            enabled: value.tmdb?.enabled ?? DEFAULT_TMDB_SETTINGS.enabled,
            apiKey: value.tmdb?.apiKey?.trim() ?? '',
        },
    };
}

function normalizeExternalPlayerPath(
    playerPath: string | null | undefined
): string {
    return playerPath?.trim() ?? '';
}
