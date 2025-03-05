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
import { Language } from '../settings/language.enum';
import { Settings, VideoPlayer } from '../settings/settings.interface';
import { Theme } from '../settings/theme.enum';
import { STORE_KEY } from '../shared/enums/store-keys.enum';

const DEFAULT_SETTINGS: Settings = {
    player: VideoPlayer.VideoJs,
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
    })),
    withHooks({
        onInit(store) {
            store.loadSettings();
        },
    })
);
