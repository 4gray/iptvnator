import { PlaylistMeta, StalkerPortalActions } from '@iptvnator/shared/interfaces';
import { StalkerSessionService } from '../../stalker-session.service';
import {
    fetchStalkerExpireDate,
    fetchStalkerMovieFileId,
    fetchStalkerPlaybackLink,
    shouldResolveMovieFileId,
} from './stalker-player-request.utils';

const PLAYLIST = {
    _id: 'playlist-1',
    title: 'Demo Stalker',
    count: 0,
    autoRefresh: false,
    importDate: '2026-04-14T00:00:00.000Z',
    portalUrl: 'http://demo.example/stalker_portal/server/load.php',
    macAddress: '00:1A:79:00:00:01',
    isFullStalkerPortal: false,
} as PlaylistMeta;

describe('stalker-player-request.utils', () => {
    let dataService: {
        sendIpcEvent: jest.Mock<Promise<unknown>, unknown[]>;
    };
    let stalkerSession: Pick<StalkerSessionService, 'makeAuthenticatedRequest'>;

    beforeEach(() => {
        dataService = {
            sendIpcEvent: jest.fn(),
        };
        stalkerSession = {
            makeAuthenticatedRequest: jest.fn(),
        };
    });

    it('builds create_link requests and normalizes relative portal URLs', async () => {
        dataService.sendIpcEvent.mockResolvedValue({
            js: { cmd: '/media/video_77.mpg' },
        });

        const streamUrl = await fetchStalkerPlaybackLink(
            {
                dataService: dataService as never,
                stalkerSession: stalkerSession as StalkerSessionService,
            },
            {
                playlist: PLAYLIST,
                selectedContentType: 'series',
                cmd: '/media/source.mpg',
                series: 3,
            }
        );

        expect(dataService.sendIpcEvent).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                url: PLAYLIST.portalUrl,
                macAddress: PLAYLIST.macAddress,
                params: expect.objectContaining({
                    action: StalkerPortalActions.CreateLink,
                    cmd: '/media/source.mpg',
                    type: 'vod',
                    series: '3',
                    download: '0',
                    disable_ad: '0',
                    JsHttpRequest: '1-xml',
                }),
            })
        );
        expect(streamUrl).toBe(
            'http://demo.example/stalker_portal/media/video_77.mpg'
        );
    });

    it('detects file-id fallback candidates and reads the movie file id', async () => {
        expect(
            shouldResolveMovieFileId(
                { has_files: true },
                '/media/source_42.mpg'
            )
        ).toBe(true);
        expect(
            shouldResolveMovieFileId({ has_files: true }, '/media/file_42.mpg')
        ).toBe(false);

        dataService.sendIpcEvent.mockResolvedValue({
            js: {
                data: [{ id: 77 }],
            },
        });

        await expect(
            fetchStalkerMovieFileId(
                {
                    dataService: dataService as never,
                    stalkerSession: stalkerSession as StalkerSessionService,
                },
                PLAYLIST,
                '22'
            )
        ).resolves.toBe('77');

        expect(dataService.sendIpcEvent).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                params: expect.objectContaining({
                    action: StalkerPortalActions.GetOrderedList,
                    type: 'vod',
                    movie_id: '22',
                    p: '1',
                }),
            })
        );
    });

    it('returns a localized expire date string from account info', async () => {
        const expireDate = 1_713_139_200;
        dataService.sendIpcEvent.mockResolvedValue({
            js: {
                account_info: {
                    expire_date: expireDate,
                },
            },
        });

        await expect(
            fetchStalkerExpireDate(
                {
                    dataService: dataService as never,
                    stalkerSession: stalkerSession as StalkerSessionService,
                },
                PLAYLIST
            )
        ).resolves.toBe(new Date(expireDate * 1000).toLocaleDateString());
    });
});
