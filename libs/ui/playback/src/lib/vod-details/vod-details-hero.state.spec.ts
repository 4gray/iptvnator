import { signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TestBed } from '@angular/core/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { startWith } from 'rxjs';
import type { NormalizedVodMeta } from '@iptvnator/shared/interfaces';
import { createVodDetailsHeroState } from './vod-details-hero.state';

describe('createVodDetailsHeroState', () => {
    it('re-words its labels after a runtime language switch', () => {
        TestBed.configureTestingModule({
            imports: [TranslateModule.forRoot()],
        });
        const translate = TestBed.inject(TranslateService);
        translate.setTranslation('en', {
            WORKSPACE: { DASHBOARD: { TYPE_MOVIE: 'Movie' } },
            XTREAM: { PLAY: 'Play' },
        });
        translate.setTranslation('ru', {
            WORKSPACE: { DASHBOARD: { TYPE_MOVIE: 'Фильм' } },
            XTREAM: { PLAY: 'Смотреть' },
        });
        translate.use('en');
        const language = TestBed.runInInjectionContext(() =>
            toSignal(translate.onLangChange.pipe(startWith(null)), {
                initialValue: null,
            })
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

        expect(hero.kindLabel()).toBe('Movie · Portal');
        expect(hero.primaryAction().label).toBe('Play');

        translate.use('ru');

        expect(hero.kindLabel()).toBe('Фильм · Portal');
        expect(hero.primaryAction().label).toBe('Смотреть');
    });
});
