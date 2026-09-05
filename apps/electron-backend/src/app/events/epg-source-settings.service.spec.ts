import {
    appState,
    epgChannels,
    epgChannelSources,
    epgPrograms,
    playlists,
} from '../database/schema';
import { getDatabase } from '../database/connection';
import { epgWorkerService } from './epg-worker.service';
import { epgSourceGeneration, requestEpgSource } from './epg-source-generation';
import { reconcileEpgSources } from './epg-source-settings.service';

jest.mock('../database/connection', () => ({ getDatabase: jest.fn() }));
jest.mock('./epg-worker.service', () => ({
    epgWorkerService: {
        clearEpgDataForSource: jest.fn().mockResolvedValue(undefined),
    },
}));

describe('committed EPG source reconciliation', () => {
    let rows: Map<unknown, unknown[]>;
    beforeEach(() => {
        jest.clearAllMocks();
        rows = new Map<unknown, unknown[]>([
            [appState, [{ value: '1' }]],
            [playlists, []],
            [epgChannels, [{ url: 'removed' }, { url: 'shared' }]],
            [epgPrograms, [{ url: 'removed' }, { url: 'second' }]],
        ]);
        const select = () => ({
            from: (table: unknown) => {
                const result = rows.get(table) ?? [];
                return Object.assign(Promise.resolve(result), {
                    where: () => Promise.resolve(result),
                });
            },
        });
        (getDatabase as jest.Mock).mockResolvedValue({
            select,
            selectDistinct: select,
        });
    });

    it('preserves global and every enabled M3U source, including an overlapping channel owner', async () => {
        rows.set(playlists, [{ type: 'm3u-url', urls: '["shared"]' }]);
        const generation = epgSourceGeneration('removed');
        await reconcileEpgSources([' second ']);
        expect(epgWorkerService.clearEpgDataForSource).toHaveBeenCalledWith(
            'removed'
        );
        expect(epgWorkerService.clearEpgDataForSource).not.toHaveBeenCalledWith(
            'shared'
        );
        expect(epgWorkerService.clearEpgDataForSource).not.toHaveBeenCalledWith(
            'second'
        );
        expect(epgSourceGeneration('removed')).toBeGreaterThan(generation);
    });

    it('cleans already orphaned sources when the saved global list is empty', async () => {
        await reconcileEpgSources([]);
        for (const url of ['removed', 'shared', 'second']) {
            expect(epgWorkerService.clearEpgDataForSource).toHaveBeenCalledWith(
                url
            );
        }
    });

    it('finds metadata-only source owners after restart', async () => {
        rows.set(epgChannels, [{ url: 'active' }]);
        rows.set(epgPrograms, []);
        rows.set(epgChannelSources, [
            { url: 'metadata-only' },
            { url: 'active' },
        ]);
        await reconcileEpgSources(['active']);
        expect(epgWorkerService.clearEpgDataForSource).toHaveBeenCalledWith(
            'metadata-only'
        );
        expect(epgWorkerService.clearEpgDataForSource).not.toHaveBeenCalledWith(
            'active'
        );
    });

    it('does not clear historical request keys again after successful cleanup', async () => {
        requestEpgSource('removed');
        await reconcileEpgSources([]);
        rows.set(epgChannels, []);
        rows.set(epgPrograms, []);
        jest.clearAllMocks();
        await reconcileEpgSources([]);
        expect(epgWorkerService.clearEpgDataForSource).not.toHaveBeenCalled();
    });

    it('retries a failed cleanup even when the queued source had no database rows', async () => {
        rows.set(epgChannels, []);
        rows.set(epgPrograms, []);
        requestEpgSource('queued-only');
        (
            epgWorkerService.clearEpgDataForSource as jest.Mock
        ).mockRejectedValueOnce(new Error('worker failure'));
        await expect(reconcileEpgSources([])).rejects.toThrow('worker failure');
        await reconcileEpgSources([]);
        expect(epgWorkerService.clearEpgDataForSource).toHaveBeenCalledTimes(2);
    });

    it('preserves a new request received while the previous request is being cleared', async () => {
        rows.set(epgChannels, []);
        rows.set(epgPrograms, []);
        requestEpgSource('requested-again');
        (
            epgWorkerService.clearEpgDataForSource as jest.Mock
        ).mockImplementationOnce(async () => {
            requestEpgSource('requested-again');
        });
        await reconcileEpgSources([]);
        await reconcileEpgSources([]);
        expect(epgWorkerService.clearEpgDataForSource).toHaveBeenCalledTimes(2);
        jest.clearAllMocks();
        await reconcileEpgSources([]);
        expect(epgWorkerService.clearEpgDataForSource).not.toHaveBeenCalled();
    });

    it('does not prune sources before playlist migration succeeds', async () => {
        rows.set(appState, []);
        await expect(reconcileEpgSources([])).rejects.toThrow(
            'migrated playlists'
        );
        expect(epgWorkerService.clearEpgDataForSource).not.toHaveBeenCalled();
    });

    it('does not guess ownership when persisted playlist source metadata is invalid', async () => {
        rows.set(playlists, [{ type: 'm3u-url', urls: '{broken' }]);
        await expect(reconcileEpgSources([])).rejects.toThrow();
        expect(epgWorkerService.clearEpgDataForSource).not.toHaveBeenCalled();
    });
});
