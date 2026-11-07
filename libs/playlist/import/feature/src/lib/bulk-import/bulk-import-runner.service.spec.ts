import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslateModule } from '@ngx-translate/core';
import { of, Subject } from 'rxjs';
import { PlaylistActions } from '@iptvnator/m3u-state';
import {
    DatabaseService,
    DataService,
    ParentalLockService,
    PlaylistDeleteActionService,
    PlaylistsService,
    PlaylistStorageBackend,
    PORTAL_CONTENT_SEEDERS,
    RuntimeCapabilitiesService,
    SettingsStore,
} from '@iptvnator/services';
import {
    bulkEntriesFromJson,
    type BulkImportEntry,
    type Playlist,
} from '@iptvnator/shared/interfaces';
import {
    BULK_IMPORT_SOURCE_TIMEOUT_MS,
    BulkImportRunnerService,
} from './bulk-import-runner.service';

describe('BulkImportRunnerService', () => {
    let runner: BulkImportRunnerService;
    let calls: string[];
    let store: { dispatch: jest.Mock };
    let playlistsService: {
        removeAll: jest.Mock;
        addManyPlaylists: jest.Mock;
        handlePlaylistParsing: jest.Mock;
    };
    let dataService: { fetchPlaylistDefinition: jest.Mock };
    let deleteAction: { deletePlaylist: jest.Mock };
    let seeder: { seed: jest.Mock };
    let snackBar: { open: jest.Mock };

    function rows(...sources: object[]): BulkImportEntry[] {
        return bulkEntriesFromJson({ sources }) ?? [];
    }

    function xtream(title: string): object {
        return {
            type: 'xtream',
            title,
            serverUrl: `http://${title.toLowerCase()}.example`,
            username: 'user',
            password: 'pass',
        };
    }

    /** Shown popups, once the queue has drained. */
    async function popups(): Promise<string[]> {
        for (let i = 0; i < 20; i++) {
            await Promise.resolve();
        }
        return snackBar.open.mock.calls.map(([message]) => message);
    }

    function importedTitles(): string[] {
        return store.dispatch.mock.calls
            .map(([action]) => action)
            .filter(
                (action) =>
                    action.type === PlaylistActions.addManyPlaylists.type
            )
            .flatMap((action) =>
                action.playlists.map((playlist: Playlist) => playlist.title)
            );
    }

    beforeEach(() => {
        calls = [];
        store = { dispatch: jest.fn() };
        playlistsService = {
            removeAll: jest.fn(() => {
                calls.push('removeAll');
                return of(undefined);
            }),
            addManyPlaylists: jest.fn((playlists: Playlist[]) => {
                calls.push(`persist:${playlists[0].title}`);
                return of({});
            }),
            handlePlaylistParsing: jest.fn(),
        };
        dataService = { fetchPlaylistDefinition: jest.fn() };
        deleteAction = {
            deletePlaylist: jest.fn((playlist: Playlist) => {
                calls.push(`delete:${playlist.title}`);
                return Promise.resolve(true);
            }),
        };
        seeder = { seed: jest.fn().mockResolvedValue(undefined) };
        snackBar = {
            open: jest.fn(() => ({ afterDismissed: () => of(undefined) })),
        };

        TestBed.configureTestingModule({
            imports: [TranslateModule.forRoot()],
            providers: [
                { provide: Store, useValue: store },
                {
                    provide: Router,
                    useValue: { navigate: jest.fn().mockResolvedValue(true) },
                },
                { provide: DataService, useValue: dataService },
                { provide: DatabaseService, useValue: {} },
                { provide: PlaylistsService, useValue: playlistsService },
                {
                    provide: PlaylistStorageBackend,
                    useValue: { kind: () => 'indexeddb' },
                },
                {
                    provide: ParentalLockService,
                    useValue: {
                        clearAllLocks: jest.fn().mockResolvedValue(true),
                    },
                },
                {
                    provide: PlaylistDeleteActionService,
                    useValue: deleteAction,
                },
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: { isElectron: false },
                },
                {
                    provide: SettingsStore,
                    useValue: { disableVod: () => false },
                },
                { provide: MatSnackBar, useValue: snackBar },
                { provide: PORTAL_CONTENT_SEEDERS, useValue: [seeder] },
            ],
        });
        runner = TestBed.inject(BulkImportRunnerService);
    });

    afterEach(() => jest.useRealTimers());

    it('removes every existing source before the first row is written', async () => {
        const summary = await runner.run(rows(xtream('Gold')));

        expect(calls).toEqual(['removeAll', 'persist:Gold']);
        expect(store.dispatch.mock.calls[0][0]).toEqual(
            PlaylistActions.removeAllPlaylists()
        );
        expect(summary).toEqual({ imported: 1, slow: 0, failed: 0 });
        expect(importedTitles()).toEqual(['Gold']);
    });

    it('imports nothing when the old sources could not be removed', async () => {
        playlistsService.removeAll.mockReturnValue(
            new Promise(() => {
                throw new Error('locked');
            })
        );

        const summary = await runner.run(rows(xtream('Gold')));

        expect(summary).toBeNull();
        expect(playlistsService.addManyPlaylists).not.toHaveBeenCalled();
        expect(await popups()).toEqual([
            'HOME.ADD_PLAYLIST.BULK_REPLACE_FAILED',
        ]);
    });

    it('skips a source slower than a minute and carries on with the rest', async () => {
        jest.useFakeTimers();
        seeder.seed
            .mockReturnValueOnce(new Promise(() => undefined))
            .mockResolvedValueOnce(undefined);

        const run = runner.run(rows(xtream('Slow'), xtream('Fast')));
        await jest.advanceTimersByTimeAsync(BULK_IMPORT_SOURCE_TIMEOUT_MS - 1);
        expect(Object.values(runner.statuses())).toEqual([
            'importing',
            'pending',
        ]);
        await jest.advanceTimersByTimeAsync(1);
        const summary = await run;

        expect(summary).toEqual({ imported: 1, slow: 1, failed: 0 });
        expect(calls).toEqual([
            'removeAll',
            'persist:Slow',
            'delete:Slow',
            'persist:Fast',
        ]);
        expect(importedTitles()).toEqual(['Fast']);
        expect((await popups())[0]).toBe(
            'HOME.ADD_PLAYLIST.BULK_SOURCE_TOO_SLOW'
        );
        expect(Object.values(runner.statuses())).toEqual(['slow', 'imported']);
    });

    it('aborts the work of a source it gave up on', async () => {
        jest.useFakeTimers();
        let signal: AbortSignal | undefined;
        seeder.seed.mockImplementation(
            (_playlist: Playlist, aborted?: AbortSignal) => {
                signal = aborted;
                return new Promise(() => undefined);
            }
        );

        const run = runner.run(rows(xtream('Slow')));
        await jest.advanceTimersByTimeAsync(BULK_IMPORT_SOURCE_TIMEOUT_MS);
        await run;

        expect(signal?.aborted).toBe(true);
    });

    it('skips a failing source with an error popup and imports the next one', async () => {
        seeder.seed
            .mockRejectedValueOnce(new Error('portal down'))
            .mockResolvedValueOnce(undefined);

        const summary = await runner.run(
            rows(xtream('Broken'), xtream('Good'))
        );

        expect(summary).toEqual({ imported: 1, slow: 0, failed: 1 });
        expect(calls).toContain('delete:Broken');
        expect(importedTitles()).toEqual(['Good']);
        expect(await popups()).toEqual([
            'HOME.ADD_PLAYLIST.BULK_SOURCE_FAILED',
            'HOME.ADD_PLAYLIST.BULK_IMPORT_FINISHED',
        ]);
    });

    it('queues popups so a quick failure cannot hide the previous message', async () => {
        const dismissals: Subject<void>[] = [];
        snackBar.open.mockImplementation(() => {
            const dismissed = new Subject<void>();
            dismissals.push(dismissed);
            return { afterDismissed: () => dismissed };
        });
        seeder.seed.mockRejectedValue(new Error('portal down'));

        await runner.run(rows(xtream('First'), xtream('Second')));

        expect(await popups()).toEqual([
            'HOME.ADD_PLAYLIST.BULK_SOURCE_FAILED',
        ]);
        dismissals[0].next();
        expect(await popups()).toHaveLength(2);
    });

    it('does not store an M3U list whose download finished after the timeout', async () => {
        jest.useFakeTimers();
        let finishDownload: (playlist: Playlist) => void = () => undefined;
        dataService.fetchPlaylistDefinition.mockReturnValue(
            new Promise<Playlist>((resolve) => (finishDownload = resolve))
        );

        const run = runner.run(
            rows({
                type: 'm3u-url',
                title: 'List',
                url: 'http://lists.example/a.m3u',
            })
        );
        await jest.advanceTimersByTimeAsync(BULK_IMPORT_SOURCE_TIMEOUT_MS);
        const summary = await run;
        finishDownload({ _id: 'late', title: 'remote' } as Playlist);
        await jest.advanceTimersByTimeAsync(0);

        expect(summary).toEqual({ imported: 0, slow: 1, failed: 0 });
        expect(playlistsService.addManyPlaylists).not.toHaveBeenCalled();
    });

    it('stores a downloaded M3U list under the title of its row', async () => {
        dataService.fetchPlaylistDefinition.mockResolvedValue({
            _id: 'm3u-1',
            title: 'remote title',
        } as Playlist);

        await runner.run(
            rows({
                type: 'm3u-url',
                title: 'List',
                url: 'http://lists.example/a.m3u',
            })
        );

        expect(dataService.fetchPlaylistDefinition).toHaveBeenCalledWith(
            'http://lists.example/a.m3u'
        );
        expect(importedTitles()).toEqual(['List']);
    });
});
