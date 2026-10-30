import { selectAgeRating } from '@iptvnator/shared/interfaces/age-rating';
import { AgeRatingPresentationService } from '@iptvnator/services/age-rating';
import {
    ChangeDetectionStrategy,
    Component,
    computed,
    inject,
    input,
} from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslateService } from '@ngx-translate/core';
import { injectTranslationTick } from '@iptvnator/services';
import { type ContentCertification } from '@iptvnator/shared/interfaces';
import { MetaChipComponent } from './meta-chip.component';

/** Informational classification, shared by provider and M3U detail views. */
@Component({
    selector: 'app-age-rating-chip',
    imports: [MetaChipComponent, MatTooltipModule],
    templateUrl: './age-rating-chip.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
    styles: ':host { display: inline-flex; max-width: 100%; app-region: no-drag; }',
})
export class AgeRatingChipComponent {
    readonly certifications = input<
        readonly ContentCertification[] | undefined
    >();
    private readonly ratings = inject(AgeRatingPresentationService);
    private readonly translate = inject(TranslateService);
    private readonly languageTick = injectTranslationTick();
    private readonly selected = computed(() =>
        selectAgeRating(this.certifications(), this.ratings.country())
    );
    private text(key: string, params?: Record<string, string>): string {
        this.languageTick();
        return this.translate.instant(key, params);
    }

    readonly label = computed(() => {
        const selected = this.selected();
        return selected
            ? `${selected.values.join(' / ')} · ${selected.countryCode || this.text('PORTALS.DETAIL.AGE_RATING_PROVIDER')}`
            : this.text('PORTALS.DETAIL.AGE_RATING_UNKNOWN');
    });
    readonly description = computed(() => {
        const selected = this.selected();
        if (!selected) return this.label();
        const source =
            selected.source === 'tmdb'
                ? 'TMDB'
                : this.text('PORTALS.DETAIL.AGE_RATING_PROVIDER');
        const parts = [
            this.text('PORTALS.DETAIL.AGE_RATING_DESCRIPTION', {
                rating: this.label(),
                source,
            }),
        ];
        if (selected.isCountryFallback) {
            parts.push(
                this.text('PORTALS.DETAIL.AGE_RATING_COUNTRY_FALLBACK', {
                    country: this.ratings.countryName(this.ratings.country()),
                    fallback: selected.countryCode
                        ? this.ratings.countryName(selected.countryCode)
                        : source,
                })
            );
        }
        if (selected.hasMultipleValues)
            parts.push(this.text('PORTALS.DETAIL.AGE_RATING_MULTIPLE'));
        return parts.join(' ');
    });
}
