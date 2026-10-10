import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';
import { SettingsStore } from '@iptvnator/services';
import { TrailerDialogService } from '@iptvnator/ui/components';
import { VodDetailsHeroPresenter } from './vod-details-hero.presenter';

describe('VodDetailsHeroPresenter', () => {
    it('re-words the hero labels after a runtime language switch', () => {
        TestBed.configureTestingModule({
            imports: [TranslateModule.forRoot()],
            providers: [
                VodDetailsHeroPresenter,
                {
                    provide: XtreamStore,
                    useValue: { currentPlaylist: signal({ name: 'Portal' }) },
                },
                { provide: SettingsStore, useValue: {} },
                {
                    provide: TrailerDialogService,
                    useValue: { open: jest.fn() },
                },
            ],
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
        const presenter = TestBed.inject(VodDetailsHeroPresenter);

        expect(presenter.kindLabel()).toBe('Movie · Portal');
        expect(presenter.primaryAction().label).toBe('Play');

        translate.use('ru');

        expect(presenter.kindLabel()).toBe('Фильм · Portal');
        expect(presenter.primaryAction().label).toBe('Смотреть');
    });
});
