import { Injector, runInInjectionContext } from '@angular/core';
import { Router } from '@angular/router';
import { Actions } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { EpgService } from '@iptvnator/epg/data-access';
import {
    EpgSourceSettingsService,
    PlaylistsService,
    SettingsStore,
} from '@iptvnator/services';
import { EMPTY, of, Subject, throwError } from 'rxjs';
import { PlaylistActions } from './actions';
import { PlaylistEffects } from './effects';

// Each subscription must create a fresh storage request, not replay the same
// rejected promise. Exhausted retries must leave the action stream usable.
describe('PlaylistEffects loadPlaylists$', () => {
    let actions$: Subject<unknown>;
    let getAllPlaylists: jest.Mock;
    let effects: PlaylistEffects;
    let retryFailedReconciliation: jest.Mock;
    let loadSettings: jest.Mock;

    beforeEach(() => {
        jest.useFakeTimers();
        actions$ = new Subject();
        getAllPlaylists = jest.fn(() => of([]));
        retryFailedReconciliation = jest.fn().mockResolvedValue(undefined);
        loadSettings = jest.fn().mockResolvedValue(undefined);
        const injector = Injector.create({
            parent: { get: () => ({}) } as unknown as Injector,
            providers: [
                { provide: Actions, useValue: new Actions(actions$) },
                { provide: Store, useValue: { select: () => EMPTY } },
                { provide: PlaylistsService, useValue: { getAllPlaylists } },
                { provide: EpgService, useValue: { fetchEpg: jest.fn() } },
                { provide: Router, useValue: {} },
                {
                    provide: EpgSourceSettingsService,
                    useValue: { retryFailedReconciliation },
                },
                {
                    provide: SettingsStore,
                    useValue: {
                        loadSettings,
                        getSettings: () => ({ epgUrl: [] }),
                    },
                },
            ],
        });
        effects = runInInjectionContext(injector, () => new PlaylistEffects());
    });

    afterEach(() => jest.useRealTimers());

    it('waits for slow settings to register initial cleanup before publishing inventory', async () => {
        let finishSettings!: () => void;
        loadSettings.mockReturnValueOnce(
            new Promise<void>((resolve) => {
                finishSettings = resolve;
            })
        );
        const results: unknown[] = [];
        const subscription = effects.loadPlaylists$.subscribe((value) =>
            results.push(value)
        );
        actions$.next(PlaylistActions.loadPlaylists());
        await jest.runAllTimersAsync();
        expect(getAllPlaylists).toHaveBeenCalledTimes(1);
        expect(results).toEqual([]);
        expect(retryFailedReconciliation).not.toHaveBeenCalled();
        // SettingsStore completes after swallowing the first cleanup failure.
        retryFailedReconciliation.mockImplementationOnce(() =>
            Promise.reject(new Error('cleanup still unavailable'))
        );
        finishSettings();
        await jest.runAllTimersAsync();
        expect(results).toEqual([PlaylistActions.loadPlaylistsFailure()]);
        actions$.next(PlaylistActions.loadPlaylists());
        await jest.runAllTimersAsync();
        expect(results.at(-1)).toEqual(
            PlaylistActions.loadPlaylistsSuccess({ playlists: [] })
        );
        subscription.unsubscribe();
    });

    it('waits for failed EPG reconciliation to recover before exposing sources', async () => {
        let finish!: () => void;
        retryFailedReconciliation.mockReturnValue(
            new Promise<void>((resolve) => {
                finish = resolve;
            })
        );
        const results: unknown[] = [];
        const subscription = effects.loadPlaylists$.subscribe((value) =>
            results.push(value)
        );
        actions$.next(PlaylistActions.loadPlaylists());
        await jest.runAllTimersAsync();
        expect(results).toEqual([]);
        finish();
        await jest.runAllTimersAsync();
        expect(results).toEqual([
            PlaylistActions.loadPlaylistsSuccess({ playlists: [] }),
        ]);
        subscription.unsubscribe();
    });

    it('keeps a failed EPG recovery actionable and retries it on the next load', async () => {
        retryFailedReconciliation.mockImplementationOnce(() =>
            Promise.reject(new Error('cleanup failed'))
        );
        const results: unknown[] = [];
        const subscription = effects.loadPlaylists$.subscribe((value) =>
            results.push(value)
        );
        actions$.next(PlaylistActions.loadPlaylists());
        await jest.runAllTimersAsync();
        expect(results).toEqual([PlaylistActions.loadPlaylistsFailure()]);
        actions$.next(PlaylistActions.loadPlaylists());
        await jest.runAllTimersAsync();
        expect(results.at(-1)).toEqual(
            PlaylistActions.loadPlaylistsSuccess({ playlists: [] })
        );
        expect(retryFailedReconciliation).toHaveBeenCalledTimes(2);
        subscription.unsubscribe();
    });

    it('recovers a transient read error without restarting', async () => {
        getAllPlaylists.mockReturnValueOnce(
            throwError(() => new Error('temporary'))
        );
        const results: unknown[] = [];
        const errors: unknown[] = [];
        const subscription = effects.loadPlaylists$.subscribe({
            next: (value) => results.push(value),
            error: (error) => errors.push(error),
        });
        actions$.next(PlaylistActions.loadPlaylists());
        await jest.runAllTimersAsync();
        expect(errors).toEqual([]);
        expect(getAllPlaylists).toHaveBeenCalledTimes(2);
        expect(results).toEqual([
            PlaylistActions.loadPlaylistsSuccess({ playlists: [] }),
        ]);
        subscription.unsubscribe();
    });

    it('reports persistent failure without treating it as an empty library and accepts Retry', async () => {
        getAllPlaylists.mockReturnValue(
            throwError(() => new Error('private storage error'))
        );
        const results: unknown[] = [];
        const errors: unknown[] = [];
        const subscription = effects.loadPlaylists$.subscribe({
            next: (value) => results.push(value),
            error: (error) => errors.push(error),
        });
        actions$.next(PlaylistActions.loadPlaylists());
        await jest.runAllTimersAsync();
        expect(errors).toEqual([]);
        expect(getAllPlaylists).toHaveBeenCalledTimes(2);
        expect(results).toEqual([
            { type: '[Playlists] Load Playlists Failure' },
        ]);
        getAllPlaylists.mockReturnValue(of([]));
        actions$.next(PlaylistActions.loadPlaylists());
        await jest.runAllTimersAsync();
        expect(results.at(-1)).toEqual(
            PlaylistActions.loadPlaylistsSuccess({ playlists: [] })
        );
        subscription.unsubscribe();
    });
});
