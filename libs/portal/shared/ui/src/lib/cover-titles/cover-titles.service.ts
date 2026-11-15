import { computed, inject, Injectable } from '@angular/core';
import { SettingsStore } from '@iptvnator/services';

@Injectable({ providedIn: 'root' })
export class CoverTitlesService {
    private readonly settingsStore = inject(SettingsStore);

    /** True when covers render without a title row. */
    readonly postersOnly = computed(
        () => this.settingsStore.showCoverTitles?.() === false
    );
}
