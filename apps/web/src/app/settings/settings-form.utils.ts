import {
    AbstractControl,
    FormArray,
    FormBuilder,
    FormControl,
    ValidationErrors,
    Validators,
} from '@angular/forms';
import {
    CoverSize,
    DEFAULT_DASHBOARD_RAILS_SETTINGS,
    DEFAULT_TMDB_SETTINGS,
    EpgViewMode,
    Language,
    normalizeDashboardRailsSettings,
    normalizeEmbeddedMpvExtraOptions,
    normalizeExternalPlayerArguments,
    normalizeEpgOffsetMinutes,
    normalizeStartupWindowMode,
    Settings,
    StartupBehavior,
    StartupWindowMode,
    StreamFormat,
    Theme,
    validateEmbeddedMpvExtraOptions,
    VideoPlayer,
} from '@iptvnator/shared/interfaces';

export const EPG_URL_PATTERN = /^(http|https|file):\/\/[^ "]+$/;

/**
 * Rejects malformed lines and the option keys the embed depends on, so a
 * value that the main process would have to drop never gets saved.
 */
export function embeddedMpvExtraOptionsValidator(
    control: AbstractControl
): ValidationErrors | null {
    // Only the embedded MPV player consumes these lines. While another player
    // is selected the field is hidden, and a stale error must not keep the
    // whole settings form unsaveable.
    if (control.parent?.get('player')?.value !== VideoPlayer.EmbeddedMpv) {
        return null;
    }
    return validateEmbeddedMpvExtraOptions(control.value);
}

export function createEpgUrlControl(value = ''): FormControl<string | null> {
    return new FormControl(value, [Validators.pattern(EPG_URL_PATTERN)]);
}

export function createSettingsForm(
    formBuilder: FormBuilder,
    supportsEpg: boolean
) {
    const form = formBuilder.group({
        player: [VideoPlayer.VideoJs],
        webPlayerSharedControls: true,
        playerAmbientMode: false,
        playerUpNextRail: true,
        vodAutoFailover: false,
        m3uVodDetails: true,
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
            tmdbRecommendations:
                DEFAULT_DASHBOARD_RAILS_SETTINGS.tmdbRecommendations,
        }),
        startupBehavior: StartupBehavior.FirstView,
        startupWindowMode: 'normal' as StartupWindowMode,
        showExternalPlaybackBar: true,
        stripCountryPrefix: false,
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
        embeddedMpvExtraOptions: ['', [embeddedMpvExtraOptionsValidator]],
        embeddedMpvAutoReconnect: true,
        portalConnectivityGuard: true,
        coverSize: 'medium' as CoverSize,
        ...(supportsEpg
            ? {
                  preferUploadedEpgOverXtream: false,
                  epgViewMode: 'timeline' as EpgViewMode,
                  epgOffsetMinutes: new FormControl<number>(0, [
                      Validators.required,
                      Validators.min(-720),
                      Validators.max(720),
                      Validators.pattern(/^-?\d+$/),
                  ]),
              }
            : {}),
        tmdb: formBuilder.group({
            enabled: DEFAULT_TMDB_SETTINGS.enabled,
            apiKey: DEFAULT_TMDB_SETTINGS.apiKey ?? '',
        }),
    });
    // The extra-options validator reads the sibling `player` control, which
    // Angular does not track as a dependency: re-validate on player changes
    // so a hidden field's stale error cannot block Save.
    form.get('player')?.valueChanges.subscribe(() =>
        form.get('embeddedMpvExtraOptions')?.updateValueAndValidity()
    );
    return form;
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
        webPlayerSharedControls: value.webPlayerSharedControls ?? true,
        playerAmbientMode: value.playerAmbientMode ?? false,
        playerUpNextRail: value.playerUpNextRail ?? true,
        vodAutoFailover: value.vodAutoFailover ?? false,
        m3uVodDetails: value.m3uVodDetails ?? true,
        streamFormat: value.streamFormat ?? StreamFormat.AutoStreamFormat,
        openStreamOnDoubleClick: value.openStreamOnDoubleClick ?? false,
        language: value.language ?? Language.ENGLISH,
        showCaptions: value.showCaptions ?? false,
        showDashboard: value.showDashboard ?? true,
        dashboardRails: normalizeDashboardRailsSettings(value.dashboardRails),
        startupBehavior: value.startupBehavior ?? StartupBehavior.FirstView,
        startupWindowMode: normalizeStartupWindowMode(value.startupWindowMode),
        showExternalPlaybackBar: value.showExternalPlaybackBar ?? true,
        stripCountryPrefix: value.stripCountryPrefix ?? false,
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
        embeddedMpvExtraOptions: normalizeEmbeddedMpvExtraOptions(
            value.embeddedMpvExtraOptions
        ),
        embeddedMpvAutoReconnect: value.embeddedMpvAutoReconnect ?? true,
        portalConnectivityGuard: value.portalConnectivityGuard !== false,
        coverSize: value.coverSize ?? 'medium',
        epgUrl,
        preferUploadedEpgOverXtream:
            value.preferUploadedEpgOverXtream ??
            currentSettings.preferUploadedEpgOverXtream ??
            false,
        epgViewMode:
            value.epgViewMode ?? currentSettings.epgViewMode ?? 'timeline',
        epgOffsetMinutes: normalizeEpgOffsetMinutes(
            value.epgOffsetMinutes ?? currentSettings.epgOffsetMinutes
        ),
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
