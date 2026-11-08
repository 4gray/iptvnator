import { TestBed } from '@angular/core/testing';
import { DataService } from '@iptvnator/services';
import type {
    PlaylistMeta,
    TmdbRecommendation,
} from '@iptvnator/shared/interfaces';
import { StalkerPortalRepairService } from './stalker-portal-repair.service';
import { StalkerSessionService } from './stalker-session.service';
import { StalkerSimilarService } from './stalker-similar.service';

const playlist = {
    _id: 'fixture-source',
    portalUrl: 'https://portal.example/portal.php',
    macAddress: '00:11:22:33:44:55',
} as PlaylistMeta;
const recommendation = (title: string, tmdbId = 32): TmdbRecommendation => ({
    tmdbId,
    title,
    year: 2024,
    posterUrl: null,
});

const current = {
    catalog: 'vod',
    id: '31',
    mediaType: 'movie',
    tmdbId: 31,
} as const;
const row = (id: string, name: string, year = '2024') => ({
    id,
    name,
    year,
    category_id: 'fixture-category',
});

describe(StalkerSimilarService.name, () => {
    const send = jest.fn();
    let service: StalkerSimilarService;

    beforeEach(() => {
        send.mockReset();
        TestBed.configureTestingModule({
            providers: [
                { provide: DataService, useValue: { sendIpcEvent: send } },
                {
                    provide: StalkerSessionService,
                    useValue: { ensureToken: async () => ({}) },
                },
                {
                    provide: StalkerPortalRepairService,
                    useValue: {
                        applyOverride: (source: PlaylistMeta) => source,
                        shouldAttemptRepair: () => false,
                    },
                },
            ],
        });
        service = TestBed.inject(StalkerSimilarService);
    });

    it('uses only page one, keeps order and rejects remakes, ambiguity and the current title', async () => {
        send.mockImplementation(async (_event, { params }) => ({
            js: {
                data:
                    params.search === 'Fictional Ridge'
                        ? [
                              row('31', params.search),
                              row('1', params.search, '1982'),
                              {
                                  ...row('5', 'Fictional Ridge (1982)', ''),
                                  o_name: params.search,
                              },
                              {
                                  ...row('2', params.search),
                                  screenshot_uri: '/artwork/fixture.jpg',
                              },
                          ]
                        : [row('3', params.search), row('4', params.search)],
            },
        }));
        const results = await service.match(
            playlist,
            current,
            [
                recommendation('Fictional Ridge'),
                recommendation('Fictional Quarry', 33),
                recommendation('Fictional Current', 31),
            ],
            new AbortController().signal
        );

        expect(results.map((result) => result.item.id)).toEqual(['2']);
        expect(results[0].item.info?.movie_image).toBe(
            'https://portal.example/artwork/fixture.jpg'
        );
        expect(
            send.mock.calls.map(([, { params }]) => [
                params.type,
                params.search,
                params.p,
            ])
        ).toEqual([
            ['vod', 'Fictional Ridge', 1],
            ['vod', 'Fictional Quarry', 1],
        ]);
    });

    it('allows a canonical title to end with a number that looks like a release year', async () => {
        send.mockResolvedValue({
            js: {
                data: [
                    {
                        ...row('2', 'Fictional Ridge 2049', ''),
                        o_name: 'Fictional Plateau 2049',
                    },
                ],
            },
        });

        const results = await service.match(
            playlist,
            current,
            [recommendation('Fictional Ridge 2049')],
            new AbortController().signal
        );

        expect(results.map(({ item }) => item.id)).toEqual(['2']);
    });

    it('keeps the VOD origin for embedded and Ministra series and caps the search at four titles', async () => {
        send.mockImplementation(async (_event, { params }) => {
            if (params.type === 'series')
                throw new Error('Fixture unavailable');
            const base = row(params.search, params.search);
            return {
                js: {
                    data: [
                        { ...base, id: 'movie' },
                        params.search === 'Fictional Range'
                            ? { ...base, series: [1] }
                            : { ...base, is_series: '1' },
                    ],
                },
            };
        });
        const results = await service.match(
            playlist,
            { ...current, mediaType: 'tv' },
            [
                recommendation('Fictional Range', 33),
                recommendation('Fictional River', 34),
                recommendation('Fictional Lake', 35),
                recommendation('Fictional Stream', 36),
                recommendation('Fictional Coast', 37),
            ],
            new AbortController().signal
        );

        expect(results.map(({ catalog, item }) => [catalog, item.id])).toEqual([
            ['vod', 'Fictional Range'],
            ['vod', 'Fictional River'],
            ['vod', 'Fictional Lake'],
            ['vod', 'Fictional Stream'],
        ]);
        expect(send).toHaveBeenCalledTimes(8);
    });

    it('does not start the rest of the search after leaving the title', async () => {
        const abort = new AbortController();
        send.mockImplementation(async () => {
            abort.abort();
            return { js: { data: [] } };
        });
        await service.match(
            playlist,
            { ...current, mediaType: 'tv' },
            [
                recommendation('Fictional Ridge'),
                recommendation('Fictional River', 33),
                recommendation('Fictional Lake', 34),
            ],
            abort.signal
        );
        expect(send.mock.calls.length).toBeLessThanOrEqual(2);
    });
});
