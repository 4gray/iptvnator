import { AgeRatingPresentationService } from '@iptvnator/services/age-rating';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

import { AgeRatingChipComponent } from './age-rating-chip.component';

describe('AgeRatingChipComponent', () => {
    it('changes classification locally and exposes missing data without claiming unrestricted access', async () => {
        const country = signal('DE');
        await TestBed.configureTestingModule({
            imports: [AgeRatingChipComponent, TranslateModule.forRoot()],
            providers: [
                {
                    provide: AgeRatingPresentationService,
                    useValue: { country, countryName: (code: string) => code },
                },
            ],
        }).compileComponents();
        const translate = TestBed.inject(TranslateService);
        translate.setTranslation('en', {
            PORTALS: {
                DETAIL: {
                    AGE_RATING_UNKNOWN: 'Age: no data',
                    AGE_RATING_PROVIDER: 'Provider',
                    AGE_RATING_DESCRIPTION:
                        'Age classification: {{rating}}. Source: {{source}}.',
                    AGE_RATING_COUNTRY_FALLBACK:
                        'No classification for {{country}}; showing {{fallback}}.',
                    AGE_RATING_MULTIPLE:
                        'Classifications differ between releases.',
                },
            },
        });
        translate.use('en');
        const fixture = TestBed.createComponent(AgeRatingChipComponent);
        fixture.componentRef.setInput('certifications', [
            { value: '12', countryCode: 'DE', source: 'tmdb' },
            { value: 'PG-13', countryCode: 'US', source: 'tmdb' },
        ]);
        fixture.detectChanges();
        expect(fixture.nativeElement.textContent).toContain('12 · DE');
        country.set('FR');
        fixture.detectChanges();
        expect(fixture.nativeElement.textContent).toContain('PG-13 · US');
        const control = fixture.nativeElement.querySelector(
            'button'
        ) as HTMLButtonElement;
        expect(control.getAttribute('aria-label')).toContain(
            'No classification for FR'
        );
        expect(control.getAttribute('aria-label')).toContain('TMDB');
        fixture.componentRef.setInput('certifications', []);
        fixture.detectChanges();
        expect(fixture.nativeElement.textContent).toContain('Age: no data');
        expect(fixture.nativeElement.textContent).not.toContain('PG-13');
    });
});
