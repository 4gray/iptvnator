import { Injector } from '@angular/core';
import { firstValueFrom, of, Subject } from 'rxjs';
import { EpgSourceSettingsService } from './epg-source-settings.service';
import { PlaylistsService } from './playlists.service';

describe('EPG source settings synchronization', () => {
    const original = window.electron;
    afterEach(() => {
        window.electron = original;
    });

    it('waits for playlist migration, normalizes URLs and invalidates pending lookups after success', async () => {
        const playlists = new Subject<never[]>();
        const reconcileEpgSources = jest
            .fn()
            .mockResolvedValue({ success: true });
        window.electron = {
            reconcileEpgSources,
        } as unknown as typeof window.electron;
        const injector = Injector.create({
            providers: [
                EpgSourceSettingsService,
                {
                    provide: PlaylistsService,
                    useValue: { getAllPlaylists: () => playlists },
                },
            ],
        });
        const service = injector.get(EpgSourceSettingsService);
        const pending = new Subject<string>();
        const observer = jest.fn();
        const lookup = pending.pipe(service.guard());
        lookup.subscribe(observer);
        const synchronization = service.synchronize([' a ', '', 'a']);
        expect(reconcileEpgSources).not.toHaveBeenCalled();
        pending.next('response during playlist migration');
        expect(observer).not.toHaveBeenCalled();
        playlists.next([]);
        await synchronization;
        pending.next('old programme');
        // Subscribing to a pre-deletion request later also cannot revive it.
        lookup.subscribe(observer);
        pending.next('late programme');
        expect(observer).not.toHaveBeenCalled();
        expect(service.revision()).toBe(2);
        expect(reconcileEpgSources).toHaveBeenCalledWith(['a']);
        expect(await firstValueFrom(of('new').pipe(service.guard()))).toBe(
            'new'
        );
    });

    it('invalidates possibly partially deleted data and reports reconciliation failure', async () => {
        window.electron = {
            reconcileEpgSources: jest.fn().mockRejectedValue(new Error('disk')),
        } as unknown as typeof window.electron;
        const injector = Injector.create({
            providers: [
                EpgSourceSettingsService,
                {
                    provide: PlaylistsService,
                    useValue: { getAllPlaylists: () => of([]) },
                },
            ],
        });
        const service = injector.get(EpgSourceSettingsService);
        await expect(service.synchronize(['current'])).rejects.toThrow(
            'Failed to reconcile EPG sources'
        );
        expect(service.revision()).toBe(2);
        expect(service.retainCurrentSources(['current', 'removed'], 0)).toEqual(
            ['current']
        );
    });

    it('serializes overlapping saves and waits for the latest committed source set', async () => {
        let finishFirst!: (result: { success: boolean }) => void;
        const reconcileEpgSources = jest
            .fn()
            .mockImplementationOnce(
                () =>
                    new Promise((resolve) => {
                        finishFirst = resolve;
                    })
            )
            .mockResolvedValue({ success: true });
        window.electron = {
            reconcileEpgSources,
        } as unknown as typeof window.electron;
        const injector = Injector.create({
            providers: [
                EpgSourceSettingsService,
                {
                    provide: PlaylistsService,
                    useValue: { getAllPlaylists: () => of([]) },
                },
            ],
        });
        const service = injector.get(EpgSourceSettingsService);
        const first = service.synchronize(['a']);
        const second = service.synchronize(['b']);
        const waiter = service.waitForReconciliation();
        await Promise.resolve();
        expect(reconcileEpgSources).toHaveBeenCalledTimes(1);
        finishFirst({ success: true });
        await Promise.all([first, second, waiter]);
        expect(reconcileEpgSources.mock.calls.map(([urls]) => urls)).toEqual([
            ['a'],
            ['b'],
        ]);
        expect(service.retainCurrentSources(['a', 'b'], 0)).toEqual(['b']);
    });
});
