import {
    fetchStalkerSeriesPages,
    StalkerSeriesPage,
} from './stalker-series-pagination';

type Row = { id: string | number };
const current = () => true;

describe('fetchStalkerSeriesPages', () => {
    it.each([{ js: [{ id: '1' }] }, { js: { data: [{ id: '1' }] } }])(
        'preserves legacy single-response lists: %p',
        async (response) => {
            const request = jest.fn().mockResolvedValue(response);
            await expect(
                fetchStalkerSeriesPages(request, current)
            ).resolves.toEqual([{ id: '1' }]);
            expect(request).toHaveBeenCalledTimes(1);
        }
    );

    it('deduplicates numeric/string IDs across overlapping pages', async () => {
        const request = jest
            .fn()
            .mockResolvedValueOnce({
                js: { total_items: 3, data: [{ id: 1 }, { id: 2 }] },
            })
            .mockResolvedValueOnce({ js: { data: [{ id: '2' }, { id: 3 }] } });
        await expect(
            fetchStalkerSeriesPages(request, current)
        ).resolves.toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    });

    it('uses the server page size when no total is provided', async () => {
        const request = jest
            .fn()
            .mockResolvedValueOnce({
                js: { max_page_items: '2', data: [{ id: 1 }, { id: 2 }] },
            })
            .mockResolvedValueOnce({
                js: { max_page_items: '2', data: [{ id: 3 }] },
            });
        await expect(
            fetchStalkerSeriesPages(request, current)
        ).resolves.toHaveLength(3);
        expect(request.mock.calls).toEqual([[1], [2]]);
    });

    it('supports a declared page count without an item total', async () => {
        const request = jest
            .fn()
            .mockResolvedValueOnce({
                js: { total_pages: '2', data: [{ id: 1 }] },
            })
            .mockResolvedValueOnce({ js: { data: [{ id: 2 }] } });
        await expect(
            fetchStalkerSeriesPages(request, current)
        ).resolves.toHaveLength(2);
    });

    it('rejects a repeated page instead of counting duplicates as completion', async () => {
        const request = jest
            .fn()
            .mockResolvedValue({ js: { total_items: 58, data: [{ id: 1 }] } });
        await expect(fetchStalkerSeriesPages(request, current)).rejects.toThrow(
            'no progress'
        );
        expect(request).toHaveBeenCalledTimes(2);
    });

    it.each([{ js: { data: [] } }, { js: {} }])(
        'rejects an incomplete later page: %p',
        async (response) => {
            const request = jest
                .fn()
                .mockResolvedValueOnce({
                    js: { total_items: 2, data: [{ id: 1 }] },
                })
                .mockResolvedValueOnce(response);
            await expect(
                fetchStalkerSeriesPages(request, current)
            ).rejects.toThrow();
        }
    );

    it('accepts a well-formed empty list', async () => {
        await expect(
            fetchStalkerSeriesPages(
                async () => ({
                    js: { total_items: 0, total_pages: 1, data: [] },
                }),
                current
            )
        ).resolves.toEqual([]);
    });

    it('rejects an empty declared final page without an item total', async () => {
        const request = jest
            .fn()
            .mockResolvedValueOnce({
                js: { total_pages: 2, data: [{ id: 1 }] },
            })
            .mockResolvedValueOnce({ js: { data: [] } });
        await expect(fetchStalkerSeriesPages(request, current)).rejects.toThrow(
            'Incomplete'
        );
    });

    it('rejects rows without a usable provider ID', async () => {
        const request = jest
            .fn()
            .mockResolvedValue({ js: { data: [{ id: '' }] } });
        await expect(fetchStalkerSeriesPages(request, current)).rejects.toThrow(
            'Malformed'
        );
    });

    it('stops before the next request when the owner changes during a page', async () => {
        let active = true;
        const request = jest.fn(async (): Promise<StalkerSeriesPage<Row>> => {
            active = false;
            return { js: { total_items: 2, data: [{ id: 1 }] } };
        });
        await expect(
            fetchStalkerSeriesPages(request, () => active)
        ).rejects.toMatchObject({ name: 'AbortError' });
        expect(request).toHaveBeenCalledTimes(1);
    });

    it('bounds requests even when a broken server keeps returning new IDs', async () => {
        const request = jest.fn(async (page: number) => ({
            js: { total_items: 1001, data: [{ id: page }] },
        }));
        await expect(fetchStalkerSeriesPages(request, current)).rejects.toThrow(
            '1000 pages'
        );
        expect(request).toHaveBeenCalledTimes(1000);
    });
});
