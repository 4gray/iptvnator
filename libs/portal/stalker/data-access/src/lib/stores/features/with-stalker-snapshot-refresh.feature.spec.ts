import { TestBed } from '@angular/core/testing';
import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';
import { DataService } from '@iptvnator/services';
import { PlaylistMeta } from '@iptvnator/shared/interfaces';
import { StalkerVodSource } from '../../models';
import { StalkerSessionService } from '../../stalker-session.service';
import { withStalkerSnapshotRefresh } from './with-stalker-snapshot-refresh.feature';

const PLAYLIST = {
    _id: 'portal-1',
    title: 'Demo Stalker',
    portalUrl: 'http://demo.example/stalker_portal/server/load.php',
    macAddress: '00:1A:79:00:00:01',
    // Explicit: with the flag undefined the shared predicate would fall back
    // to the URL shape, classify this as a full portal and route through the
    // (empty) session mock instead of the DataService mock under test.
    isFullStalkerPortal: false,
} as PlaylistMeta;

const SNAPSHOT: StalkerVodSource = {
    id: '20001',
    cmd: '/media/file_20001.mpg',
    series: [1],
    category_id: '12',
    info: { name: 'Embedded Series' },
};

const TestSnapshotRefreshStore = signalStore(
    withState<{
        currentPlaylist: PlaylistMeta | undefined;
        selectedItem: StalkerVodSource | null | undefined;
    }>({
        currentPlaylist: PLAYLIST,
        selectedItem: SNAPSHOT,
    }),
    withMethods((store) => ({
        setCurrentPlaylist(playlist: PlaylistMeta | undefined) {
            patchState(store, { currentPlaylist: playlist });
        },
        setSelectedItem(selectedItem: StalkerVodSource | null | undefined) {
            patchState(store, { selectedItem });
        },
    })),
    withStalkerSnapshotRefresh()
);

