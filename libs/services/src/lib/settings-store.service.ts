import { computed, inject } from '@angular/core';
import {
    patchState,
    signalStore,
    withComputed,
    withHooks,
    withMethods,
    withState,
} from '@ngrx/signals';
import { StorageMap } from '@ngx-pwa/local-storage';
import { firstValueFrom } from 'rxjs';
import {
    DEFAULT_DASHBOARD_RAILS_SETTINGS,
    DEFAULT_LOCAL_TIMESHIFT_SETTINGS,
    DEFAULT_TMDB_SETTINGS,
    ElectronBridgeTrustOptions,
    EpgViewMode,
    Language,
    Settings,
    StartupBehavior,
    STORE_KEY,
    StreamFormat,
    Theme,
    VideoPlayer,
    normalizeDashboardRailsSettings,
    normalizeLocalTimeshiftSettings,
} from '@iptvnator/shared/interfaces';

const DEFAULT_SETTINGS: Settings = {
    player: VideoPlayer.VideoJs,
    webPlayerSharedControls: false,
    streamFormat: StreamFormat.AutoStreamFormat,
    openStreamOnDoubleClick: false,
    language: Language.ENGLISH,
    showCaptions: false,
    showDashboard: true,
    startupBehavior: StartupBehavior.FirstView,
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
    remoteControlPort: 8765,
    epgUrl: [],
    downloadFolder: '',
    recordingFolder: '',
    embeddedMpvFrameCopy: false,
    localTimeshift: DEFAULT_LOCAL_TIMESHIFT_SETTINGS,
    coverSize: 'medium',
    epgViewMode: 'timeline',
    dashboardRails: DEFAULT_DASHBOARD_RAILS_SETTINGS,
    preferUploadedEpgOverXtream: false,
    trustedPrivateNetworkEpgUrls: [],
    trustedInsecureTlsHosts: [],
    tmdb: DEFAULT_TMDB_SETTINGS,
};

let embeddedMpvPrepareScheduled = false;

function scheduleEmbeddedMpvPrepare(): void {
    if (
        embeddedMpvPrepareScheduled ||
        typeof window === 'undefined' ||
        !window.electron?.prepareEmbeddedMpv
    ) {
        return;
    }

    embeddedMpvPrepareScheduled = true;
    const prepare = () => {
        void window.electron
            .prepareEmbeddedMpv?.()
            .then((support) => {
                if (!support?.supported) {
                    embeddedMpvPrepareScheduled = false;
                }
            })
            .catch((error) => {
                embeddedMpvPrepareScheduled = false;
                console.warn('Failed to prepare embedded MPV.', error);
            });
    };
    const idleWindow = window as typeof window & {
        requestIdleCallback?: (
            callback: IdleRequestCallback,
            options?: IdleRequestOptions
        ) => number;
    };

    if (idleWindow.requestIdleCallback) {
        idleWindow.requestIdleCallback(prepare, { timeout: 5000 });
    } else {
        window.setTimeout(prepare, 2000);
    }
}

