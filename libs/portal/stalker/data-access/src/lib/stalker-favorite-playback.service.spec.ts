import { TestBed } from '@angular/core/testing';
import { DataService, ParentalLockService } from '@iptvnator/services';
import { PlaylistMeta, StalkerPortalItem } from '@iptvnator/shared/interfaces';
import { StalkerSessionService } from './stalker-session.service';
import { StalkerPortalRepairService } from './stalker-portal-repair.service';
import { StalkerFavoritePlaybackResolver } from './stalker-favorite-playback.service';

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
    it('rechecks the resolved provider category against local parental locks', async () => {
        locked.mockReturnValue(true);
        send.mockResolvedValue({
            js: {
                data: [
                    {
                        id: '42',
                        category_id: '17',
                        cmd: 'synthetic-provider-command',
                    },
                ],
                total_items: 1,
                max_page_items: 1,
            },
        });
        await expect(
            resolver.resolve(playlist, { id: '42', favoriteContentType: 'vod' })
        ).rejects.toThrow('nothing_to_play');
        expect(locked).toHaveBeenCalledWith('synthetic-source', 'vod', '17');
    });
});
