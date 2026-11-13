import { loadStalkerItvGenre } from './stalker-itv-genre-loader';
import { PlaylistMeta } from '@iptvnator/shared/interfaces';
import { StalkerRequestDeps } from './stores/utils';

describe('loadStalkerItvGenre', () => {
    const playlist = {
        _id: 'synthetic',
        portalUrl: 'https://portal.example.test',
        macAddress: '00:1A:79:00:00:01',
        isFullStalkerPortal: false,
    } as PlaylistMeta;
    function deps(send: jest.Mock): StalkerRequestDeps {
        return {
            dataService: { sendIpcEvent: send },
            stalkerSession: {
                ensureToken: jest.fn().mockResolvedValue({ token: null }),
            },
        } as unknown as StalkerRequestDeps;
    }
    it('loads every genre page and preserves playback flags without touching a store', async () => {
        const send = jest.fn().mockImplementation((_event, request) =>
            Promise.resolve({
                js: {
                    total_items: 3,
                    max_page_items: 2,
                    data:
                        request.params.p === 1
                            ? [
                                  {
                                      id: 1,
                                      cmd: 'stream one',
                                      use_http_tmp_link: '1',
                                  },
                                  { id: 2, cmd: 'stream two' },
                              ]
                            : [{ id: 3, cmd: 'stream three' }],
                },
            })
        );
        const rows = await loadStalkerItvGenre(
            deps(send),
            playlist,
            'genre',
            new AbortController().signal
        );
        expect(rows.map((c) => c.id)).toEqual([1, 2, 3]);
        expect(rows[0]).toMatchObject({
            tv_genre_id: 'genre',
            use_http_tmp_link: '1',
        });
        expect(send.mock.calls.map((c) => c[1].params.p)).toEqual([1, 2]);
        expect(send.mock.calls[0][1].params).toMatchObject({
            type: 'itv',
            genre: 'genre',
            category: 'genre',
            action: 'get_ordered_list',
        });
    });
    it('does not fetch another page after the picker cancels the request', async () => {
        const abort = new AbortController();
        const send = jest.fn().mockImplementation(() => {
            abort.abort();
            return Promise.resolve({
                js: { total_items: 5, max_page_items: 1, data: [{ id: 1 }] },
            });
        });
        await expect(
            loadStalkerItvGenre(deps(send), playlist, 'genre', abort.signal)
        ).rejects.toThrow();
        expect(send).toHaveBeenCalledTimes(1);
    });
    it('deduplicates channels and stops when a portal repeats a page', async () => {
        const send = jest.fn().mockResolvedValue({
            js: {
                total_items: 30000,
                max_page_items: 3,
                data: [{ id: 1 }, { id: 1 }, { id: '', stream_id: 2 }],
            },
        });
        const rows = await loadStalkerItvGenre(
            deps(send),
            playlist,
            'genre',
            new AbortController().signal
        );
        expect(rows.map((c) => c.id)).toEqual([1, 2]);
        expect(send).toHaveBeenCalledTimes(2);
    });
});