describe('withStalkerSnapshotRefresh', () => {
    let store: InstanceType<typeof TestSnapshotRefreshStore>;
    let dataService: { sendIpcEvent: jest.Mock };

    const mockPortalRows = (rows: unknown[]) => {
        dataService.sendIpcEvent.mockResolvedValue({ js: { data: rows } });
    };

    beforeEach(() => {
        dataService = { sendIpcEvent: jest.fn() };

        TestBed.configureTestingModule({
            providers: [
                TestSnapshotRefreshStore,
                { provide: DataService, useValue: dataService },
                { provide: StalkerSessionService, useValue: {} },
            ],
        });

        store = TestBed.inject(TestSnapshotRefreshStore);
    });

    it('patches the selection when new episodes appeared', async () => {
        mockPortalRows([
            { id: '20001', cmd: '/media/file_20001.mpg', series: [1, 2] },
        ]);

        await expect(store.refreshEmbeddedSeriesSelection()).resolves.toBe(
            true
        );

        expect(dataService.sendIpcEvent).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                params: expect.objectContaining({
                    action: 'get_ordered_list',
                    type: 'vod',
                    category: '12',
                    search: 'Embedded Series',
                }),
            })
        );
        expect(store.selectedItem()?.series).toEqual([1, 2]);
    });

    it('updates a stale playback cmd even when the episode list is unchanged', async () => {
        mockPortalRows([
            { id: '20001', cmd: '/media/file_20001_v2.mpg', series: [1] },
        ]);

        await expect(store.refreshEmbeddedSeriesSelection()).resolves.toBe(
            true
        );

        expect(store.selectedItem()?.cmd).toBe('/media/file_20001_v2.mpg');
    });

    it('does nothing when the portal returns identical data', async () => {
        mockPortalRows([
            { id: '20001', cmd: '/media/file_20001.mpg', series: [1] },
        ]);

        await expect(store.refreshEmbeddedSeriesSelection()).resolves.toBe(
            false
        );

        expect(store.selectedItem()?.series).toEqual([1]);
    });

    it('retries with the wildcard category when the snapshot category misses', async () => {
        dataService.sendIpcEvent
            .mockResolvedValueOnce({ js: { data: [] } })
            .mockResolvedValueOnce({
                js: {
                    data: [
                        {
                            id: '20001',
                            cmd: '/media/file_20001.mpg',
                            series: [1, 2, 3],
                        },
                    ],
                },
            });

        await expect(store.refreshEmbeddedSeriesSelection()).resolves.toBe(
            true
        );

        expect(dataService.sendIpcEvent).toHaveBeenCalledTimes(2);
        expect(dataService.sendIpcEvent).toHaveBeenLastCalledWith(
            expect.anything(),
            expect.objectContaining({
                params: expect.objectContaining({ category: '*' }),
            })
        );
        expect(store.selectedItem()?.series).toEqual([1, 2, 3]);
    });

    it('searches with the wildcard category when the snapshot category is a routing artifact', async () => {
        store.setSelectedItem({ ...SNAPSHOT, category_id: 'series' });
        mockPortalRows([
            { id: '20001', cmd: '/media/file_20001.mpg', series: [1, 2] },
        ]);

        await expect(store.refreshEmbeddedSeriesSelection()).resolves.toBe(
            true
        );

        expect(dataService.sendIpcEvent).toHaveBeenCalledTimes(1);
        expect(dataService.sendIpcEvent).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                params: expect.objectContaining({ category: '*' }),
            })
        );
    });

    it('finds the item on a later search page when page 1 is full of other matches', async () => {
        const filler = Array.from({ length: 14 }, (_, i) => ({
            id: `9${i}`,
            series: [1],
        }));
        dataService.sendIpcEvent
            .mockResolvedValueOnce({
                js: {
                    data: filler,
                    total_items: 15,
                    max_page_items: 14,
                    total_pages: 2,
                },
            })
            .mockResolvedValueOnce({
                js: {
                    data: [
                        {
                            id: '20001',
                            cmd: '/media/file_20001.mpg',
                            series: [1, 2],
                        },
                    ],
                    total_items: 15,
                    max_page_items: 14,
                    total_pages: 2,
                },
            });

        await expect(store.refreshEmbeddedSeriesSelection()).resolves.toBe(
            true
        );

        expect(dataService.sendIpcEvent).toHaveBeenCalledTimes(2);
        expect(dataService.sendIpcEvent).toHaveBeenLastCalledWith(
            expect.anything(),
            expect.objectContaining({
                params: expect.objectContaining({ p: 2 }),
            })
        );
        expect(store.selectedItem()?.series).toEqual([1, 2]);
    });

    it('never patches after the active portal changed while the request was in flight', async () => {
        dataService.sendIpcEvent.mockImplementation(async () => {
            // Same item id, but the user switched to another portal
            store.setCurrentPlaylist({
                ...PLAYLIST,
                _id: 'portal-2',
            } as PlaylistMeta);
            return {
                js: {
                    data: [
                        {
                            id: '20001',
                            cmd: '/media/other_portal.mpg',
                            series: [1, 2, 3, 4],
                        },
                    ],
                },
            };
        });

        await expect(store.refreshEmbeddedSeriesSelection()).resolves.toBe(
            false
        );

        expect(store.selectedItem()?.series).toEqual([1]);
        expect(store.selectedItem()?.cmd).toBe('/media/file_20001.mpg');
    });

    it('never patches a selection that changed while the request was in flight', async () => {
        dataService.sendIpcEvent.mockImplementation(async () => {
            store.setSelectedItem({
                id: '99999',
                series: [1],
                info: { name: 'Другой сериал' },
            });
            return {
                js: {
                    data: [
                        {
                            id: '20001',
                            cmd: '/media/file_20001.mpg',
                            series: [1, 2],
                        },
                    ],
                },
            };
        });

        await expect(store.refreshEmbeddedSeriesSelection()).resolves.toBe(
            false
        );

        expect(store.selectedItem()?.id).toBe('99999');
        expect(store.selectedItem()?.series).toEqual([1]);
    });

    it('skips selections without an embedded episode list', async () => {
        store.setSelectedItem({
            id: '555',
            cmd: '/media/file_555.mpg',
            info: { name: 'Plain Movie' },
        });

        await expect(store.refreshEmbeddedSeriesSelection()).resolves.toBe(
            false
        );

        expect(dataService.sendIpcEvent).not.toHaveBeenCalled();
    });

    it('resolves false when the portal request fails', async () => {
        dataService.sendIpcEvent.mockRejectedValue(new Error('portal down'));

        await expect(store.refreshEmbeddedSeriesSelection()).resolves.toBe(
            false
        );

        expect(store.selectedItem()?.series).toEqual([1]);
    });

});
