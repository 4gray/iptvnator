import { AGE_RATING_COUNTRY_CODES, normalizeAgeRatingCountry } from '@iptvnator/shared/interfaces/age-rating';
import { computed, inject, Injectable } from '@angular/core';

import { toTmdbLanguage } from '../tmdb/tmdb-config';
import { SettingsStore } from '../settings-store.service';

interface RegionNames {
    of(code: string): string | undefined;
}

const DisplayNames = (
    Intl as typeof Intl & {
        DisplayNames?: new (
            locales: string[],
            options: { type: 'region' }
        ) => RegionNames;
    }
).DisplayNames;

/** Country selection is local presentation; it never starts metadata requests. */
@Injectable({ providedIn: 'root' })
export class AgeRatingPresentationService {
    private readonly settings = inject(SettingsStore);
    private readonly names = computed(() => {
        try {
            return DisplayNames
                ? new DisplayNames([toTmdbLanguage(this.settings.language())], {
                      type: 'region',
                  })
                : null;
        } catch {
            return null;
        }
    });

    readonly automaticCountry = computed(
        () => toTmdbLanguage(this.settings.language()).split('-')[1] || 'US'
    );
    readonly country = computed(() => {
        const selected = normalizeAgeRatingCountry(
            this.settings.ageRatingCountry?.()
        );
        return selected === 'auto' ? this.automaticCountry() : selected;
    });
    readonly countryOptions = computed(() =>
        AGE_RATING_COUNTRY_CODES.map((code) => ({
            code,
            label: this.countryName(code),
        })).sort((a, b) =>
            a.label.localeCompare(
                b.label,
                toTmdbLanguage(this.settings.language())
            )
        )
    );

    countryName(code: string): string {
        return this.names()?.of(code) || code;
    }
}
