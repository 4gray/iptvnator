import {
    credentials,
    setupElectronXtreamDataSource,
} from './electron-xtream-data-source.test-helpers';

describe('Electron Xtream standalone cache refill', () => {
    function setup() {
        const harness = setupElectronXtreamDataSource();
        let marker = 'completed';
        const rows = [
            { id: 1, title: 'Synthetic', xtream_id: 1, type: 'movie' },
        ];
        harness.dbService.getXtreamImportStatus.mockImplementation(
            async () => marker
        );
        harness.dbService.getXtreamContent
            .mockResolvedValueOnce([])
            .mockResolvedValue(rows);
        harness.dbService.hasXtreamContent
            .mockResolvedValueOnce(false)
            .mockResolvedValue(true);
        harness.apiService.getStreams.mockResolvedValue([
            { stream_id: 1, category_id: '1', name: 'Synthetic' },
        ]);
        const persist = async () => {
            marker = 'importing';
            return 1;
        };
        harness.dbService.saveXtreamContent.mockImplementation(persist);
        const setStatus = jest.fn(
            async (_playlist: string, _type: string, status: string) => {
                marker = status;
                return true;
            }
        );
        Object.assign(harness.dbService, { setXtreamImportStatus: setStatus });
        return { ...harness, rows, setStatus, persist, status: () => marker };
    }

    it('finalizes a successful sessionless refill and retains offline eligibility', async () => {
        const { dataSource, rows, setStatus, status } = setup();
        await expect(
            dataSource.getContent('p', credentials, 'movie')
        ).resolves.toEqual(rows);
        expect(status()).toBe('completed');
        expect(setStatus).toHaveBeenCalledWith('p', 'movie', 'completed');
        await expect(dataSource.hasContent('p', 'movie')).resolves.toBe(true);
    });

    it('does not acknowledge a refill when its completion marker cannot be saved', async () => {
        const { dataSource, setStatus, status } = setup();
        setStatus.mockResolvedValue(false);
        await expect(
            dataSource.getContent('p', credentials, 'movie')
        ).rejects.toThrow('completion status');
        expect(status()).toBe('importing');
    });

    it('retains the unfinished marker if cancellation arrives during persistence', async () => {
        const { dataSource, dbService, setStatus, status, persist } = setup();
        const controller = new AbortController();
        dbService.saveXtreamContent.mockImplementation(async () => {
            const result = await persist();
            controller.abort();
            return result;
        });
        await expect(
            dataSource.getContent(
                'p',
                credentials,
                'movie',
                undefined,
                undefined,
                { signal: controller.signal }
            )
        ).rejects.toMatchObject({ name: 'AbortError' });
        expect(status()).toBe('importing');
        expect(setStatus).not.toHaveBeenCalled();
    });

    it.each(['importing', 'failed', 'cancelled', 'idle'])(
        'does not finalize a %s type on behalf of another owner',
        async (marker) => {
            const { dataSource, dbService, setStatus } = setup();
            dbService.getXtreamImportStatus.mockResolvedValue(marker);
            await dataSource.getContent('p', credentials, 'movie');
            expect(setStatus).not.toHaveBeenCalled();
        }
    );

    it('leaves bootstrap completion to the session owner', async () => {
        const { dataSource, setStatus, status } = setup();
        await dataSource.getContent(
            'p',
            credentials,
            'movie',
            undefined,
            undefined,
            { sessionId: 'bootstrap' }
        );
        expect(status()).toBe('importing');
        expect(setStatus).not.toHaveBeenCalled();
    });
});
