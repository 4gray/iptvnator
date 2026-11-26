import { Injector, runInInjectionContext } from '@angular/core';
import { LazySnackBar } from '@iptvnator/services/lazy-snack-bar';
import { Router } from '@angular/router';
import { Actions } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { StorageMap } from '@ngx-pwa/local-storage';
import { TranslateService } from '@ngx-translate/core';
import { EpgService } from '@iptvnator/epg/data-access';
import {
    DataService,
    ParentalLockExternalLaunches,
    PlaylistsService,
    RuntimeCapabilitiesService,
    SettingsStore,
} from '@iptvnator/services';
import {
    type Channel,
    OPEN_MPV_PLAYER,
    VideoPlayer,
} from '@iptvnator/shared/interfaces';
import { of, Subject } from 'rxjs';
import { ChannelActions } from './actions';
import { PlaylistEffects } from './effects';

describe('PlaylistEffects setActiveChannel$ programme panel', () => {
    let actions$: Subject<unknown>;
    let epgService: { getChannelPrograms: jest.Mock; clearSchedule: jest.Mock };
    let settings$: Subject<{ player: VideoPlayer }>;
    let sendIpcEvent: jest.Mock;
    let capture: jest.Mock;

    beforeEach(() => {
        actions$ = new Subject();
        settings$ = new Subject();
        sendIpcEvent = jest.fn();
        capture = jest.fn();
        epgService = {
            getChannelPrograms: jest.fn(),
            clearSchedule: jest.fn(),
        };
        const injector = Injector.create({
            parent: { get: () => ({}) } as unknown as Injector,
            providers: [
                { provide: Actions, useValue: new Actions(actions$) },
                { provide: Store, useValue: { select: () => of(undefined) } },
                { provide: PlaylistsService, useValue: {} },
                { provide: EpgService, useValue: epgService },
                { provide: DataService, useValue: { sendIpcEvent } },
                { provide: StorageMap, useValue: { get: () => settings$ } },
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: { supportsManagedExternalPlayers: true },
                },
                {
                    provide: ParentalLockExternalLaunches,
                    useValue: { capture },
                },
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

    it('captures the external launch context before the settings read settles', async () => {
        const parentalLaunch = {
            sourceId: 'synthetic-playlist',
            openedLocked: false,
            lockKey: '[]',
        };
        capture.mockReturnValueOnce(parentalLaunch);
        actions$.next(
            ChannelActions.setActiveChannel({
                channel: {
                    url: 'https://streams.example.test/a.m3u8',
                    name: 'Synthetic Channel',
                } as Channel,
            })
        );

        expect(capture).toHaveBeenCalledTimes(1);
        expect(sendIpcEvent).not.toHaveBeenCalled();
        settings$.next({ player: VideoPlayer.MPV });
        await Promise.resolve();

        expect(sendIpcEvent).toHaveBeenCalledWith(
            OPEN_MPV_PLAYER,
            expect.objectContaining({ parentalLaunch })
        );
    });
});
