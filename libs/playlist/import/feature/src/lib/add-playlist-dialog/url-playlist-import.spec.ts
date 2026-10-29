import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { DataService } from '@iptvnator/services';
import { Playlist } from '@iptvnator/shared/interfaces';
import { RENDERER_PERFORMANCE_PHASE_HOOK_KEY } from '@iptvnator/shared/logging';
import { createUrlPlaylistImport } from './url-playlist-import';

describe('dialog-owned URL playlist import', () => {
    const hookSymbol = Symbol.for(RENDERER_PERFORMANCE_PHASE_HOOK_KEY);
    const draft = { playlistUrl: 'https://fixture.example/list.m3u' };
    let fetchPlaylistDefinition: jest.Mock;
    let dispatch: jest.Mock;
    let state: ReturnType<typeof createUrlPlaylistImport>;
    let resolve: (playlist: Playlist) => void;
    let completed: jest.Mock;
    const playlist = { _id: 'fixture', title: 'Fetched playlist' } as Playlist;

    beforeEach(() => {
        fetchPlaylistDefinition = jest.fn(
            () =>
                new Promise<Playlist>((r) => {
                    resolve = r;
                })
        );
        dispatch = jest.fn();
        completed = jest.fn();
        TestBed.configureTestingModule({
            providers: [
                { provide: Store, useValue: { dispatch } },
                { provide: DataService, useValue: { fetchPlaylistDefinition } },
            ],
        });
        state = TestBed.runInInjectionContext(createUrlPlaylistImport);
    });

    afterEach(() => Reflect.deleteProperty(globalThis, hookSymbol));

    it('keeps dispatch inside the existing benchmark phase boundary', async () => {
        const boundaries: string[] = [];
        Reflect.set(
            globalThis,
            hookSymbol,
            (event: { phase: string; boundary: string }) => {
                if (event.phase === 'store.m3u-import-dispatch')
                    boundaries.push(event.boundary);
            }
        );
        dispatch.mockImplementation(() => boundaries.push('dispatch'));
        const pending = state.submit(draft, completed);
        expect(boundaries).toEqual([]);
        resolve(playlist);
        await pending;
        expect(boundaries).toEqual(['start', 'dispatch', 'end']);
    });

    it('keeps acquisition pending and joins rapid duplicate submits', async () => {
        const pending = state.submit(draft, completed);
        await state.submit(draft, completed);
        expect(state.pending()).toBe(true);
        expect(dispatch).not.toHaveBeenCalled();
        expect(fetchPlaylistDefinition).toHaveBeenCalledTimes(1);
        resolve(playlist);
        await pending;
        expect(dispatch).toHaveBeenCalledTimes(1);
        expect(completed).toHaveBeenCalledTimes(1);
        expect(state.pending()).toBe(false);
    });

    it.each(['cancel', 'destroy'])(
        'discards a late successful response after %s',
        async (action) => {
            const phaseHook = jest.fn();
            Reflect.set(globalThis, hookSymbol, phaseHook);
            const pending = state.submit(draft, completed);
            if (action === 'cancel') state.cancel();
            else TestBed.resetTestingModule();
            resolve(playlist);
            await pending;
            expect(dispatch).not.toHaveBeenCalled();
            expect(completed).not.toHaveBeenCalled();
            expect(phaseHook).not.toHaveBeenCalled();
        }
    );

    it('shows a bounded error and allows retry with the unchanged draft', async () => {
        fetchPlaylistDefinition.mockRejectedValueOnce({
            status: 404,
            message: 'private URL',
        });
        await state.submit(draft, completed);
        expect(state.errorKey()).toBe('HOME.URL_UPLOAD.ERROR_404');
        expect(state.pending()).toBe(false);
        expect(completed).not.toHaveBeenCalled();
        const retry = state.submit(draft, completed);
        resolve(playlist);
        await retry;
        expect(fetchPlaylistDefinition).toHaveBeenLastCalledWith(
            draft.playlistUrl,
            undefined
        );
        expect(state.errorKey()).toBeNull();
        expect(dispatch).toHaveBeenCalledTimes(1);
    });
});
