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
    let playlistImportRecovery: jest.Mock;
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
        playlistImportRecovery = jest.fn();
        completed = jest.fn();
        TestBed.configureTestingModule({
            providers: [
                { provide: Store, useValue: { dispatch } },
                {
                    provide: DataService,
                    useValue: {
                        fetchPlaylistDefinition,
                        playlistImportRecovery,
                    },
                },
            ],
        });
        state = TestBed.runInInjectionContext(createUrlPlaylistImport);
    });

    afterEach(() => Reflect.deleteProperty(globalThis, hookSymbol));

    it('applies EPG opt-out after the single authorized acquisition', async () => {
        const pending = state.submit(
            { ...draft, autoImportEpg: false },
            completed
        );
        expect(fetchPlaylistDefinition).toHaveBeenCalledTimes(1);
        resolve({
            ...playlist,
            detectedEpgUrls: ['https://epg.test/guide.xml'],
            epgUrls: ['https://epg.test/guide.xml'],
        });
        await pending;
        expect(dispatch).toHaveBeenCalledWith(
            expect.objectContaining({
                playlist: expect.objectContaining({
                    autoImportEpg: false,
                    epgUrls: [],
                    detectedEpgUrls: ['https://epg.test/guide.xml'],
                }),
            })
        );
    });

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

    it('presents TLS recovery inline and retries the owned draft after confirmation', async () => {
        const run = jest.fn();
        const retry = jest.fn();
        playlistImportRecovery.mockReturnValue({
            messageKey: 'HOME.URL_UPLOAD.ERROR_INVALID_TLS',
            actionKey: 'HOME.URL_UPLOAD.TRUST_TLS_HOST',
            run,
        });
        fetchPlaylistDefinition.mockRejectedValueOnce(new Error('TLS'));
        await state.submit(draft, completed, retry);
        expect(state.errorKey()).toBe('HOME.URL_UPLOAD.ERROR_INVALID_TLS');
        expect(state.recovery()?.actionKey).toBe(
            'HOME.URL_UPLOAD.TRUST_TLS_HOST'
        );
        expect(run).not.toHaveBeenCalled();
        state.recovery()!.run();
        expect(run).toHaveBeenCalledTimes(1);
        playlistImportRecovery.mock.calls[0][1]();
        expect(retry).toHaveBeenCalledTimes(1);
    });

    it.each(['cancel', 'edit', 'destroy'])(
        'retires the TLS action and delayed retry after %s',
        async (action) => {
            const run = jest.fn();
            const retry = jest.fn();
            playlistImportRecovery.mockReturnValue({
                messageKey: 'HOME.URL_UPLOAD.ERROR_INVALID_TLS',
                actionKey: 'HOME.URL_UPLOAD.TRUST_TLS_HOST',
                run,
            });
            fetchPlaylistDefinition.mockRejectedValueOnce(new Error('TLS'));
            await state.submit(draft, completed, retry);
            const stale = state.recovery()!;
            if (action === 'cancel') state.cancel();
            else if (action === 'edit') state.clearError();
            else TestBed.resetTestingModule();
            expect(state.recovery()).toBeNull();
            stale.run();
            playlistImportRecovery.mock.calls[0][1]();
            expect(run).not.toHaveBeenCalled();
            expect(retry).not.toHaveBeenCalled();
        }
    );

    it.each(['ETIMEDOUT', 'ENETUNREACH', 'EAI_AGAIN'])(
        'preserves the bounded PWA network code %s without raw error details',
        async (code) => {
            fetchPlaylistDefinition.mockRejectedValueOnce({
                status: 500,
                error: { code, message: 'https://user:secret@private.example' },
            });
            await state.submit(draft, completed);
            expect(state.errorKey()).toBe('HOME.URL_UPLOAD.ERROR_FETCH_FAILED');
            expect(state.errorCode()).toBe(code);
            state.clearError();
            expect(state.errorKey()).toBeNull();
            expect(state.errorCode()).toBeNull();
        }
    );

    it.each([
        'E'.repeat(49),
        'ETIMEDOUT\n',
        'ETIMEDOUT\r\n',
        'ETIMEDOUT https://user:secret@private.example',
        '<script>',
        504,
        null,
    ])(
        'does not display an unbounded or malformed error code: %s',
        async (code) => {
            fetchPlaylistDefinition.mockRejectedValueOnce({
                status: 500,
                error: { code },
            });
            await state.submit(draft, completed);
            expect(state.errorCode()).toBeNull();
        }
    );

    it('clears a previous network code before a new attempt and after success', async () => {
        fetchPlaylistDefinition.mockRejectedValueOnce({
            status: 500,
            error: { code: 'ETIMEDOUT' },
        });
        await state.submit(draft, completed);
        const pending = state.submit(draft, completed);
        expect(state.errorCode()).toBeNull();
        resolve(playlist);
        await pending;
        expect(state.errorCode()).toBeNull();
    });
});
