type IpcHandler = (event: unknown, ...args: unknown[]) => Promise<unknown>;

const mockRegisteredHandlers = new Map<string, IpcHandler>();
const mockSetParentalLockState = jest.fn();
const mockStoreGet = jest.fn();

jest.mock('electron', () => ({
    ipcMain: {
        handle: jest.fn((channel: string, handler: IpcHandler) => {
            mockRegisteredHandlers.set(channel, handler);
        }),
    },
}));

jest.mock('../services/database-worker-client', () => ({
    databaseWorkerClient: {
        setParentalLockState: (...args: unknown[]) =>
            mockSetParentalLockState(...args),
    },
}));

jest.mock('../services/store.service', () => ({
    PARENTAL_LOCK_ENABLED: 'PARENTAL_LOCK_ENABLED',
    store: { get: (...args: unknown[]) => mockStoreGet(...args) },
}));

type Listener = (...args: unknown[]) => void;

function createSender() {
    const listeners = new Map<string, Listener>();
    return {
        id: 1,
        on: jest.fn((event: string, listener: Listener) => {
            listeners.set(event, listener);
        }),
        off: jest.fn(),
        emit(event: string, ...args: unknown[]) {
            listeners.get(event)?.(...args);
        },
    };
}

describe('parental-lock.events', () => {
    beforeEach(async () => {
        jest.resetModules();
        mockRegisteredHandlers.clear();
        mockSetParentalLockState.mockReset().mockResolvedValue(undefined);
        mockStoreGet.mockReset().mockReturnValue(true);
        const module = await import('./parental-lock.events');
        module.default.bootstrapParentalLockEvents();
    });

    it('forwards the renderer state to the worker and remembers it', async () => {
        const { getParentalLockActive } =
            await import('../services/parental-lock-state');
        const handler = mockRegisteredHandlers.get('PARENTAL_LOCK:SET_STATE');
        expect(handler).toBeDefined();

        await handler?.({ sender: createSender() }, false);
        expect(mockSetParentalLockState).toHaveBeenLastCalledWith(false);
        expect(getParentalLockActive()).toBe(false);

        await handler?.({ sender: createSender() }, 'yes');
        expect(mockSetParentalLockState).toHaveBeenLastCalledWith(false);
    });

    it('locks again from the mirrored setting when the renderer reloads or dies', async () => {
        const handler = mockRegisteredHandlers.get('PARENTAL_LOCK:SET_STATE');
        const sender = createSender();

        await handler?.({ sender }, false);
        mockSetParentalLockState.mockClear();

        sender.emit('did-start-navigation', {
            isMainFrame: true,
            isSameDocument: true,
        });
        expect(mockSetParentalLockState).not.toHaveBeenCalled();

        sender.emit('did-start-navigation', {
            isMainFrame: true,
            isSameDocument: false,
        });
        expect(mockSetParentalLockState).toHaveBeenLastCalledWith(true);

        mockStoreGet.mockReturnValue(false);
        sender.emit('render-process-gone');
        expect(mockSetParentalLockState).toHaveBeenLastCalledWith(false);
    });

    it('seeds the main-process copy from the mirrored setting at bootstrap', async () => {
        const { getParentalLockActive } =
            await import('../services/parental-lock-state');
        expect(getParentalLockActive()).toBe(true);
    });
});
