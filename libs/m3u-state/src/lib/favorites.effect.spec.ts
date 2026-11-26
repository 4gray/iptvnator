import { Injector, runInInjectionContext } from '@angular/core';
import { NotificationService } from '@iptvnator/services/notifications';
import { FavoriteChannelMembershipEvents } from '@iptvnator/services/favorites-events';
import { Router } from '@angular/router';
import { Actions } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { EpgService } from '@iptvnator/epg/data-access';
import { PlaylistsService, SettingsStore } from '@iptvnator/services';
import type { Channel } from '@iptvnator/shared/interfaces';
import { of, Subject } from 'rxjs';
import { FavoritesActions } from './actions';
import { PlaylistEffects } from './effects';
import { selectActivePlaylistId, selectFavorites } from './selectors';

describe('PlaylistEffects updateFavorites$', () => {
    let actions$: Subject<unknown>;
    let transformPlaylistFavorites: jest.Mock;
    let storedFavorites: string[];
    let notifications: { success: jest.Mock; error: jest.Mock };
    let favoriteMembership: FavoriteChannelMembershipEvents;

    function setup(afterToggle: string[]) {
        actions$ = new Subject();
        notifications = { success: jest.fn(), error: jest.fn() };
        favoriteMembership = new FavoriteChannelMembershipEvents();
        transformPlaylistFavorites = jest.fn(
            (_id: string, transform: (current: string[]) => string[]) => {
                storedFavorites = transform(storedFavorites);
                return of(undefined);
            }
        );
        const injector = Injector.create({
            parent: { get: () => ({}) } as unknown as Injector,
            providers: [
                { provide: Actions, useValue: new Actions(actions$) },
                {
                    provide: Store,
                    useValue: {
                        select: (selector: unknown) =>
                            of(
                                selector === selectFavorites
                                    ? afterToggle
                                    : selector === selectActivePlaylistId
                                      ? 'p1'
                                      : undefined
                            ),
                    },
                },
                {
                    provide: PlaylistsService,
                    useValue: { transformPlaylistFavorites },
                },
                { provide: EpgService, useValue: { fetchEpg: jest.fn() } },
                { provide: Router, useValue: {} },
                { provide: NotificationService, useValue: notifications },
                {
                    provide: FavoriteChannelMembershipEvents,
                    useValue: favoriteMembership,
                },
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
        effects.updateFavorites$.subscribe();
        effects.setFavorites$.subscribe();
    }

    const channel = {
        id: 'legacy-channel-a',
        url: 'https://streams.example/live-a',
    } as Channel;

    it("adds the toggled channel to the stored favorites, keeping others'", () => {
        // This device's state did not know about the other favorite yet.
        storedFavorites = ['https://streams.example/live-b'];
        setup([channel.url]);

        actions$.next(FavoritesActions.updateFavorites({ channel }));

        expect(transformPlaylistFavorites).toHaveBeenCalledWith(
            'p1',
            expect.any(Function)
        );
        expect(storedFavorites).toEqual([
            'https://streams.example/live-b',
            channel.url,
        ]);
        expect(notifications.success).toHaveBeenCalledWith(
            'CHANNELS.FAVORITES_UPDATED'
        );
    });

    it('removes both stored aliases for the toggled channel and publishes its durable removal', () => {
        const other = 'https://streams.example/live-b';
        storedFavorites = [channel.id, channel.url, other];
        setup([]);
        const removed = jest.fn();
        favoriteMembership.changed$.subscribe(removed);

        actions$.next(FavoritesActions.updateFavorites({ channel }));

        expect(storedFavorites).toEqual([other]);
        expect(removed).toHaveBeenCalledWith({
            sourceType: 'm3u',
            playlistId: 'p1',
            streamUrl: channel.url,
        });
    });

    it('applies a reorder to the stored favorites', () => {
        // Another device added 'http://new' and removed 'http://gone'.
        storedFavorites = ['http://a', 'http://b', 'http://new'];
        setup([]);

        actions$.next(
            FavoritesActions.setFavorites({
                channelIds: ['http://b', 'http://gone', 'http://a'],
            })
        );

        expect(storedFavorites).toEqual(['http://b', 'http://a', 'http://new']);
    });
});
