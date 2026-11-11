import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';
import {
    DatabaseService,
    SettingsStore,
    SortService,
} from '@iptvnator/services';
import type {
    GlobalSearchResult,
    PlaylistMeta,
} from '@iptvnator/shared/interfaces';
import {
    LIVE_FAILOVER_ARRIVAL_MS,
    LiveChannelFailoverService,
} from './live-channel-failover.service';

describe('LiveChannelFailoverService', () => {
    let service: LiveChannelFailoverService;
    let router: { url: string; navigate: jest.Mock };
    let database: { globalSearchContent: jest.Mock };
    let snackBar: { open: jest.Mock };

    const sources = [
        { _id: 'failing', title: 'Failing' },
        { _id: 'gold', title: 'Gold' },
        { _id: 'list', title: 'List' },
        { _id: 'silver', title: 'Silver' },
    ] as PlaylistMeta[];

    function xtream(
        playlistId: string,
        title: string,
        id = 7
    ): GlobalSearchResult {
        return {
            source_type: 'xtream',
            content_type: 'live',
            type: 'live',
            id,
            category_id: 1,
            title,
            rating: null,
            added: null,
            poster_url: null,
            xtream_id: id,
            playlist_id: playlistId,
            playlist_name: playlistId,
        };
    }

    function m3u(playlistId: string, title: string): GlobalSearchResult {
        return {
            ...xtream(playlistId, title),
            source_type: 'm3u',
            channel_id: 'c1',
            stream_url: `http://${playlistId}.example/live.ts`,
            group_title: '',
            radio: 'false',
            channel: {} as never,
        } as GlobalSearchResult;
    }

    function navigatedTo(): unknown[][] {
        return router.navigate.mock.calls.map(([link, extras]) => [
            link.join('/'),
            extras.state,
        ]);
    }

    beforeEach(() => {
        router = {
            url: '/workspace/xtreams/failing/live',
            navigate: jest.fn(async (link: string[]) => {
                router.url = link.join('/');
                return true;
            }),
        };
        database = {
            globalSearchContent: jest
                .fn()
                .mockResolvedValue([
                    xtream('silver', 'ERT1 HD', 31),
                    m3u('list', 'ERT 1'),
                    xtream('failing', 'ERT 1', 1),
                    xtream('gold', 'ERT Sports 1', 40),
                    xtream('gold', 'GR: ERT 1', 41),
                ]),
        };
        snackBar = { open: jest.fn() };
        TestBed.configureTestingModule({
            imports: [TranslateModule.forRoot()],
            providers: [
                { provide: Router, useValue: router },
                { provide: DatabaseService, useValue: database },
                { provide: MatSnackBar, useValue: snackBar },
                {
                    provide: SettingsStore,
                    useValue: { liveChannelFailover: signal(true) },
                },
                { provide: Store, useValue: { select: () => of(sources) } },
                {
                    provide: SortService,
                    useValue: {
                        getSortOptions: () => of({}),
                        sortPlaylists: (list: PlaylistMeta[]) => list,
                    },
                },
            ],
        });
        service = TestBed.inject(LiveChannelFailoverService);
    });

    afterEach(() => jest.useRealTimers());

    it('hops to the best match of the next source in list order', async () => {
        await service.reportFailed('ERT 1');

        expect(database.globalSearchContent).toHaveBeenCalledWith(
            'ert 1',
            ['live'],
            true,
            undefined,
            { limit: 500 }
        );
        expect(navigatedTo()).toEqual([
            [
                '/workspace/xtreams/gold/live',
                expect.objectContaining({
                    openXtreamLiveItemId: 41,
                    openXtreamLivePlaylistId: 'gold',
                }),
            ],
        ]);
        expect(service.status()).toEqual({
            kind: 'hopping',
            channelName: 'GR: ERT 1',
            sourceName: 'Gold',
            index: 1,
            total: 3,
        });
    });

    it('moves on when a hop fails and settles on the first source that plays', async () => {
        await service.reportFailed('ERT 1');
        service.reportLoading('GR: ERT 1');
        await service.reportFailed('GR: ERT 1');

        expect(navigatedTo()[1]).toEqual([
            '/workspace/playlists/list/all',
            { openM3uChannelUrl: 'http://list.example/live.ts' },
        ]);
        expect(service.isHopTarget('ERT 1')).toBe(true);

        service.reportPlaying('ERT 1');

        expect(service.status()).toBeNull();
        expect(snackBar.open).toHaveBeenCalledWith(
            'EMBEDDED_MPV.PLAYER.FAILOVER_SWITCHED',
            undefined,
            expect.anything()
        );
        // Settled: a later failure starts over instead of continuing the hop.
        expect(service.isHopTarget('ERT 1')).toBe(false);
        expect(router.navigate).toHaveBeenCalledTimes(2);
    });

    it('leaves channels that failed recently out of the next failover', async () => {
        await service.reportFailed('ERT 1');
        await service.reportFailed('GR: ERT 1');
        service.reportPlaying('ERT 1');

        // Later the settled source drops too: neither the original source
        // nor the one that just failed is offered again.
        await service.reportFailed('ERT 1');

        expect(navigatedTo()[2][0]).toBe('/workspace/xtreams/silver/live');
        expect(service.status()).toMatchObject({ index: 1, total: 1 });
    });

    it('reports when no other source plays the channel', async () => {
        await service.reportFailed('ERT 1');
        await service.reportFailed('GR: ERT 1');
        await service.reportFailed('ERT 1');
        await service.reportFailed('ERT1 HD');

        expect(router.navigate).toHaveBeenCalledTimes(3);
        expect(service.status()).toEqual({
            kind: 'exhausted',
            channelName: 'ERT 1',
        });
        expect(snackBar.open).toHaveBeenLastCalledWith(
            'EMBEDDED_MPV.PLAYER.FAILOVER_EXHAUSTED',
            undefined,
            expect.anything()
        );
    });

    it('keeps a source that only a later search term finds', async () => {
        // The specific term finds a broken copy; the looser term finds the
        // source that actually plays the channel.
        database.globalSearchContent.mockImplementation(
            async (probe: string) =>
                probe === 'ert 1'
                    ? [xtream('gold', 'ERT 1', 41)]
                    : [xtream('silver', 'ERT1', 31)]
        );

        await service.reportFailed('ERT 1');

        expect(service.status()).toMatchObject({ total: 2 });
        expect(navigatedTo()[0][0]).toBe('/workspace/xtreams/gold/live');
    });

    it('drops a search the user overtook before it navigates', async () => {
        const search = service.reportFailed('ERT 1');
        // The user leaves playback while the catalog search is still running.
        router.url = '/workspace/favorites';
        await search;

        expect(router.navigate).not.toHaveBeenCalled();
        expect(service.status()).toBeNull();
    });

    it('stops hopping when the user picks another channel', async () => {
        await service.reportFailed('ERT 1');

        service.reportLoading('Mega');

        expect(service.status()).toBeNull();
        expect(service.isHopTarget('GR: ERT 1')).toBe(false);
    });

    it('skips a source whose player never shows up', async () => {
        jest.useFakeTimers();
        await service.reportFailed('ERT 1');

        await jest.advanceTimersByTimeAsync(LIVE_FAILOVER_ARRIVAL_MS);

        expect(router.navigate).toHaveBeenCalledTimes(2);
        expect(router.url).toBe('/workspace/playlists/list/all');
    });

    it('does not take over playback outside a source', async () => {
        router.url = '/workspace/favorites';

        await service.reportFailed('ERT 1');

        expect(database.globalSearchContent).not.toHaveBeenCalled();
        expect(router.navigate).not.toHaveBeenCalled();
    });
});
