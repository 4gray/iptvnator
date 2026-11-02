import {
    credentials,
    setupElectronXtreamDataSource,
} from './electron-xtream-data-source.test-helpers';

const mockController = new AbortController();

jest.mock('./xtream-category-import', () => {
    // Simulate cancellation while the lazily loaded cleanup module resolves.
    mockController.abort();
    return jest.requireActual('./xtream-category-import');
});

it('does not start cache deletion after cancellation during helper loading', async () => {
    const { dataSource, dbService } = setupElectronXtreamDataSource();
    dbService.getXtreamImportStatus.mockResolvedValue('importing');
    const request = dataSource.getCategories('p', credentials, 'live', {
        signal: mockController.signal,
        sessionId: 'bootstrap',
    });
    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    expect(mockController.signal.aborted).toBe(true);
    expect(dbService.clearXtreamImportCache).not.toHaveBeenCalled();
    expect(dbService.getXtreamCategories).not.toHaveBeenCalled();
});
