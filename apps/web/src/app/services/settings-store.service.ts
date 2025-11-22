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
    STORE_KEY,
    StreamFormat,
    Theme,
    VideoPlayer,
} from 'shared-interfaces';

const DEFAULT_SETTINGS: Settings = {
    player: VideoPlayer.VideoJs,
    streamFormat: StreamFormat.M3u8StreamFormat,
    language: Language.ENGLISH,
    showCaptions: false,
    theme: Theme.LightTheme,
    mpvPlayerPath: '',
    mpvReuseInstance: false,
    vlcPlayerPath: '',
    remoteControl: false,
    remoteControlPort: 8765,
    epgUrl: [],
};

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
            } catch (error) {
                console.error('Failed to save settings:', error);
                throw error;
            }
        },

        getSettings() {
            return {
                player: store.player(),
                streamFormat: store.streamFormat(),
                language: store.language(),
                showCaptions: store.showCaptions(),
                theme: store.theme(),
                mpvPlayerPath: store.mpvPlayerPath(),
                mpvReuseInstance: store.mpvReuseInstance(),
                vlcPlayerPath: store.vlcPlayerPath(),
                remoteControl: store.remoteControl(),
                remoteControlPort: store.remoteControlPort(),
                epgUrl: store.epgUrl(),
            };
        },

        getPlayer() {
            return store.player();
        },

        isEmbeddedPlayer() {
            return (
                store.player() === VideoPlayer.VideoJs ||
                store.player() === VideoPlayer.Html5Player
            );
        },
    })),
    withHooks({
        onInit(store) {
            store.loadSettings();
        },
    })
);
