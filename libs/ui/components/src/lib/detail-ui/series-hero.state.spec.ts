import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
    TranslateLoader,
    TranslateModule,
    TranslateService,
} from '@ngx-translate/core';
import { Observable, of, Subject } from 'rxjs';
import { injectTranslationTick } from '@iptvnator/services';
import {
    buildSeriesMenuSections,
    createSeriesHeroState,
    SERIES_MENU_ACTION,
} from './series-hero.state';

const BASE = {
    seasonWatchVisible: false,
    seasonFullyWatched: false,
    seasonEligibleCount: 0,
    seasonActionDisabled: false,
    seriesMenuVisible: true,
    seriesFullyWatched: false,
    seriesEligibleCount: 3,
    seriesCountKnown: true,
    seriesActionDisabled: false,
    hasProgress: true,
    playbackActive: false,
    startPending: false,
    watchBatchRunning: false,
    sourcesCount: 0,
    externalPlayerHint: 'MPV' as const,
    copyUrlEpisodeCode: null,
    downloadVisible: false,
    downloadCount: 0,
    downloadDisabled: false,
    downloadBusy: false,
    categoryName: null,
    inContinueWatching: false,
};

function row(input: Partial<typeof BASE>, id: string) {
    return buildSeriesMenuSections({ ...BASE, ...input })
        .flatMap((section) => section.items)
        .find((item) => item.id === id);
}

function resetRow(input: Partial<typeof BASE>) {
    return row(input, SERIES_MENU_ACTION.ResetProgress);
}

describe('buildSeriesMenuSections', () => {
    it('offers the progress reset while nothing plays', () => {
        expect(resetRow({})?.disabled).toBeFalsy();
    });

    it('disables the progress reset while an episode plays or launches', () => {
        // The running player would write the position right back.
        expect(resetRow({ playbackActive: true })?.disabled).toBe(true);
        // Independent of the bulk watched action's own state.
        expect(resetRow({ seriesActionDisabled: true })?.disabled).toBeFalsy();
    });

    it('disables the progress reset while a watched batch persists', () => {
        // The hosts refuse the reset request meanwhile; an enabled row
        // would close the menu and do nothing.
        expect(resetRow({ watchBatchRunning: true })?.disabled).toBe(true);
    });

    it('hides the reset once every episode is watched', () => {
        expect(resetRow({ seriesFullyWatched: true })).toBeUndefined();
    });

    it('holds the external-player row while a start has not settled', () => {
        const external = SERIES_MENU_ACTION.ExternalPlayer;
        expect(row({}, external)?.disabled).toBeFalsy();
        // A second launch could not cancel the first: both players would open.
        expect(row({ startPending: true }, external)?.disabled).toBe(true);
    });
});

const EN = {
    WORKSPACE: { DASHBOARD: { TYPE_SERIES: 'Series' } },
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
    const hero = createSeriesHeroState({
        title: signal('Show'),
        sourceLabel: signal('Portal'),
        status: signal(null),
        year: signal(null),
        tmdbGenres: signal(undefined),
        genre: signal(undefined),
        tmdbCountries: signal(undefined),
        tmdbCast: signal(undefined),
        cast: signal(undefined),
        tmdbDirectors: signal(undefined),
        director: signal(undefined),
        quickStart: signal({
            labelKey: 'XTREAM.PLAY',
            episodeLabel: 'S01E01',
            icon: 'play_arrow',
            disabled: false,
            kind: null,
            position: null,
            episodeCode: 'S01E01',
        }),
        translate,
        language,
    });
    return { translate, hero };
}

describe('createSeriesHeroState', () => {
    it('re-words its labels after a runtime language switch', () => {
        const { translate, hero } = createHero({
            getTranslation: () => of({}),
        });
        translate.setTranslation('en', EN);
        translate.setTranslation('ru', {
            WORKSPACE: { DASHBOARD: { TYPE_SERIES: 'Сериал' } },
            XTREAM: { PLAY: 'Смотреть' },
        });
        translate.use('en');

        expect(hero.kindLabel()).toBe('Series · Portal');
        expect(hero.primaryAction()?.label).toBe('Play');

        translate.use('ru');

        expect(hero.kindLabel()).toBe('Сериал · Portal');
        expect(hero.primaryAction()?.label).toBe('Смотреть');
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
            'WORKSPACE.DASHBOARD.TYPE_SERIES · Portal'
        );

        dictionary.next(EN);
        dictionary.complete();

        expect(hero.kindLabel()).toBe('Series · Portal');
        expect(hero.primaryAction()?.label).toBe('Play');
    });
});
