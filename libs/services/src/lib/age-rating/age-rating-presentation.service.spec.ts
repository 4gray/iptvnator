import { Language } from '@iptvnator/shared/interfaces';
import { Injector, signal } from '@angular/core';
import { SettingsStore } from '../settings-store.service';
import { AgeRatingPresentationService } from './age-rating-presentation.service';

describe('AgeRatingPresentationService', () => {
    it('follows the UI language only in automatic mode', () => {
        const language = signal('de');
        const ageRatingCountry = signal<string | undefined>(undefined);
        const injector = Injector.create({
            providers: [
                AgeRatingPresentationService,
                {
                    provide: SettingsStore,
                    useValue: { language, ageRatingCountry },
                },
            ],
        });
        const service = injector.get(AgeRatingPresentationService);
        expect(service.country()).toBe('DE');
        language.set('pt-BR');
        expect(service.country()).toBe('BR');
        ageRatingCountry.set('gb');
        expect(service.country()).toBe('GB');
        language.set('fr');
        expect(service.country()).toBe('GB');
        ageRatingCountry.set('ZZ');
        expect(service.country()).toBe('FR');
        expect(
            service.countryOptions().some((option) => option.code === 'DE')
        ).toBe(true);
        expect(service.countryName('DE')).toBeTruthy();
    });
    it.each(Object.values(Language))(
        'supports country names in app locale %s',
        (locale) => {
            const injector = Injector.create({
                providers: [
                    AgeRatingPresentationService,
                    {
                        provide: SettingsStore,
                        useValue: {
                            language: signal(locale),
                            ageRatingCountry: signal('auto'),
                        },
                    },
                ],
            });
            expect(
                injector.get(AgeRatingPresentationService).countryOptions()
            ).toHaveLength(249);
        }
    );
});
