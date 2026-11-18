const mockShowMessageBox = jest.fn(() => Promise.resolve({ response: 0 }));
const mockInitDatabase = jest.fn();
const mockResetStaleDownloads = jest.fn();
const mockReconcileStaleRecordings = jest.fn();
const mockTraceStartupPhase = jest.fn();

jest.mock('electron', () => ({
    dialog: { showMessageBox: mockShowMessageBox },
}));
jest.mock('../database/connection', () => ({
    initDatabase: mockInitDatabase,
}));
jest.mock('../events/database/downloads.events', () => ({
    resetStaleDownloads: mockResetStaleDownloads,
}));
jest.mock('../events/database/recording-recovery', () => ({
    reconcileStaleRecordings: mockReconcileStaleRecordings,
}));
jest.mock('../services/debug-trace', () => ({
    traceStartupPhase: mockTraceStartupPhase,
}));
jest.mock('./database-startup', () => ({
    ...jest.requireActual('./database-startup'),
    // Keep the real retry loop, without real delays.
    openDatabaseAtStartup: (
        deps: Parameters<
            typeof import('./database-startup').openDatabaseAtStartup
        >[0]
    ) =>
        jest
            .requireActual('./database-startup')
            .openDatabaseAtStartup({ ...deps, wait: () => Promise.resolve() }),
}));

import { finishStartupAfterFirstLoad } from './finish-startup';

describe('finishStartupAfterFirstLoad', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('opens the database, then runs both recovery passes with their trace phases', async () => {
        mockInitDatabase.mockResolvedValue({});

        await finishStartupAfterFirstLoad();

        expect(
            mockTraceStartupPhase.mock.calls.map(([phase]) => phase)
        ).toEqual([
            'init-database:done',
            'reset-stale-downloads:done',
            'reconcile-stale-recordings:done',
        ]);
        expect(mockResetStaleDownloads).toHaveBeenCalledTimes(1);
        expect(mockReconcileStaleRecordings).toHaveBeenCalledTimes(1);
        expect(mockShowMessageBox).not.toHaveBeenCalled();
    });

    it('resolves and shows the error dialog when the database never opens', async () => {
        const consoleError = jest
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);
        mockInitDatabase.mockRejectedValue(
            Object.assign(new Error('database is locked'), {
                code: 'SQLITE_BUSY',
            })
        );

        await expect(finishStartupAfterFirstLoad()).resolves.toBeUndefined();

        expect(mockInitDatabase).toHaveBeenCalledTimes(4);
        expect(mockResetStaleDownloads).not.toHaveBeenCalled();
        expect(mockReconcileStaleRecordings).not.toHaveBeenCalled();
        expect(mockShowMessageBox).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'error' })
        );
        expect(mockTraceStartupPhase).toHaveBeenCalledWith(
            'init-database:failed'
        );
        consoleError.mockRestore();
    });
});
