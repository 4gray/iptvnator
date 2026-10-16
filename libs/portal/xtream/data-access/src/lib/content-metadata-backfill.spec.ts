import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { registerContentMetadataBackfill } from './content-metadata-backfill';

describe('detail metadata favorite status ordering', () => {
    it('checks persisted identity after backfill, not the earlier sparse row', async () => {
        let finish!: () => void;
        let persisted = false;
        const status = jest.fn(async () => {
            expect(persisted).toBe(true);
        });
        TestBed.runInInjectionContext(() =>
            registerContentMetadataBackfill({
                store: {
                    currentPlaylist: signal({ id: 'p1' }),
                    backfillContentMetadata: () =>
                        new Promise<void>((resolve) => {
                            finish = () => {
                                persisted = true;
                                resolve();
                            };
                        }),
                    checkFavoriteStatus: status,
                },
                playlistId: () => 'p1',
                xtreamId: () => 42,
                contentType: 'movie',
                info: () => ({ tmdb_id: 200 }),
            })
        );
        TestBed.tick();
        expect(status).not.toHaveBeenCalled();
        finish();
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(status).toHaveBeenCalledWith(42, 'p1', 'movie', { tmdbId: 200 });
    });

    it('refreshes identity after leaving and returning to the same detail', async () => {
        const info = signal<{ tmdb_id: number } | null>({ tmdb_id: 200 });
        const status = jest.fn().mockResolvedValue(undefined);
        TestBed.runInInjectionContext(() =>
            registerContentMetadataBackfill({
                store: {
                    currentPlaylist: signal({ id: 'p1' }),
                    backfillContentMetadata: async () => undefined,
                    checkFavoriteStatus: status,
                },
                playlistId: () => 'p1',
                xtreamId: () => 42,
                contentType: 'movie',
                info,
            })
        );
        TestBed.tick();
        await new Promise((resolve) => setTimeout(resolve, 0));
        info.set(null);
        TestBed.tick();
        info.set({ tmdb_id: 200 });
        TestBed.tick();
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(status).toHaveBeenCalledTimes(2);
    });

    it('does not recheck an old detail after its delayed write completes', async () => {
        const id = signal(42);
        let finishOld!: () => void;
        const status = jest.fn().mockResolvedValue(undefined);
        TestBed.runInInjectionContext(() =>
            registerContentMetadataBackfill({
                store: {
                    currentPlaylist: signal({ id: 'p1' }),
                    backfillContentMetadata: ({ xtreamId }) =>
                        xtreamId === 42
                            ? new Promise<void>((resolve) => {
                                  finishOld = resolve;
                              })
                            : Promise.resolve(),
                    checkFavoriteStatus: status,
                },
                playlistId: () => 'p1',
                xtreamId: id,
                contentType: 'movie',
                info: () => ({ tmdb_id: 200 }),
            })
        );
        TestBed.tick();
        id.set(43);
        TestBed.tick();
        await new Promise((resolve) => setTimeout(resolve, 0));
        status.mockClear();
        finishOld();
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(status).not.toHaveBeenCalled();
    });
});
