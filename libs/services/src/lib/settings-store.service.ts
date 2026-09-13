import {
    EpgSourceSettingsService,
    epgSourceUrlsChanged,
} from './epg-source-settings.service';
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
    normalizeEpgOffsetMinutes,
    normalizeDashboardRailsSettings,
    normalizeParentalLockRelockMinutes,
    normalizeStartupWindowMode,
    DEFAULT_PARENTAL_LOCK_RELOCK_MINUTES,
} from '@iptvnator/shared/interfaces';

import {
    DEFAULT_SETTINGS,
    scheduleEmbeddedMpvPrepare,
    SettingsStorageState,
} from './settings-store.defaults';

export type { SettingsStorageFailure } from './settings-store.defaults';

export const SettingsStore = signalStore(
    { providedIn: 'root' },
    withState<Settings>(DEFAULT_SETTINGS),
    withState<SettingsStorageState>({ storageFailure: null }),
    withComputed((store) => ({
        /**
         * Live EPG panel layout with the `'timeline'` default applied — the
         * single source of truth for the four live hosts, so the fallback is
         * not duplicated per call-site.
         */
        resolvedEpgViewMode: computed<EpgViewMode>(
            () => store.epgViewMode?.() ?? 'timeline'
        ),
        resolvedEpgOffsetMinutes: computed(() =>
            normalizeEpgOffsetMinutes(store.epgOffsetMinutes?.())
        ),
    })),
    withMethods((store, storage = inject(StorageMap)) => {
        const epgSources = inject(EpgSourceSettingsService);
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
                    patchState(store, { storageFailure: null });
                    if (stored) {
                        const storedSettings = stored as Partial<Settings>;
                        patchState(store, {
                            ...DEFAULT_SETTINGS,
                            ...storedSettings,
                            epgOffsetMinutes: normalizeEpgOffsetMinutes(
                                storedSettings.epgOffsetMinutes
                            ),

                            // Absent in settings stored before the default
                            // flip means "never chose" — those users get the
                            // new default; only an explicit false opts out.
                            webPlayerSharedControls:
                                storedSettings.webPlayerSharedControls !==
                                false,
                            portalConnectivityGuard:
                                storedSettings.portalConnectivityGuard !==
                                false,
                            embeddedMpvAutoReconnect:
                                storedSettings.embeddedMpvAutoReconnect !==
                                false,
                            dashboardRails: normalizeDashboardRailsSettings(
                                storedSettings.dashboardRails
                            ),
                            parentalLockEnabled:
                                storedSettings.parentalLockEnabled === true,
                            parentalLockRelockMinutes:
                                normalizeParentalLockRelockMinutes(
                                    storedSettings.parentalLockRelockMinutes
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
                    await epgSources
                        .synchronize(this.getSettings().epgUrl)
                        .catch((error) => {
                            console.warn(
                                'Could not reconcile cached EPG sources on startup.',
                                error
                            );
                        });
                })().catch((error) => {
                    settingsLoadPromise = undefined;
                    console.error('Failed to load settings:', error);
                    // Keep default settings if loading fails, but remember
                    // that they are defaults-by-failure rather than by choice
                    // so the settings UI can warn about it.
                    patchState(store, { storageFailure: 'load' });
                });

                return settingsLoadPromise;
            },

            async updateSettings(
                settings: Partial<Settings>,
                options: { retryEpgCleanup?: boolean } = {}
            ) {
                const previousEpgUrls = store.epgUrl();
                patchState(store, {
                    ...settings,
                    ...(settings.webPlayerSharedControls !== undefined
                        ? {
                              webPlayerSharedControls:
                                  settings.webPlayerSharedControls !== false,
                          }
                        : {}),
                    ...(settings.portalConnectivityGuard !== undefined
                        ? {
                              portalConnectivityGuard:
                                  settings.portalConnectivityGuard !== false,
                          }
                        : {}),
                    ...(settings.embeddedMpvAutoReconnect !== undefined
                        ? {
                              embeddedMpvAutoReconnect:
                                  settings.embeddedMpvAutoReconnect !== false,
                          }
                        : {}),
                    ...(settings.dashboardRails !== undefined
                        ? {
                              dashboardRails: normalizeDashboardRailsSettings(
                                  settings.dashboardRails
                              ),
                          }
                        : {}),
                    ...(settings.epgOffsetMinutes !== undefined
                        ? {
                              epgOffsetMinutes: normalizeEpgOffsetMinutes(
                                  settings.epgOffsetMinutes
                              ),
                          }
                        : {}),
                    ...(settings.parentalLockEnabled !== undefined
                        ? {
                              parentalLockEnabled:
                                  settings.parentalLockEnabled === true,
                          }
                        : {}),
                    ...(settings.parentalLockRelockMinutes !== undefined
                        ? {
                              parentalLockRelockMinutes:
                                  normalizeParentalLockRelockMinutes(
                                      settings.parentalLockRelockMinutes
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
                    patchState(store, { storageFailure: null });
                    if (completeSettings.player === VideoPlayer.EmbeddedMpv) {
                        scheduleEmbeddedMpvPrepare();
                    }
                } catch (error) {
                    console.error('Failed to save settings:', error);
                    // The in-memory patch above already applied, so without
                    // this flag the change looks saved until the next restart.
                    patchState(store, {
                        storageFailure: 'save',
                        epgUrl: previousEpgUrls,
                    });
                    throw error;
                }
                if (
                    epgSourceUrlsChanged(previousEpgUrls, settings.epgUrl) ||
                    options.retryEpgCleanup
                ) {
                    await epgSources.synchronize(completeSettings.epgUrl);
                }
            },

            getSettings() {
                return {
                    player: store.player(),
                    webPlayerSharedControls:
                        store.webPlayerSharedControls?.() !== false,
                    playerAmbientMode:
                        store.playerAmbientMode?.() ??
                        DEFAULT_SETTINGS.playerAmbientMode,
                    playerUpNextRail:
                        store.playerUpNextRail?.() ??
                        DEFAULT_SETTINGS.playerUpNextRail,
                    fullscreenChannelPanel:
                        store.fullscreenChannelPanel?.() ??
                        DEFAULT_SETTINGS.fullscreenChannelPanel,
                    vodAutoFailover:
                        store.vodAutoFailover?.() ??
                        DEFAULT_SETTINGS.vodAutoFailover,
                    m3uVodDetails:
                        store.m3uVodDetails?.() ??
                        DEFAULT_SETTINGS.m3uVodDetails,
                    streamFormat: store.streamFormat(),
                    openStreamOnDoubleClick: store.openStreamOnDoubleClick(),
                    language: store.language(),
                    showCaptions: store.showCaptions(),
                    showDashboard: store.showDashboard(),
                    startupBehavior: store.startupBehavior(),
                    startupWindowMode: normalizeStartupWindowMode(
                        store.startupWindowMode?.()
                    ),
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
                    embeddedMpvExtraOptions:
                        store.embeddedMpvExtraOptions?.() ?? '',
                    portalConnectivityGuard:
                        store.portalConnectivityGuard?.() !== false,
                    embeddedMpvAutoReconnect:
                        store.embeddedMpvAutoReconnect?.() !== false,
                    coverSize:
                        store.coverSize?.() ?? DEFAULT_SETTINGS.coverSize,
                    epgViewMode:
                        store.epgViewMode?.() ?? DEFAULT_SETTINGS.epgViewMode,
                    epgOffsetMinutes: normalizeEpgOffsetMinutes(
                        store.epgOffsetMinutes?.()
                    ),
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
                    parentalLockEnabled: store.parentalLockEnabled?.() === true,
                    parentalLockRelockMinutes:
                        normalizeParentalLockRelockMinutes(
                            store.parentalLockRelockMinutes?.()
                        ),
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
