import { Injector, runInInjectionContext } from '@angular/core';
import { LazySnackBar } from '@iptvnator/services/lazy-snack-bar';
import { Router } from '@angular/router';
import { Actions } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { EpgService } from '@iptvnator/epg/data-access';
import { PlaylistsService, SettingsStore } from '@iptvnator/services';
import type { Channel } from '@iptvnator/shared/interfaces';
import { of, Subject } from 'rxjs';
import { ChannelActions } from './actions';
import { PlaylistEffects } from './effects';

describe('PlaylistEffects setActiveChannel$ programme panel', () => {
    let actions$: Subject<unknown>;
    let epgService: { getChannelPrograms: jest.Mock; clearSchedule: jest.Mock };

    beforeEach(() => {
        actions$ = new Subject();
        epgService = { getChannelPrograms: jest.fn(), clearSchedule: jest.fn() };
        const injector = Injector.create({
            parent: { get: () => ({}) } as unknown as Injector,
            providers: [
                { provide: Actions, useValue: new Actions(actions$) },
                { provide: Store, useValue: { select: () => of(undefined) } },
                { provide: PlaylistsService, useValue: {} },
                { provide: EpgService, useValue: epgService },
                { provide: Router, useValue: {} },
                { provide: LazySnackBar, useValue: { open: jest.fn() } },
                {
                    provide: TranslateService,
                    useValue: { instant: (key: string) => key },
                },
                {
                    provide: SettingsStore,
                    useValue: { getSettings: () => ({ epgUrl: [] }) },
                },
            ],
        });
        const effects = runInInjectionContext(
            injector,
            () => new PlaylistEffects()
        );
        effects.setActiveChannel$.subscribe();
    });

    it('reads the schedule with the channel’s advertised archive days', () => {
        actions$.next(
            ChannelActions.setActiveChannel({
                channel: {
                    url: 'https://streams.example.test/a.m3u8',
                    name: 'Synthetic News',
                    tvg: { id: 'news.example' },
                    catchup: { days: '7' },
                } as Channel,
            })
        );

        expect(epgService.getChannelPrograms).toHaveBeenCalledWith(
            'news.example',
            7
        );
        expect(epgService.clearSchedule).not.toHaveBeenCalled();
    });

    it('clears the panel for a channel without one', () => {
        actions$.next(
            ChannelActions.setActiveChannel({
                channel: {
                    url: 'https://streams.example.test/b.m3u8',
                    name: ' ',
                } as Channel,
            })
        );

        expect(epgService.clearSchedule).toHaveBeenCalled();
        expect(epgService.getChannelPrograms).not.toHaveBeenCalled();
    });
});
