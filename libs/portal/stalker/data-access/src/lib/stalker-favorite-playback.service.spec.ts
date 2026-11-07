import { TestBed } from '@angular/core/testing';
import { DataService, ParentalLockService } from '@iptvnator/services';
import { PlaylistMeta, StalkerPortalItem } from '@iptvnator/shared/interfaces';
import { StalkerSessionService } from './stalker-session.service';
import { StalkerPortalRepairService } from './stalker-portal-repair.service';
import { StalkerFavoritePlaybackResolver } from './stalker-favorite-playback.service';
import { buildStalkerSelectedVodItem } from './stalker-vod.utils';

const playlist = {
    _id: 'synthetic-source',
    portalUrl: 'http://synthetic.invalid/load.php',
    macAddress: '00:11:22:33:44:55',
    isFullStalkerPortal: false,
} as PlaylistMeta;
describe('receiving-device Stalker favorite playback', () => {
    let send: jest.Mock;
    let locked: jest.Mock;
    let resolver: StalkerFavoritePlaybackResolver;
    beforeEach(() => {
        send = jest.fn();
        locked = jest.fn(() => false);
        TestBed.configureTestingModule({
            providers: [
                StalkerFavoritePlaybackResolver,
                { provide: DataService, useValue: { sendIpcEvent: send } },
                {
                    provide: ParentalLockService,
                    useValue: { isStalkerCategoryLocked: locked },
                },
                {
                    provide: StalkerSessionService,
                    useValue: {
                        ensureToken: jest.fn(async () => ({ token: '' })),
                    },
                },
                {
                    provide: StalkerPortalRepairService,
                    useValue: {
                        applyOverride: (value: unknown) => value,
                        shouldAttemptRepair: () => false,
                    },
                },
            ],
        });
        resolver = TestBed.inject(StalkerFavoritePlaybackResolver);
    });
    it.each([
        { favoriteContentType: 'vod' },
        { favoriteContentType: 'itv' },
        { favoriteContentType: 'radio' },
        { favoriteContentType: 'series' },
        { favoriteContentType: 'vod', series: [1, 2] },
        { favoriteContentType: 'vod', is_series: true },
    ] as Partial<StalkerPortalItem>[])(
        'resolves exact provider identity and keeps local command/flags for %j',
        async (shape) => {
            const snapshot = {
                id: '42',
                title: 'Synthetic remote favorite',
                ...shape,
            } as StalkerPortalItem;
            const row = {
                id: '42',
                name: 'Synthetic current provider title',
                cmd: 'synthetic-provider-command',
                use_http_tmp_link: '1',
                category_id: '17',
                ...shape,
            };
            send.mockResolvedValue({
                js: {
                    data: [{ ...row, id: '43' }, row],
                    total_items: 2,
                    max_page_items: 2,
                },
            });
            expect(await resolver.resolve(playlist, snapshot)).toMatchObject({
                id: '42',
                cmd: row.cmd,
                use_http_tmp_link: '1',
            });
            expect(snapshot.cmd).toBeUndefined();
        }
    );
    it('resolves presentation for a commandless regular series without making it playable', async () => {
        const item = {
            id: '42',
            title: 'Synthetic received series',
            favoriteContentType: 'series' as const,
        };
        send.mockResolvedValue({
            js: {
                data: [
                    {
                        id: '42',
                        name: 'Synthetic provider series',
                        cover: 'https://artwork.example/series.jpg',
                    },
                ],
                total_items: 1,
                max_page_items: 1,
            },
        });
        expect(await resolver.metadata(playlist, item)).toMatchObject({
            id: '42',
            cover: 'https://artwork.example/series.jpg',
        });
        await expect(resolver.resolve(playlist, item)).rejects.toThrow(
            'nothing_to_play'
        );
    });
    it.each(['itv', 'radio', 'vod', 'series'] as const)(
        'resolves the persisted stream alias for %s while retaining a legacy ID',
        async (kind) => {
            const row = {
                id: '42',
                stream_id: '84',
                cmd: 'synthetic-provider-command',
                category_id: '17',
            };
            send.mockResolvedValue({
                js: { data: [row], total_items: 1, max_page_items: 1 },
            });
            for (const id of ['84', '42']) {
                expect(
                    await resolver.resolve(playlist, {
                        id,
                        favoriteContentType: kind,
                        title: 'Synthetic alias favorite',
                    })
                ).toMatchObject({ id, cmd: row.cmd });
            }
        }
    );
    it.each([
        { id: '84', stream_id: '99' },
        { id: '42', stream_id: '84' },
    ])(
        'refuses ambiguous alias commands across search pages (%j)',
        async (second) => {
            send.mockImplementation(async (_event, { params }) => ({
                js: {
                    data: [
                        Number(params.p) === 1
                            ? {
                                  id: '42',
                                  stream_id: '84',
                                  cmd: 'synthetic-first-command',
                              }
                            : {
                                  ...second,
                                  cmd: 'synthetic-second-command',
                              },
                    ],
                    total_items: 2,
                    max_page_items: 1,
                },
            }));
            await expect(
                resolver.resolve(playlist, {
                    id: '84',
                    favoriteContentType: 'vod',
                    title: 'Synthetic ambiguous favorite',
                })
            ).rejects.toThrow('nothing_to_play');
        }
    );
    it('does not accept a title-filtered legacy alias before checking the canonical stream identity', async () => {
        const legacy = {
            id: '84',
            stream_id: '99',
            cmd: 'synthetic-legacy-command',
        };
        send.mockImplementation(async (_event, { params }) => ({
            js: {
                data: params.search
                    ? [legacy]
                    : [
                          {
                              id: '42',
                              stream_id: '84',
                              cmd: 'synthetic-canonical-command',
                          },
                          legacy,
                      ],
                total_items: params.search ? 1 : 2,
                max_page_items: 2,
            },
        }));
        await expect(
            resolver.resolve(playlist, {
                id: '84',
                favoriteContentType: 'vod',
                title: 'Synthetic older title',
            })
        ).rejects.toThrow('nothing_to_play');
    });
    it('keeps a legacy-only alias unavailable when the unfiltered lookup reaches its page bound', async () => {
        const legacy = {
            id: '84',
            stream_id: '99',
            cmd: 'synthetic-legacy-command',
        };
        send.mockImplementation(async (_event, { params }) => ({
            js: {
                data: [legacy],
                total_items: params.search ? 1 : 10000,
                max_page_items: 1,
            },
        }));
        await expect(
            resolver.resolve(playlist, {
                id: '84',
                favoriteContentType: 'vod',
                title: 'Synthetic older title',
            })
        ).rejects.toThrow('nothing_to_play');
        expect(
            send.mock.calls.filter(([, request]) => !request.params.search)
        ).toHaveLength(20);
    });
    it('keeps an ordinary canonical favorite on its first matching page', async () => {
        send.mockResolvedValue({
            js: {
                data: [{ id: '42', cmd: 'synthetic-canonical-command' }],
                total_items: 10000,
                max_page_items: 1,
            },
        });
        expect(
            await resolver.resolve(playlist, {
                id: '42',
                favoriteContentType: 'vod',
                title: 'Synthetic canonical favorite',
            })
        ).toMatchObject({ id: '42', cmd: 'synthetic-canonical-command' });
        expect(send).toHaveBeenCalledTimes(1);
    });
    it('uses the normalized movie title to find an exact ID beyond the unfiltered page bound', async () => {
        const selected = buildStalkerSelectedVodItem({
            id: '42',
            title: 'Synthetic remote movie',
        });
        send.mockImplementation(async (_event, { params }) => ({
            js: {
                data:
                    params.search === 'Synthetic remote movie'
                        ? [{ id: '42', cmd: 'synthetic-provider-command' }]
                        : [{ id: '43', cmd: 'synthetic-other-command' }],
                total_items: params.search ? 1 : 10000,
                max_page_items: 1,
            },
        }));
        expect(
            await resolver.resolve(playlist, {
                ...selected,
                favoriteContentType: 'vod',
            })
        ).toMatchObject({ id: '42', cmd: 'synthetic-provider-command' });
        expect(send).toHaveBeenCalledTimes(1);
        expect(send.mock.calls[0][1].params.search).toBe(
            'Synthetic remote movie'
        );
    });
    it('falls back to exact-ID paging when bulk live lookup is unsupported', async () => {
        send.mockRejectedValueOnce(
            new Error('Unsupported bulk lookup')
        ).mockResolvedValue({
            js: {
                data: [{ id: '42', cmd: 'synthetic-live-command' }],
                total_items: 1,
                max_page_items: 1,
            },
        });
        expect(
            await resolver.resolve(playlist, {
                id: '42',
                favoriteContentType: 'itv',
            })
        ).toMatchObject({ cmd: 'synthetic-live-command' });
    });
    it('does not infer an identity from a matching title or substitute a different series origin', async () => {
        send.mockResolvedValue({
            js: {
                data: [
                    {
                        id: '43',
                        title: 'Synthetic remote favorite',
                        cmd: 'wrong',
                    },
                    { id: '42', is_series: true, cmd: 'wrong-origin' },
                ],
                total_items: 2,
                max_page_items: 2,
            },
        });
        await expect(
            resolver.resolve(playlist, {
                id: '42',
                favoriteContentType: 'vod',
                title: 'Synthetic remote favorite',
            })
        ).rejects.toThrow('nothing_to_play');
    });
    it.each(['42', '84'])(
        'rechecks parental locks for resolved provider identity %s',
        async (id) => {
            locked.mockReturnValue(true);
            send.mockResolvedValue({
                js: {
                    data: [
                        {
                            id: '42',
                            stream_id: '84',
                            category_id: '17',
                            cmd: 'synthetic-provider-command',
                        },
                    ],
                    total_items: 1,
                    max_page_items: 1,
                },
            });
            await expect(
                resolver.resolve(playlist, { id, favoriteContentType: 'vod' })
            ).rejects.toThrow('nothing_to_play');
            expect(locked).toHaveBeenCalledWith(
                'synthetic-source',
                'vod',
                '17'
            );
        }
    );
});
