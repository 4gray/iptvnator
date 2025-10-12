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
import { Language } from '../../../../../libs/shared/interfaces/src/lib/language.enum';
import {
    Settings,
    VideoPlayer,
} from '../../../../../libs/shared/interfaces/src/lib/settings.interface';
import { STORE_KEY } from '../../../../../libs/shared/interfaces/src/lib/store-keys.enum';
import { StreamFormat } from '../../../../../libs/shared/interfaces/src/lib/stream-format.enum';
import { Theme } from '../../../../../libs/shared/interfaces/src/lib/theme.enum';

const DEFAULT_SETTINGS: Settings = {
    player: VideoPlayer.VideoJs,
    streamFormat: StreamFormat.M3u8StreamFormat,
    language: Language.ENGLISH,
    showCaptions: false,
    theme: Theme.LightTheme,
    mpvPlayerPath: '',
    vlcPlayerPath: '',
    remoteControl: false,
    remoteControlPort: 3000,
    epgUrl: [],
};

export const SettingsStore = signalStore(
    { providedIn: 'root' },
    withState<Settings>(DEFAULT_SETTINGS),
    withMethods((store, storage = inject(StorageMap)) => ({
        async loadSettings() {
            const stored = await firstValueFrom(
                storage.get(STORE_KEY.Settings)
            );
            if (stored) {
                patchState(store, {
                    ...DEFAULT_SETTINGS,
                    ...(stored as Settings),
                });
            }
        },

        async updateSettings(settings: Partial<Settings>) {
            patchState(store, settings);
            await firstValueFrom(storage.set(STORE_KEY.Settings, settings));
        },

        getSettings() {
            return {
                player: store.player(),
                streamFormat: store.streamFormat(),
                language: store.language(),
                showCaptions: store.showCaptions(),
                theme: store.theme(),
                mpvPlayerPath: store.mpvPlayerPath(),
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
