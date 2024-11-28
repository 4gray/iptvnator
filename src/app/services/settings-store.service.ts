import { Injectable, computed, signal } from '@angular/core';
import { StorageMap } from '@ngx-pwa/local-storage';
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

@Injectable({
    providedIn: 'root',
})
export class SettingsStore {
    private settings = signal<Settings>(DEFAULT_SETTINGS);

    // Computed values for commonly used settings
    readonly player = computed(() => this.settings().player);
    readonly showCaptions = computed(() => this.settings().showCaptions);
    readonly theme = computed(() => this.settings().theme);

    constructor(private storage: StorageMap) {
        this.loadSettings();
    }

    async loadSettings() {
        const stored = await this.storage.get(STORE_KEY.Settings).toPromise();
        if (stored) {
            this.settings.set({ ...DEFAULT_SETTINGS, ...(stored as Settings) });
        }
    }

    async updateSettings(settings: Partial<Settings>) {
        const newSettings = { ...this.settings(), ...settings };
        this.settings.set(newSettings);
        await this.storage.set(STORE_KEY.Settings, newSettings).toPromise();
    }

    getSettings() {
        return this.settings;
    }
}