export const SettingsStore = signalStore(
    { providedIn: 'root' },
    withState<Settings>(DEFAULT_SETTINGS),
    withComputed((store) => ({
        /**
         * Live EPG panel layout with the `'timeline'` default applied — the
         * single source of truth for the four live hosts, so the fallback is
         * not duplicated per call-site.
         */
        resolvedEpgViewMode: computed<EpgViewMode>(
            () => store.epgViewMode?.() ?? 'timeline'
        ),
    })),
    withMethods((store, storage = inject(StorageMap)) => {
        let settingsLoadPromise: Promise<void> | undefined;

        return {
            loadSettings() {
                if (settingsLoadPromise) {
                    return settingsLoadPromise;
                }

                settingsLoadPromise = (async () => {
                    const stored = await firstValueFrom(
                        storage.get(STORE_KEY.Settings)
                    );
                    if (stored) {
                        const storedSettings = stored as Partial<Settings>;
                        patchState(store, {
                            ...DEFAULT_SETTINGS,
                            ...storedSettings,
                            webPlayerSharedControls:
                                storedSettings.webPlayerSharedControls === true,
                            dashboardRails: normalizeDashboardRailsSettings(
                                storedSettings.dashboardRails
                            ),
                            localTimeshift: normalizeLocalTimeshiftSettings(
                                storedSettings.localTimeshift
                            ),
                        });
                        void this.sanitizeEmbeddedMpvSelection().catch(
                            (error) => {
                                console.warn(
                                    'Failed to verify embedded MPV support while loading settings.',
                                    error
                                );
                            }
                        );
                    }
                })().catch((error) => {
                    settingsLoadPromise = undefined;
                    console.error('Failed to load settings:', error);
                    // Keep default settings if loading fails
                });

                return settingsLoadPromise;
            },

            async updateSettings(settings: Partial<Settings>) {
                patchState(store, {
                    ...settings,
                    ...(settings.webPlayerSharedControls !== undefined
                        ? {
                              webPlayerSharedControls:
                                  settings.webPlayerSharedControls === true,
                          }
                        : {}),
                    ...(settings.dashboardRails !== undefined
                        ? {
                              dashboardRails: normalizeDashboardRailsSettings(
                                  settings.dashboardRails
                              ),
                          }
                        : {}),
                    ...(settings.localTimeshift !== undefined
                        ? {
                              localTimeshift: normalizeLocalTimeshiftSettings(
                                  settings.localTimeshift
                              ),
                          }
                        : {}),
                });
                // Save the complete settings object, not just the partial update
                const completeSettings = this.getSettings();
                try {
                    await firstValueFrom(
                        storage.set(STORE_KEY.Settings, completeSettings)
                    );
                    if (completeSettings.player === VideoPlayer.EmbeddedMpv) {
                        scheduleEmbeddedMpvPrepare();
                    }
                } catch (error) {
                    console.error('Failed to save settings:', error);
                    throw error;
                }
            },

            getSettings() {
                return {
                    player: store.player(),
                    webPlayerSharedControls:
                        store.webPlayerSharedControls?.() === true,
                    streamFormat: store.streamFormat(),
                    openStreamOnDoubleClick: store.openStreamOnDoubleClick(),
                    language: store.language(),
                    showCaptions: store.showCaptions(),
                    showDashboard: store.showDashboard(),
                    startupBehavior: store.startupBehavior(),
                    showExternalPlaybackBar:
                        store.showExternalPlaybackBar?.() ??
                        DEFAULT_SETTINGS.showExternalPlaybackBar,
                    stripCountryPrefix:
                        store.stripCountryPrefix?.() ??
                        DEFAULT_SETTINGS.stripCountryPrefix,
                    theme: store.theme(),
                    mpvPlayerPath: store.mpvPlayerPath(),
                    mpvPlayerArguments: store.mpvPlayerArguments(),
                    mpvReuseInstance: store.mpvReuseInstance(),
                    vlcPlayerPath: store.vlcPlayerPath(),
                    vlcPlayerArguments: store.vlcPlayerArguments(),
                    vlcReuseInstance: store.vlcReuseInstance(),
                    remoteControl: store.remoteControl(),
                    remoteControlPort: store.remoteControlPort(),
                    epgUrl: store.epgUrl(),
                    downloadFolder:
                        store.downloadFolder?.() ??
                        DEFAULT_SETTINGS.downloadFolder,
                    recordingFolder:
                        store.recordingFolder?.() ??
                        DEFAULT_SETTINGS.recordingFolder,
                    embeddedMpvFrameCopy:
                        store.embeddedMpvFrameCopy?.() ?? false,
                    localTimeshift: normalizeLocalTimeshiftSettings(
                        store.localTimeshift?.()
                    ),
                    coverSize:
                        store.coverSize?.() ?? DEFAULT_SETTINGS.coverSize,
                    epgViewMode:
                        store.epgViewMode?.() ?? DEFAULT_SETTINGS.epgViewMode,
                    dashboardRails: normalizeDashboardRailsSettings(
                        store.dashboardRails?.()
                    ),
                    preferUploadedEpgOverXtream:
                        store.preferUploadedEpgOverXtream?.() ??
                        DEFAULT_SETTINGS.preferUploadedEpgOverXtream,
                    trustedPrivateNetworkEpgUrls:
                        store.trustedPrivateNetworkEpgUrls?.() ??
                        DEFAULT_SETTINGS.trustedPrivateNetworkEpgUrls,
                    trustedInsecureTlsHosts:
                        store.trustedInsecureTlsHosts?.() ??
                        DEFAULT_SETTINGS.trustedInsecureTlsHosts,
                    tmdb: store.tmdb?.() ?? DEFAULT_SETTINGS.tmdb,
                };
            },

            getDownloadFolder() {
                return (
                    store.downloadFolder?.() ?? DEFAULT_SETTINGS.downloadFolder
                );
            },

            getRecordingFolder() {
                return (
                    store.recordingFolder?.() ??
                    DEFAULT_SETTINGS.recordingFolder
                );
            },

            getTrustOptions(): ElectronBridgeTrustOptions {
                const settings = this.getSettings();
                return {
                    trustedPrivateNetworkEpgUrls:
                        settings.trustedPrivateNetworkEpgUrls ?? [],
                    trustedInsecureTlsHosts:
                        settings.trustedInsecureTlsHosts ?? [],
                };
            },

            getPlayer() {
                return store.player();
            },

            isEmbeddedPlayer() {
                return (
                    store.player() === VideoPlayer.VideoJs ||
                    store.player() === VideoPlayer.Html5Player ||
                    store.player() === VideoPlayer.ArtPlayer ||
                    store.player() === VideoPlayer.EmbeddedMpv
                );
            },

            async sanitizeEmbeddedMpvSelection() {
                if (store.player() !== VideoPlayer.EmbeddedMpv) {
                    return;
                }

                if (
                    typeof window === 'undefined' ||
                    !window.electron?.getEmbeddedMpvSupport
                ) {
                    await this.updateSettings({
                        player: DEFAULT_SETTINGS.player,
                    });
                    return;
                }

                try {
                    const support =
                        await window.electron.getEmbeddedMpvSupport();
                    if (!support.supported) {
                        await this.updateSettings({
                            player: DEFAULT_SETTINGS.player,
                        });
                        return;
                    }

                    scheduleEmbeddedMpvPrepare();
                } catch (error) {
                    console.warn(
                        'Failed to verify embedded MPV support; reverting to the default inline player.',
                        error
                    );
                    await this.updateSettings({
                        player: DEFAULT_SETTINGS.player,
                    });
                }
            },
        };
    }),
    withHooks({
        onInit(store) {
            store.loadSettings();
        },
    })
);
