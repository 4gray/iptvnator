import { inject } from '@angular/core';
import {
    patchState,
    signalStore,
    withHooks,
    withMethods,
    withState,
} from '@ngrx/signals';
import { StorageMap } from '@ngx-pwa/local-storage';
import { firstValueFrom } from 'rxjs';
import {
    Language,
    Settings,
    StartupBehavior,
    STORE_KEY,
    StreamFormat,
    Theme,
    VideoPlayer,
} from '@iptvnator/shared/interfaces';

const DEFAULT_SETTINGS: Settings = {
    player: VideoPlayer.VideoJs,
    streamFormat: StreamFormat.M3u8StreamFormat,
    openStreamOnDoubleClick: false,
    language: Language.ENGLISH,
    showCaptions: false,
    showDashboard: true,
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
    remoteControlPort: 8765,
    epgUrl: [],
    downloadFolder: '',
    recordingFolder: '',
    coverSize: 'medium',
    preferUploadedEpgOverXtream: false,
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
    withMethods((store, storage = inject(StorageMap)) => ({
        async loadSettings() {
            try {
                const stored = await firstValueFrom(
                    storage.get(STORE_KEY.Settings)
                );
                if (stored) {
                    patchState(store, {
                        ...DEFAULT_SETTINGS,
                        ...(stored as Settings),
                    });
                    void this.sanitizeEmbeddedMpvSelection().catch((error) => {
                        console.warn(
                            'Failed to verify embedded MPV support while loading settings.',
                            error
                        );
                    });
                }
            } catch (error) {
                console.error('Failed to load settings:', error);
                // Keep default settings if loading fails
            }
        },

        async updateSettings(settings: Partial<Settings>) {
            patchState(store, settings);
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
                streamFormat: store.streamFormat(),
                openStreamOnDoubleClick: store.openStreamOnDoubleClick(),
                language: store.language(),
                showCaptions: store.showCaptions(),
                showDashboard: store.showDashboard(),
                startupBehavior: store.startupBehavior(),
                showExternalPlaybackBar: store.showExternalPlaybackBar!(),
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
                downloadFolder: store.downloadFolder!(),
                recordingFolder: store.recordingFolder!(),
                coverSize: store.coverSize!(),
                preferUploadedEpgOverXtream:
                    store.preferUploadedEpgOverXtream!(),
            };
        },

        getDownloadFolder() {
            return store.downloadFolder!();
        },

        getRecordingFolder() {
            return store.recordingFolder!();
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
                const support = await window.electron.getEmbeddedMpvSupport();
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
    })),
    withHooks({
        onInit(store) {
            store.loadSettings();
        },
    })
);
