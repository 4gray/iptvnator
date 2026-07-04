import { Injectable, inject } from '@angular/core';
import { SettingsStore } from '../settings-store.service';
import { DEFAULT_TMDB_API_KEY, toTmdbLanguage } from './tmdb-config';

/**
 * Shared TMDB runtime context: opt-in gate, effective API key and language
 * resolution. Injected by every TMDB service so the rules live in exactly
 * one place.
 */
@Injectable({ providedIn: 'root' })
export class TmdbRuntimeService {
    private readonly settingsStore = inject(SettingsStore);

    isEnabled(): boolean {
        return Boolean(this.settingsStore.tmdb?.()?.enabled && this.apiKey());
    }

    /** User-provided key from settings, else the embedded default */
    apiKey(): string {
        return (
            this.settingsStore.tmdb?.()?.apiKey?.trim() || DEFAULT_TMDB_API_KEY
        );
    }

    /** TMDB language code derived from the app language ("en-US") */
    language(): string {
        return toTmdbLanguage(this.appLanguage());
    }

    /** Raw app language setting ("en") */
    appLanguage(): string {
        return this.settingsStore.language();
    }
}
