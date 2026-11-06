import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { PlaylistMeta } from '@iptvnator/shared/interfaces';
import { SortBy, SortOrder, SortService } from './sort.service';

const playlist = (
    id: string,
    fields: Partial<PlaylistMeta> = {}
): PlaylistMeta => ({
    _id: id,
    title: id,
    count: 0,
    importDate: '2026-01-01T00:00:00.000Z',
    autoRefresh: false,
    ...fields,
});

describe('SortService', () => {
    const create = () => {
        TestBed.configureTestingModule({ providers: [SortService] });
        return TestBed.inject(SortService);
    };

    beforeEach(() => localStorage.clear());
    afterEach(() => TestBed.resetTestingModule());

    it('sorts by the last refresh, falling back to the import date', () => {
        const ids = create()
            .sortPlaylists(
                [
                    playlist('old', { importDate: '2025-01-01T00:00:00Z' }),
                    playlist('refreshed', {
                        importDate: '2024-01-01T00:00:00Z',
                        updateDate: Date.parse('2026-06-01T00:00:00Z'),
                    }),
                    playlist('new', { importDate: '2026-03-01T00:00:00Z' }),
                ],
                { by: SortBy.UPDATED, order: SortOrder.DESC }
            )
            .map((item) => item._id);
        expect(ids).toEqual(['refreshed', 'new', 'old']);
    });

    it('sorts by name as the list shows it, when told how', () => {
        const sources = [
            playlist('zed', { title: 'zed' }),
            playlist('url', { title: 'get.php?username=zzz&password=x' }),
            playlist('mid', { title: 'mid' }),
        ];
        const service = create();
        const byTitle = service
            .sortPlaylists(sources, { by: SortBy.NAME, order: SortOrder.ASC })
            .map((item) => item._id);
        expect(byTitle).toEqual(['url', 'mid', 'zed']);

        // The URL-named source shows as its host, "abc.test".
        const shown = (item: PlaylistMeta) =>
            item._id === 'url' ? 'abc.test' : item.title;
        const byShownName = service
            .sortPlaylists(
                sources,
                { by: SortBy.NAME, order: SortOrder.DESC },
                shown
            )
            .map((item) => item._id);
        expect(byShownName).toEqual(['zed', 'mid', 'url']);
    });

    it('sorts by channel count, with no count as zero', () => {
        const ids = create()
            .sortPlaylists(
                [
                    playlist('xtream', {
                        count: undefined as unknown as number,
                    }),
                    playlist('big', { count: 900 }),
                    playlist('small', { count: 3 }),
                ],
                { by: SortBy.CHANNELS, order: SortOrder.DESC }
            )
            .map((item) => item._id);
        expect(ids).toEqual(['big', 'small', 'xtream']);
    });

    it('keeps the failing-first choice across a restart', async () => {
        create().setSortOptions({
            by: SortBy.NAME,
            order: SortOrder.ASC,
            failingFirst: true,
        });
        TestBed.resetTestingModule();
        expect(await firstValueFrom(create().getSortOptions())).toEqual({
            by: SortBy.NAME,
            order: SortOrder.ASC,
            failingFirst: true,
        });
    });

    it('falls back to newest first for an unknown saved sort', async () => {
        localStorage.setItem(
            'iptvnator-sort-options',
            JSON.stringify({ by: 'size', order: 'asc' })
        );
        expect(await firstValueFrom(create().getSortOptions())).toEqual({
            by: SortBy.DATE_ADDED,
            order: SortOrder.DESC,
        });
    });
});
