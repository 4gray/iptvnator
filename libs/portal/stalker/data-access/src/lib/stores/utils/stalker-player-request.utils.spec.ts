import { PlaylistMeta, StalkerPortalActions } from '@iptvnator/shared/interfaces';
import { StalkerSessionService } from '../../stalker-session.service';
import { shouldResolveMovieFileId } from './stalker-playback-command.utils';
import {
    fetchStalkerExpireDate,
    fetchStalkerMovieFileId,
    fetchStalkerPlaybackLink,
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

    it('resolves relative replies against arbitrary discovered installations', async () => {
        // Discovery can persist a nested endpoint (/cp/server/load.php);
        // the base must come from the endpoint's API suffix, not from a
        // fixed stalker_portal|c|portal segment allowlist.
        dataService.sendIpcEvent.mockResolvedValue({
            js: { cmd: '/media/video_5.mpg' },
        });

        const streamUrl = await fetchStalkerPlaybackLink(
            {
                dataService: dataService as never,
                stalkerSession: stalkerSession as StalkerSessionService,
            },
            {
                playlist: {
                    ...PLAYLIST,
                    portalUrl: 'http://demo.example/cp/server/load.php',
                } as PlaylistMeta,
                selectedContentType: 'vod',
                cmd: '/media/source.mpg',
            }
        );

        expect(streamUrl).toBe('http://demo.example/cp/media/video_5.mpg');
    });

    it('resolves relative create_link replies against the repaired endpoint', async () => {
        // A lazy repair can move the endpoint while the caller still holds
        // the activation-time playlist snapshot; the relative `js.cmd` must
        // resolve against the endpoint that actually answered.
        dataService.sendIpcEvent.mockResolvedValue({
            js: { cmd: 'ffmpeg /media/video_9.mpg' },
        });
        // Old row: root portal.php (base path ''). Repaired endpoint lives
        // under /stalker_portal — the resolver keeps that segment as the
        // base for root-relative replies, so the two resolve differently.
        const stalePlaylist = {
            ...PLAYLIST,
            portalUrl: 'http://demo.example/portal.php',
        } as PlaylistMeta;
        const repaired = {
            ...stalePlaylist,
            portalUrl: 'http://demo.example/stalker_portal/server/load.php',
        } as PlaylistMeta;

        const streamUrl = await fetchStalkerPlaybackLink(
            {
                dataService: dataService as never,
                stalkerSession: stalkerSession as StalkerSessionService,
                portalRepair: {
                    applyOverride: jest.fn().mockReturnValue(repaired),
                    shouldAttemptRepair: jest.fn().mockReturnValue(false),
                    repairPortal: jest.fn().mockResolvedValue(null),
                },
            },
            {
                playlist: stalePlaylist,
                selectedContentType: 'vod',
                cmd: '/media/source.mpg',
            }
        );

        expect(streamUrl).toBe(
            'http://demo.example/stalker_portal/media/video_9.mpg'
        );
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

    describe('temporary-link semantics', () => {
        const deps = () => ({
            dataService: dataService as never,
            stalkerSession: stalkerSession as StalkerSessionService,
        });

        it('plays the static cmd of an unflagged row without asking the portal', async () => {
            const streamUrl = await fetchStalkerPlaybackLink(deps(), {
                playlist: PLAYLIST,
                selectedContentType: 'itv',
                cmd: 'ffrt3 http://cdn.example/live/42.m3u8',
                linkFlags: {
                    use_http_tmp_link: '0',
                    use_load_balancing: '0',
                },
            });

            expect(streamUrl).toBe('http://cdn.example/live/42.m3u8');
            expect(dataService.sendIpcEvent).not.toHaveBeenCalled();
        });

        it.each(['use_http_tmp_link', 'use_load_balancing'] as const)(
            'mints a temporary link when %s is set',
            async (flag) => {
                dataService.sendIpcEvent.mockResolvedValue({
                    js: { cmd: 'http://cdn.example/tmp/42.m3u8?tok=1' },
                });

                const streamUrl = await fetchStalkerPlaybackLink(deps(), {
                    playlist: PLAYLIST,
                    selectedContentType: 'itv',
                    cmd: 'ffrt3 http://cdn.example/live/42.m3u8',
                    linkFlags: { [flag]: '1' },
                });

                expect(streamUrl).toBe('http://cdn.example/tmp/42.m3u8?tok=1');
                expect(dataService.sendIpcEvent).toHaveBeenCalledWith(
                    expect.anything(),
                    expect.objectContaining({
                        params: expect.objectContaining({
                            action: StalkerPortalActions.CreateLink,
                        }),
                    })
                );
            }
        );

        it('mints a link when the caller supplies no flags', async () => {
            dataService.sendIpcEvent.mockResolvedValue({
                js: { cmd: 'http://cdn.example/tmp/42.m3u8' },
            });

            await fetchStalkerPlaybackLink(deps(), {
                playlist: PLAYLIST,
                selectedContentType: 'itv',
                cmd: 'ffrt3 http://cdn.example/live/42.m3u8',
            });

            expect(dataService.sendIpcEvent).toHaveBeenCalled();
        });

        it('always mints a link for an episode, whose cmd addresses the series', async () => {
            // `series` selects the episode server-side, so the parent row's
            // static cmd is not an answer even when it is unflagged.
            dataService.sendIpcEvent.mockResolvedValue({
                js: { cmd: 'http://cdn.example/tmp/ep3.m3u8' },
            });

            const streamUrl = await fetchStalkerPlaybackLink(deps(), {
                playlist: PLAYLIST,
                selectedContentType: 'series',
                cmd: 'ffrt3 http://cdn.example/series/7.m3u8',
                series: 3,
                linkFlags: {
                    use_http_tmp_link: '0',
                    use_load_balancing: '0',
                },
            });

            expect(streamUrl).toBe('http://cdn.example/tmp/ep3.m3u8');
            expect(dataService.sendIpcEvent).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({
                    params: expect.objectContaining({ series: '3' }),
                })
            );
        });

        it('still mints a link for a relative unflagged VOD command', async () => {
            dataService.sendIpcEvent.mockResolvedValue({
                js: { cmd: '/media/video_77.mpg' },
            });

            const streamUrl = await fetchStalkerPlaybackLink(deps(), {
                playlist: PLAYLIST,
                selectedContentType: 'vod',
                cmd: '/media/file_42.mpg',
                linkFlags: { use_http_tmp_link: '0' },
            });

            expect(streamUrl).toBe(
                'http://demo.example/stalker_portal/media/video_77.mpg'
            );
        });
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
