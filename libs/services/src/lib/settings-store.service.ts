import {
    EpgSourceSettingsService,
    epgSourceUrlsChanged,
    normalizeEpgSourceUrls,
} from './epg-source-settings.service';
import { resolveDefaultOnSettings } from './settings-opt-out.util';
import { computed, DestroyRef, inject } from '@angular/core';
import { EpgPreferencesService } from './epg-preferences.service';
import {
    getState,
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
    DEFAULT_TMDB_SETTINGS,
    ElectronBridgeTrustOptions,
    EpgViewMode,
    Settings,
    STORE_KEY,
    VideoPlayer,
    normalizeAppLanguage,
    normalizeTheme,
    normalizeEpgOffsetMinutes,
    normalizeDashboardRailsSettings,
    normalizeParentalLockRelockMinutes,
} from '@iptvnator/shared/interfaces';

import {
    DEFAULT_SETTINGS,
    normalizeSettingsPatch,
    notifyTmdbKeyChange,
    SettingsStorageState,
    snapshotSettings,
    TMDB_KEY_CHANGE,
} from './settings-store.defaults';

export type { SettingsStorageFailure } from './settings-store.defaults';

export const SettingsStore = signalStore(
    { providedIn: 'root' },
    withState<Settings>(DEFAULT_SETTINGS),
    withState<SettingsStorageState>({
        storageFailure: null,
        savedTmdbApiKey: undefined,
    }),
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
        const epgPreferences = inject(EpgPreferencesService);
        let settingsLoadPromise: Promise<void> | undefined;
        let tmdbKeyRevision = 0;
        let epgSaveRevision = 0;
        let committedEpgUrls: Settings['epgUrl'];

        return {
            loadSettings() {
                if (settingsLoadPromise) {
                    return settingsLoadPromise;
                }

                epgPreferences.beginLoad();
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
                            epgUrl: normalizeEpgSourceUrls(
                                storedSettings.epgUrl
                            ),
                            language: normalizeAppLanguage(
                                storedSettings.language
                            ),
                            theme: normalizeTheme(storedSettings.theme),
                            epgOffsetMinutes: normalizeEpgOffsetMinutes(
                                storedSettings.epgOffsetMinutes
                            ),
                            ...resolveDefaultOnSettings(storedSettings),
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
                        .synchronize(
                            this.getSettings().epgUrl,
                            this.getSettings().epgEnabled !== false
                        )
                        .catch((error) => {
                            console.warn(
                                'Could not reconcile cached EPG sources on startup.',
                                error
                            );
                        });
                })()
                    .catch((error) => {
                        settingsLoadPromise = undefined;
                        console.error('Failed to load settings:', error);
                        // Keep default settings if loading fails, but remember
                        // that they are defaults-by-failure rather than by choice
                        // so the settings UI can warn about it.
                        patchState(store, { storageFailure: 'load' });
                    })
                    .finally(() =>
                        epgPreferences.apply(store.epgEnabled?.() !== false)
                    );

                return settingsLoadPromise;
            },

            async updateSettings(
                settings: Partial<Settings>,
                options: { retryEpgCleanup?: boolean } = {}
            ) {
                const previousEpgUrls = store.epgUrl();
                const previousEpgEnabled = store.epgEnabled?.();
                patchState(store, {
                    ...normalizeSettingsPatch(settings),
                    ...(settings.tmdb && {
                        tmdb: { ...store.tmdb?.(), ...settings.tmdb },
                    }),
                });
                // Save the complete settings object, not just the partial update
                const completeSettings = this.getSettings();
                try {
                    const preserveTmdbKey = settings.tmdb?.apiKey === undefined;
                    let apiKey = completeSettings.tmdb?.apiKey ?? '';
                    if (storage.backingEngine === 'indexedDB') {
                        const { writeSettings } =
                            await import('./settings-storage');
                        apiKey = await writeSettings(
                            storage,
                            completeSettings,
                            preserveTmdbKey
                        );
                    } else {
                        await firstValueFrom(
                            storage.set(STORE_KEY.Settings, completeSettings)
                        );
                    }
                    this.applySavedTmdbKey(apiKey);
                    if (!preserveTmdbKey) notifyTmdbKeyChange();
                    patchState(store, { storageFailure: null });
                } catch (error) {
                    console.error('Failed to save settings:', error);
                    // The in-memory patch above already applied, so without
                    // this flag the change looks saved until the next restart.
                    patchState(store, {
                        storageFailure: 'save',
                        epgUrl: previousEpgUrls,
                        epgEnabled: previousEpgEnabled,
                    });
                    throw error;
                }
                if (completeSettings.player === VideoPlayer.EmbeddedMpv) {
                    const { scheduleEmbeddedMpvPrepare } =
                        await import('./settings-store.embedded-mpv');
                    scheduleEmbeddedMpvPrepare();
                }
                // Failed writes cannot retire an earlier committed preference.
                const epgSave = ++epgSaveRevision;
                committedEpgUrls = completeSettings.epgUrl;
                const enableEpg = completeSettings.epgEnabled !== false;
                const wasEpgEnabled = epgPreferences.enabled();
                if (!enableEpg) await epgPreferences.apply(false);
                if (
                    epgSourceUrlsChanged(previousEpgUrls, settings.epgUrl) ||
                    options.retryEpgCleanup ||
                    (enableEpg && !wasEpgEnabled)
                ) {
                    // A native acknowledgement may arrive after a newer save.
                    await epgSources.synchronize(committedEpgUrls);
                }
                if (enableEpg && epgSave === epgSaveRevision)
                    await epgPreferences.apply(true);
            },

            applySavedTmdbKey(apiKey: string): void {
                tmdbKeyRevision++;
                patchState(store, {
                    savedTmdbApiKey: apiKey,
                    tmdb: {
                        ...(store.tmdb?.() ?? DEFAULT_TMDB_SETTINGS),
                        apiKey,
                    },
                });
            },

            async refreshSavedTmdbKey(): Promise<void> {
                const revision = ++tmdbKeyRevision;
                const saved = (await firstValueFrom(
                    storage.get(STORE_KEY.Settings)
                )) as Partial<Settings> | undefined;
                const key = saved?.tmdb?.apiKey;
                if (revision === tmdbKeyRevision)
                    this.applySavedTmdbKey(typeof key === 'string' ? key : '');
            },

            async saveTransferredTmdbKey(
                apiKey: string,
                expectedKey: string,
                isCurrent: () => boolean
            ): Promise<boolean> {
                const { writeTransferredTmdbKey } =
                    await import('./settings-storage');
                const saved = await writeTransferredTmdbKey(
                    storage,
                    apiKey,
                    expectedKey,
                    isCurrent
                );
                if (saved) this.applySavedTmdbKey(apiKey);
                else if (isCurrent())
                    await this.refreshSavedTmdbKey().catch(() => undefined);
                return saved;
            },

            getSettings() {
                return snapshotSettings(getState(store));
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
                const isSaved = () =>
                    store.player() === VideoPlayer.EmbeddedMpv;
                if (isSaved()) {
                    const { verifySavedEmbeddedMpvPlayer } =
                        await import('./settings-store.embedded-mpv');
                    if (!isSaved()) return;
                    await verifySavedEmbeddedMpvPlayer(isSaved, () =>
                        this.updateSettings({
                            player: DEFAULT_SETTINGS.player,
                        })
                    );
                }
            },
        };
    }),
    withHooks({
        onInit(store) {
            store.loadSettings();
            const refresh = (event: StorageEvent) => {
                if (event.key === TMDB_KEY_CHANGE && event.newValue !== null)
                    void store.refreshSavedTmdbKey().catch(() => undefined);
            };
            globalThis.addEventListener?.('storage', refresh);
            inject(DestroyRef).onDestroy(() =>
                globalThis.removeEventListener?.('storage', refresh)
            );
        },
    })
);
