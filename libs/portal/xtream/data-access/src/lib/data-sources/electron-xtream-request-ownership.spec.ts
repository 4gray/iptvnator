import {
    credentials,
    setupElectronXtreamDataSource,
} from './electron-xtream-data-source.test-helpers';
import { waitForCondition } from '../stores/features/with-content.feature.spec-helpers';

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

describe('Electron Xtream request ownership', () => {
    it('does not cancel an independent category reader when its concurrent import is cancelled', async () => {
        const { dataSource, dbService } = setupElectronXtreamDataSource();
        dbService.getXtreamImportStatus.mockResolvedValue('completed');
        const rows = [
            { id: 1, name: 'Synthetic', xtream_id: 1, type: 'movies' },
        ];
        const read = deferred<typeof rows>();
        dbService.getXtreamCategories.mockReturnValue(read.promise);
        const controller = new AbortController();
        const importing = dataSource.getCategories('p', credentials, 'vod', {
            sessionId: 'synthetic-import',
            signal: controller.signal,
        });
        const independent = dataSource.getCategories('p', credentials, 'vod');
        const stopped = expect(importing).rejects.toMatchObject({
            name: 'AbortError',
        });
        const retained = expect(independent).resolves.toEqual(rows);
        await waitForCondition(
            () => dbService.getXtreamCategories.mock.calls.length > 0
        );
        controller.abort();
        read.resolve(rows);
        await Promise.all([stopped, retained]);
    });

    it('does not cancel an independent content reader when its concurrent import is cancelled', async () => {
        const { dataSource, dbService } = setupElectronXtreamDataSource();
        dbService.getXtreamImportStatus.mockResolvedValue('completed');
        const rows = [
            { id: 1, title: 'Synthetic', xtream_id: 1, type: 'movie' },
        ];
        const read = deferred<typeof rows>();
        dbService.getXtreamContent.mockReturnValue(read.promise);
        const controller = new AbortController();
        const importing = dataSource.getContent(
            'p',
            credentials,
            'movie',
            undefined,
            undefined,
            {
                sessionId: 'synthetic-import',
                signal: controller.signal,
            }
        );
        const independent = dataSource.getContent('p', credentials, 'movie');
        const stopped = expect(importing).rejects.toMatchObject({
            name: 'AbortError',
        });
        const retained = expect(independent).resolves.toEqual(rows);
        await waitForCondition(
            () => dbService.getXtreamContent.mock.calls.length > 0
        );
        controller.abort();
        read.resolve(rows);
        await Promise.all([stopped, retained]);
    });

    it('does not treat an importing marker as permission for an independent category read to clear the cache', async () => {
        const { dataSource, dbService } = setupElectronXtreamDataSource();
        dbService.getXtreamImportStatus.mockResolvedValue('importing');
        const rows = [
            { id: 1, name: 'Synthetic', xtream_id: 1, type: 'movies' },
        ];
        dbService.getXtreamCategories.mockResolvedValue(rows);
        await expect(
            dataSource.getCategories('p', credentials, 'vod')
        ).resolves.toEqual(rows);
        expect(dbService.clearXtreamImportCache).not.toHaveBeenCalled();
    });
});
