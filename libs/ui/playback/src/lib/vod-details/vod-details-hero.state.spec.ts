import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
    TranslateLoader,
    TranslateModule,
    TranslateService,
} from '@ngx-translate/core';
import { Observable, of, Subject } from 'rxjs';
import { injectTranslationTick } from '@iptvnator/services';
import type { NormalizedVodMeta } from '@iptvnator/shared/interfaces';
import { createVodDetailsHeroState } from './vod-details-hero.state';

const EN = {
    WORKSPACE: { DASHBOARD: { TYPE_MOVIE: 'Movie' } },
    XTREAM: { PLAY: 'Play' },
};

function createHero(loader: TranslateLoader, defaultLanguage?: string) {
    TestBed.configureTestingModule({
        imports: [
            TranslateModule.forRoot({
                defaultLanguage,
                loader: { provide: TranslateLoader, useValue: loader },
            }),
        ],
    });
    const translate = TestBed.inject(TranslateService);
    const language = TestBed.runInInjectionContext(() =>
        injectTranslationTick()
    );
    const hero = createVodDetailsHeroState({
        meta: signal({} as NormalizedVodMeta),
        sourceLabel: signal('Portal'),
        playbackPosition: signal(null),
        playbackDurationSeconds: signal(null),
        hasPlaybackPosition: signal(false),
        isWatched: signal(false),
        supportsExternalPlayers: () => false,
        playbackStartPending: signal(false),
        isOfflinePrimary: signal(false),
        externalLabel: signal(null),
        externalIcon: signal('play_arrow'),
        externalState: signal('idle'),
        similarInPortals: signal([]),
        configuredPlayer: signal(null),
        translate,
        language,
    });
    return { translate, hero };
}

describe('createVodDetailsHeroState', () => {
    it('re-words its labels after a runtime language switch', () => {
        const { translate, hero } = createHero({
            getTranslation: () => of({}),
        });
        translate.setTranslation('en', EN);
        translate.setTranslation('ru', {
            WORKSPACE: { DASHBOARD: { TYPE_MOVIE: 'Фильм' } },
            XTREAM: { PLAY: 'Смотреть' },
        });
        translate.use('en');

        expect(hero.kindLabel()).toBe('Movie · Portal');
        expect(hero.primaryAction().label).toBe('Play');

        translate.use('ru');

        expect(hero.kindLabel()).toBe('Фильм · Portal');
        expect(hero.primaryAction().label).toBe('Смотреть');
    });

    it('replaces raw keys once a start-up dictionary lands without use()', () => {
        // No saved language: the app never calls use(), so the default
        // language's dictionary arriving is the only event.
        const dictionary = new Subject<Record<string, unknown>>();
        const { hero } = createHero(
            {
                getTranslation: (): Observable<Record<string, unknown>> =>
                    dictionary,
            },
            'en'
        );

        expect(hero.kindLabel()).toBe(
            'WORKSPACE.DASHBOARD.TYPE_MOVIE · Portal'
        );
        expect(hero.primaryAction().label).toBe('XTREAM.PLAY');

        dictionary.next(EN);
        dictionary.complete();

        expect(hero.kindLabel()).toBe('Movie · Portal');
        expect(hero.primaryAction().label).toBe('Play');
    });
});
