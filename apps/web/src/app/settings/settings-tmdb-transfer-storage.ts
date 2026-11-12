import { STORE_KEY, type Settings } from '@iptvnator/shared/interfaces';
import { inject, Injectable } from '@angular/core';
import { StorageMap } from '@ngx-pwa/local-storage';
import { firstValueFrom } from 'rxjs';
import { SettingsStore } from '@iptvnator/services';

@Injectable()
export class SettingsTmdbTransferStorage {
    private readonly storage = inject(StorageMap);
    private readonly settings = inject(SettingsStore);

    async readSavedTmdbKey(): Promise<string> {
        const saved = (await firstValueFrom(
            this.storage.get(STORE_KEY.Settings)
        )) as Partial<Settings> | undefined;
        if (this.storage.backingEngine === 'memory')
            throw new Error('Local settings storage is unavailable');
        const key = saved?.tmdb?.apiKey;
        return typeof key === 'string' ? key.trim() : '';
    }

    saveTransferredTmdbKey(
        apiKey: string,
        expectedKey: string,
        isCurrent: () => boolean
    ): Promise<boolean> {
        return this.settings.saveTransferredTmdbKey(
            apiKey,
            expectedKey,
            isCurrent
        );
    }
}
