import {
    PlaylistMeta,
    STALKER_REQUEST,
    STALKER_SESSION_APPLICATION_OPERATIONS,
    StalkerPortalActions,
} from '@iptvnator/shared/interfaces';
import { StalkerSessionService } from '../../stalker-session.service';
import {
    fetchStalkerExpireDate,
    fetchStalkerMovieFileId,
    fetchStalkerPlayback,
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

const FULL_PLAYLIST = {
    ...PLAYLIST,
    isFullStalkerPortal: true,
} as PlaylistMeta;

describe('stalker-player-request.utils', () => {
    let dataService: {
        sendIpcEvent: jest.Mock<Promise<unknown>, unknown[]>;
    };
    let stalkerSession: {
        supportsTypedSessions: jest.Mock;
        getLeaseRef: jest.Mock;
        open: jest.Mock;
        request: jest.Mock;
        requestForPlaylist: jest.Mock;
        makeAuthenticatedRequest: jest.Mock;
    };

    beforeEach(() => {
        dataService = {
            sendIpcEvent: jest.fn(),
        };
        stalkerSession = {
            supportsTypedSessions: jest.fn().mockReturnValue(true),
            getLeaseRef: jest.fn(),
            open: jest.fn(),
            request: jest.fn(),
            requestForPlaylist: jest.fn(),
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

        expect(dataService.sendIpcEvent).toHaveBeenCalledWith(STALKER_REQUEST, {
            url: PLAYLIST.portalUrl,
            macAddress: PLAYLIST.macAddress,
            params: {
                action: StalkerPortalActions.CreateLink,
                cmd: '/media/source.mpg',
                type: 'vod',
                series: '3',
                download: '0',
                disable_ad: '0',
                JsHttpRequest: '1-xml',
            },
        });
        expect(streamUrl).toBe(
            'http://demo.example/stalker_portal/media/video_77.mpg'
        );
    });

    it('uses the playlist-aware typed facade and returns the opaque playback context', async () => {
        stalkerSession.requestForPlaylist.mockResolvedValue({
            streamUrl: '/media/video_77.mpg',
            playbackContextRef: 'playback-context-1',
        });

        const playback = await fetchStalkerPlayback(
            {
                dataService: dataService as never,
                stalkerSession:
                    stalkerSession as unknown as StalkerSessionService,
            },
            {
                playlist: FULL_PLAYLIST,
                selectedContentType: 'series',
                cmd: '/media/source.mpg',
                series: 3,
            }
        );

        expect(stalkerSession.requestForPlaylist).toHaveBeenCalledWith(
            expect.objectContaining({
                ...FULL_PLAYLIST,
                lastUsage: '',
            }),
            STALKER_SESSION_APPLICATION_OPERATIONS.CreateLink,
            {
                contentType: 'episode',
                command: '/media/source.mpg',
                episodeNumber: 3,
            }
        );
        expect(stalkerSession.getLeaseRef).not.toHaveBeenCalled();
        expect(stalkerSession.open).not.toHaveBeenCalled();
        expect(stalkerSession.request).not.toHaveBeenCalled();
        expect(stalkerSession.makeAuthenticatedRequest).not.toHaveBeenCalled();
        expect(dataService.sendIpcEvent).not.toHaveBeenCalled();
        expect(playback).toEqual({
            streamUrl: 'http://demo.example/stalker_portal/media/video_77.mpg',
            playbackContextRef: 'playback-context-1',
        });
    });

    it('keeps a full-portal PWA request on the exact legacy IPC payload', async () => {
        stalkerSession.supportsTypedSessions.mockReturnValue(false);
        dataService.sendIpcEvent.mockResolvedValue({
            js: {
                cmd: 'ffmpeg https://cdn.example/live.m3u8',
            },
        });

        await expect(
            fetchStalkerPlayback(
                {
                    dataService: dataService as never,
                    stalkerSession:
                        stalkerSession as unknown as StalkerSessionService,
                },
                {
                    playlist: FULL_PLAYLIST,
                    selectedContentType: 'itv',
                    cmd: 'ffmpeg http://portal/live/1',
                }
            )
        ).resolves.toEqual({
            streamUrl: 'https://cdn.example/live.m3u8',
        });

        expect(dataService.sendIpcEvent).toHaveBeenCalledWith(STALKER_REQUEST, {
            url: FULL_PLAYLIST.portalUrl,
            macAddress: FULL_PLAYLIST.macAddress,
            params: {
                action: StalkerPortalActions.CreateLink,
                cmd: 'ffmpeg http://portal/live/1',
                type: 'itv',
                disable_ad: '0',
                download: '0',
                JsHttpRequest: '1-xml',
            },
        });
        expect(stalkerSession.requestForPlaylist).not.toHaveBeenCalled();
        expect(stalkerSession.getLeaseRef).not.toHaveBeenCalled();
        expect(stalkerSession.open).not.toHaveBeenCalled();
        expect(stalkerSession.request).not.toHaveBeenCalled();
    });

    it('fails closed when a full-session create-link omits the opaque context', async () => {
        stalkerSession.requestForPlaylist.mockResolvedValue({
            streamUrl: 'https://cdn.example/live.m3u8',
        });

        await expect(
            fetchStalkerPlayback(
                {
                    dataService: dataService as never,
                    stalkerSession:
                        stalkerSession as unknown as StalkerSessionService,
                },
                {
                    playlist: FULL_PLAYLIST,
                    selectedContentType: 'itv',
                    cmd: 'ffmpeg http://portal/live/1',
                }
            )
        ).rejects.toThrow('stalker-playback-context-missing');

        expect(dataService.sendIpcEvent).not.toHaveBeenCalled();
        expect(stalkerSession.request).not.toHaveBeenCalled();
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

    it('keeps the full-portal movie file lookup on typed CatalogItems', async () => {
        stalkerSession.requestForPlaylist.mockResolvedValue({
            items: [{ id: 77, contentType: 'vod' }],
        });

        await expect(
            fetchStalkerMovieFileId(
                {
                    dataService: dataService as never,
                    stalkerSession:
                        stalkerSession as unknown as StalkerSessionService,
                },
                FULL_PLAYLIST,
                '22'
            )
        ).resolves.toBe('77');

        expect(stalkerSession.requestForPlaylist).toHaveBeenCalledWith(
            expect.objectContaining({
                _id: FULL_PLAYLIST._id,
                lastUsage: '',
            }),
            STALKER_SESSION_APPLICATION_OPERATIONS.CatalogItems,
            {
                contentType: 'vod',
                itemId: '22',
                page: 1,
            }
        );
        expect(stalkerSession.makeAuthenticatedRequest).not.toHaveBeenCalled();
        expect(dataService.sendIpcEvent).not.toHaveBeenCalled();
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
