import { TestBed } from '@angular/core/testing';
import { EpgRuntimeBridgeService } from '@iptvnator/epg/data-access';
import {
    XtreamApiService,
    XtreamUrlService,
} from '@iptvnator/portal/xtream/data-access';
import { StalkerSessionService } from '@iptvnator/portal/stalker/data-access';
import { UnifiedCollectionItem } from '@iptvnator/portal/shared/util';
import {
    DataService,
    PlaylistsService,
    SettingsStore,
} from '@iptvnator/services';
import { Playlist } from '@iptvnator/shared/interfaces';
import { of } from 'rxjs';
import { StreamResolverService } from './stream-resolver.service';

/**
 * Catch-up from Favorites / Recent resolves its credentials from the STORED
 * playlist row, not from the Xtream store; the persisted server timezone
 * must therefore reach the URL builder from that row (issue #1562).
 */
describe('StreamResolverService catch-up (issue #1562)', () => {
    const item: UnifiedCollectionItem = {
        uid: 'xtream::xtream-1::7',
        name: 'Timezone News',
        contentType: 'live',
        sourceType: 'xtream',
        playlistId: 'xtream-1',
        playlistName: 'Xtream',
        xtreamId: 7,
        logo: '',
    };
    const storedRow = {
        _id: 'xtream-1',
        serverUrl: 'https://xtream.example.com',
        username: 'user',
        password: 'pass',
        serverTimezone: 'Europe/London',
    } satisfies Partial<Playlist>;

    let service: StreamResolverService;
    let playlistsService: { getPlaylistById: jest.Mock };
    let xtreamUrl: { resolveCatchupUrl: jest.Mock };
    let dbGetAppPlaylist: jest.Mock;
    const originalElectron = window.electron;

    beforeEach(() => {
        playlistsService = { getPlaylistById: jest.fn(() => of(undefined)) };
        xtreamUrl = {
            resolveCatchupUrl: jest
                .fn()
                .mockResolvedValue(
                    'https://xtream.example.com/timeshift/user/pass/60/2026-09-06:20-30/7.ts'
                ),
        };
        dbGetAppPlaylist = jest.fn().mockResolvedValue(storedRow);
        window.electron = {
            dbGetAppPlaylist,
        } as unknown as typeof window.electron;

        TestBed.configureTestingModule({
            providers: [
                StreamResolverService,
                { provide: PlaylistsService, useValue: playlistsService },
                {
                    provide: XtreamApiService,
                    useValue: { getShortEpg: jest.fn(), getFullEpg: jest.fn() },
                },
                { provide: XtreamUrlService, useValue: xtreamUrl },
                { provide: DataService, useValue: { sendIpcEvent: jest.fn() } },
                {
                    provide: SettingsStore,
                    useValue: { resolvedEpgOffsetMinutes: () => 0 },
                },
                {
                    provide: EpgRuntimeBridgeService,
                    useValue: {
                        getChannelPrograms: jest.fn(),
                        getEpgMapping: jest.fn().mockResolvedValue(null),
                        getEpgMappingsBatch: jest.fn().mockResolvedValue(null),
                        supportsProgramLookup: true,
                    },
                },
                {
                    provide: StalkerSessionService,
                    useValue: {
                        getCachedToken: jest.fn(() => null),
                        ensureToken: jest
                            .fn()
                            .mockResolvedValue({ token: null }),
                        makeAuthenticatedRequest: jest.fn(),
                    },
                },
            ],
        });

        service = TestBed.inject(StreamResolverService);
    });

    afterEach(() => {
        window.electron = originalElectron;
    });

    it('hands the timezone persisted on the Electron playlist row to the catch-up URL builder', async () => {
        const url = await service.resolveXtreamCatchupUrl(
            item,
            1_788_723_000,
            1_788_726_600
        );

        expect(dbGetAppPlaylist).toHaveBeenCalledWith('xtream-1');
        expect(xtreamUrl.resolveCatchupUrl).toHaveBeenCalledWith(
            'xtream-1',
            expect.objectContaining({
                serverUrl: 'https://xtream.example.com',
                username: 'user',
                password: 'pass',
                serverTimezone: 'Europe/London',
            }),
            7,
            1_788_723_000,
            1_788_726_600,
            'Europe/London'
        );
        expect(url).toContain('/2026-09-06:20-30/');
    });

    it('reads the same timezone from the IndexedDB row in the PWA', async () => {
        window.electron = undefined as unknown as typeof window.electron;
        playlistsService.getPlaylistById.mockReturnValue(
            of({ ...storedRow, serverTimezone: 'UTC+03:00' })
        );

        await service.resolveXtreamCatchupUrl(
            item,
            1_788_723_000,
            1_788_726_600
        );

        expect(xtreamUrl.resolveCatchupUrl).toHaveBeenCalledWith(
            'xtream-1',
            expect.objectContaining({ serverTimezone: 'UTC+03:00' }),
            7,
            1_788_723_000,
            1_788_726_600,
            'UTC+03:00'
        );
    });

    it('returns null instead of guessing when the row lacks credentials', async () => {
        dbGetAppPlaylist.mockResolvedValue({ _id: 'xtream-1' });

        await expect(
            service.resolveXtreamCatchupUrl(item, 1_788_723_000, 1_788_726_600)
        ).resolves.toBeNull();
        expect(xtreamUrl.resolveCatchupUrl).not.toHaveBeenCalled();
    });
});
