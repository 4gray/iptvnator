import { TestBed } from '@angular/core/testing';
import { DataService } from '@iptvnator/services';
import { PlaylistMeta } from '@iptvnator/shared/interfaces';
import { StalkerEpisodeResolver } from './stalker-episode-resolver.service';
import {
    mapVodSeriesEpisodes,
    StalkerMappedEpisode,
} from './stalker-series.adapters';
import { StalkerSessionService } from './stalker-session.service';
import { StalkerPortalRepairService } from './stalker-portal-repair.service';

const playlist: PlaylistMeta = {
    _id: 'fixture',
    title: 'Fixture',
    count: 0,
    autoRefresh: false,
    importDate: '',
    portalUrl: 'http://portal.example.test/portal.php',
    macAddress: '00:1A:79:18:44:01',
    isFullStalkerPortal: false,
};

function episode(cmd?: string): StalkerMappedEpisode {
    return mapVodSeriesEpisodes(
        [
            {
                id: '11',
                video_id: '10',
                season_number: '2',
                providerSeasonKey: '1',
                providerSeasonNumber: 1,
                name: 'Season 2',
                isLoading: false,
                isExpanded: true,
                episodes: [{ id: '101', series_number: 1, cmd }],
            },
        ],
        { parentSeriesId: '10' }
    )['2'][0] as StalkerMappedEpisode;
}

