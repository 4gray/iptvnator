import { TestBed } from '@angular/core/testing';
import {
    XTREAM_DATA_SOURCE,
    XtreamApiService,
    XtreamUrlService,
} from '@iptvnator/portal/xtream/data-access';
import type { VodSourceCandidate } from '@iptvnator/shared/interfaces';
import { VodSourceResolverService } from './vod-source-resolver.service';

describe('VodSourceResolverService', () => {
    const candidate: VodSourceCandidate = {
        id: 'fixture-movie',
        playlistId: 'fixture-source',
        playlistName: 'Fixture source',
        portalType: 'xtream',
        contentId: 42,
        rawTitle: 'Fixture movie',
        matchConfidence: 'exact',
        posterUrl: null,
    };
    const credentials = {
        serverUrl: 'https://portal.example.test',
        username: 'demo',
        password: 'fixture',
    };
    const getVodInfo = jest.fn();
    const getVodStream = jest.fn();
    let resolver: VodSourceResolverService;

    beforeEach(() => {
        getVodInfo.mockReset().mockResolvedValue({ info: [] });
        getVodStream.mockReset().mockResolvedValue({
            stream_id: 42,
            container_extension: 'mp4',
        });
        TestBed.configureTestingModule({
            providers: [
                {
                    provide: XTREAM_DATA_SOURCE,
                    useValue: {
                        getPlaylist: jest.fn().mockResolvedValue(credentials),
                    },
                },
                {
                    provide: XtreamApiService,
                    useValue: { getVodInfo, getVodStream },
                },
                XtreamUrlService,
            ],
        });
        resolver = TestBed.inject(VodSourceResolverService);
    });

    it('recovers sparse movie details from the selected provider category and keeps the resume point', async () => {
        await expect(
            resolver.resolve(candidate, { categoryId: 701, startTime: 32 })
        ).resolves.toMatchObject({
            playback: {
                streamUrl:
                    'https://portal.example.test/movie/demo/fixture/42.mp4',
                startTime: 32,
                contentInfo: {
                    playlistId: 'fixture-source',
                    contentXtreamId: 42,
                },
            },
        });
        expect(getVodStream).toHaveBeenCalledWith(
            expect.objectContaining(credentials),
            42,
            701
        );
    });

    it('stops catalog recovery after the movie becomes unavailable', async () => {
        let isCurrent = true;
        getVodStream.mockImplementation(async () => {
            isCurrent = false;
            return { stream_id: 42, container_extension: 'mp4' };
        });
        await expect(
            resolver.resolve(candidate, {
                categoryId: 701,
                isCurrent: () => isCurrent,
            })
        ).resolves.toBeNull();
        expect(getVodStream).toHaveBeenCalledTimes(1);
    });

    it('plays complete details without taking a catalog request', async () => {
        getVodInfo.mockResolvedValue({
            movie_data: { stream_id: 42, container_extension: 'mkv' },
        });
        await expect(
            resolver.resolve(candidate, { categoryId: 701 })
        ).resolves.toMatchObject({
            playback: {
                streamUrl:
                    'https://portal.example.test/movie/demo/fixture/42.mkv',
            },
        });
        expect(getVodStream).not.toHaveBeenCalled();
    });
});
