import {
    appState,
    epgChannels,
    epgPrograms,
    playlists,
} from '../database/schema';
import { getDatabase } from '../database/connection';
import { epgWorkerService } from './epg-worker.service';
import { epgSourceGeneration } from './epg-source-generation';
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
