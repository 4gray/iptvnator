import {
    credentials,
    setupElectronXtreamDataSource,
} from './electron-xtream-data-source.test-helpers';

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

describe('Electron Xtream import cancellation boundaries', () => {
    it('does not start a content read after cancellation during its status read', async () => {
        const { dataSource, dbService } = setupElectronXtreamDataSource();
        const controller = new AbortController();
        const status = deferred<'idle'>();
        const started = deferred<void>();
        dbService.getXtreamImportStatus.mockImplementation(() => {
            started.resolve();
            return status.promise;
        });
        const request = dataSource.getContent(
            'p',
            credentials,
            'live',
            undefined,
            undefined,
            { signal: controller.signal }
        );
        await started.promise;
        controller.abort();
        status.resolve('idle');
        await expect(request).rejects.toMatchObject({ name: 'AbortError' });
        expect(dbService.getXtreamContent).not.toHaveBeenCalled();
    });

    it('does not start a provider request after cancellation during a cached content read', async () => {
        const { dataSource, dbService, apiService } =
            setupElectronXtreamDataSource();
        const controller = new AbortController();
        const read = deferred<[]>();
        const started = deferred<void>();
        dbService.getXtreamContent.mockImplementationOnce(() => {
            started.resolve();
            return read.promise;
        });
        const request = dataSource.getContent(
            'p',
            credentials,
            'live',
            undefined,
            undefined,
            { signal: controller.signal }
        );
        await started.promise;
        controller.abort();
        read.resolve([]);
        await expect(request).rejects.toMatchObject({ name: 'AbortError' });
        expect(apiService.getStreams).not.toHaveBeenCalled();
        expect(dbService.saveXtreamContent).not.toHaveBeenCalled();
    });

    it('does not save content returned after cancellation', async () => {
        const { dataSource, dbService, apiService } =
            setupElectronXtreamDataSource();
        const controller = new AbortController();
        const response =
            deferred<
                [{ stream_id: number; category_id: string; name: string }]
            >();
        const started = deferred<void>();
        apiService.getStreams.mockImplementation(() => {
            started.resolve();
            return response.promise;
        });
        const request = dataSource.getContent(
            'p',
            credentials,
            'live',
            undefined,
            undefined,
            { signal: controller.signal }
        );
        await started.promise;
        controller.abort();
        response.resolve([
            { stream_id: 1, category_id: '1', name: 'Synthetic' },
        ]);
        await expect(request).rejects.toMatchObject({ name: 'AbortError' });
        expect(dbService.saveXtreamContent).not.toHaveBeenCalled();
    });

    it('does not save categories returned after cancellation', async () => {
        const { dataSource, dbService, apiService } =
            setupElectronXtreamDataSource();
        const controller = new AbortController();
        const response =
            deferred<[{ category_id: string; category_name: string }]>();
        const started = deferred<void>();
        apiService.getCategories.mockImplementation(() => {
            started.resolve();
            return response.promise;
        });
        const request = dataSource.getCategories('p', credentials, 'live', {
            signal: controller.signal,
        });
        await started.promise;
        controller.abort();
        response.resolve([{ category_id: '1', category_name: 'Synthetic' }]);
        await expect(request).rejects.toMatchObject({ name: 'AbortError' });
        expect(dbService.saveXtreamCategories).not.toHaveBeenCalled();
    });
});