describe('StalkerEpisodeResolver', () => {
    const sendIpcEvent = jest.fn();
    const makeAuthenticatedRequest = jest.fn();
    let resolver: StalkerEpisodeResolver;

    beforeEach(() => {
        sendIpcEvent.mockReset();
        makeAuthenticatedRequest.mockReset();
        TestBed.configureTestingModule({
            providers: [
                StalkerEpisodeResolver,
                { provide: DataService, useValue: { sendIpcEvent } },
                {
                    provide: StalkerSessionService,
                    useValue: {
                        ensureToken: jest
                            .fn()
                            .mockResolvedValue({ token: null }),
                        makeAuthenticatedRequest,
                    },
                },
                {
                    provide: StalkerPortalRepairService,
                    useValue: {
                        applyOverride: (value: PlaylistMeta) => value,
                        shouldAttemptRepair: () => false,
                    },
                },
            ],
        });
        resolver = TestBed.inject(StalkerEpisodeResolver);
    });

    it('resolves the file ID independently of episode, tracking and displayed season IDs', async () => {
        sendIpcEvent.mockResolvedValue({
            js: {
                data: [
                    {
                        id: '201',
                        video_id: '10',
                        series_id: '101',
                        is_file: true,
                        cmd: '/media/file_201.mpg',
                    },
                ],
            },
        });
        const mapped = episode();
        const before = JSON.stringify(mapped);
        // Values produced before #1844: resolving files must not re-key progress.
        expect(mapped.id).toBe('186459068');
        expect(mapped.legacyTrackingId).toBe(624320047);
        expect(mapped.season).toBe(2);
        await expect(resolver.resolveCommand(playlist, mapped)).resolves.toBe(
            '/media/file_201.mpg'
        );
        expect(sendIpcEvent).toHaveBeenCalledWith(expect.any(String), {
            url: playlist.portalUrl,
            macAddress: playlist.macAddress,
            params: {
                action: 'get_ordered_list',
                type: 'vod',
                movie_id: '10',
                season_id: '11',
                episode_id: '101',
                p: '1',
            },
        });
        expect(JSON.stringify(mapped)).toEqual(before);
    });

    it('keeps an explicit episode command byte-for-byte without looking up a file', async () => {
        const own = 'ffmpeg http://cdn.example.test/201.mp4?x=a%2Bb';
        await expect(
            resolver.resolveCommand(playlist, episode(own))
        ).resolves.toBe(own);
        expect(sendIpcEvent).not.toHaveBeenCalled();
    });

    it.each(['201', 201])(
        'uses actual custom-protocol file ID %s for create_link',
        async (id) => {
            sendIpcEvent.mockResolvedValue({
                js: {
                    data: [
                        {
                            id,
                            is_file: true,
                            protocol: 'custom',
                            cmd: 'http://storage.example.test/alpha.mp4',
                        },
                    ],
                },
            });
            await expect(
                resolver.resolveCommand(playlist, episode())
            ).resolves.toBe('/media/file_201.mpg');
        }
    );

    it.each([undefined, '', 'invalid', '../101', 0])(
        'rejects a custom-protocol file without a valid file ID: %s',
        async (id) => {
            sendIpcEvent.mockResolvedValue({
                js: {
                    data: [
                        {
                            id,
                            is_file: true,
                            protocol: 'custom',
                            cmd: 'http://storage.example.test/alpha.mp4',
                        },
                    ],
                },
            });
            await expect(
                resolver.resolveCommand(playlist, episode())
            ).rejects.toThrow('nothing_to_play');
        }
    );

    it('uses the authenticated request pipeline in full portal mode', async () => {
        makeAuthenticatedRequest.mockResolvedValue({
            js: [{ is_file: '1', cmd: '/media/file_201.mpg' }],
        });
        await expect(
            resolver.resolveCommand(
                { ...playlist, isFullStalkerPortal: true },
                episode()
            )
        ).resolves.toBe('/media/file_201.mpg');
        expect(sendIpcEvent).not.toHaveBeenCalled();
        expect(makeAuthenticatedRequest).toHaveBeenCalledWith(
            expect.objectContaining({ _id: 'fixture' }),
            expect.objectContaining({ episode_id: '101' })
        );
    });

    it('uses the first playable video variant in provider order, excluding foreign rows and subtitles', async () => {
        sendIpcEvent.mockResolvedValue({
            js: {
                data: [
                    { is_file: true, file_type: 'sub', cmd: '/subtitle.srt' },
                    { is_file: true, video_id: '20', cmd: '/wrong-show' },
                    { is_file: true, series_id: '102', cmd: '/wrong-episode' },
                    { is_file: true, cmd: ' ' },
                    {
                        is_file: 1,
                        name: 'English HD',
                        cmd: '/media/file_201.mpg',
                    },
                    {
                        is_file: true,
                        name: 'French SD',
                        cmd: '/media/file_901.mpg',
                    },
                ],
            },
        });
        await expect(
            resolver.resolveCommand(playlist, episode())
        ).resolves.toBe('/media/file_201.mpg');
    });

    it.each([
        null,
        { js: {} },
        { js: { data: [] } },
        { js: { error: 'denied', data: [{ is_file: true, cmd: '/x' }] } },
        { js: { data: [{ id: '201', is_file: true }] } },
        { js: { data: [{ id: '101', is_episode: true, cmd: '/parent' }] } },
    ])('fails closed for absent or malformed files: %j', async (response) => {
        sendIpcEvent.mockResolvedValue(response);
        await expect(
            resolver.resolveCommand(playlist, episode())
        ).rejects.toThrow('nothing_to_play');
    });

    it('does not substitute an episode ID when provider coordinates are missing', async () => {
        await expect(
            resolver.resolveCommand(playlist, {
                ...episode(),
                vodEpisode: undefined,
            })
        ).rejects.toThrow('nothing_to_play');
        expect(sendIpcEvent).not.toHaveBeenCalled();
    });

    it('downloads using the resolved file command and the captured playlist', async () => {
        sendIpcEvent
            .mockResolvedValueOnce({
                js: {
                    data: [
                        {
                            id: '201',
                            is_file: true,
                            protocol: 'custom',
                            cmd: 'http://storage.example.test/alpha.mp4',
                        },
                    ],
                },
            })
            .mockResolvedValueOnce({
                js: { cmd: 'http://cdn.example.test/alpha/1.mp4' },
            });
        await expect(
            resolver.resolveDownload(playlist, episode())
        ).resolves.toBe('http://cdn.example.test/alpha/1.mp4');
        expect(sendIpcEvent.mock.calls[1][1]).toMatchObject({
            url: playlist.portalUrl,
            macAddress: playlist.macAddress,
            params: {
                action: 'create_link',
                cmd: '/media/file_201.mpg',
                series: '1',
                type: 'vod',
            },
        });
    });
});
