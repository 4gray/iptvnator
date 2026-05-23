import {
    DB_WORKER_OPERATIONS,
    DbWorkerOperation,
} from '../workers/database-worker.types';
import { dbPreloadCases, operationId } from './main.preload.spec-data';

type ExposedElectronApi = Record<string, (...args: unknown[]) => unknown>;

type MockIpcRenderer = {
    invoke: jest.Mock;
    on: jest.Mock;
    off: jest.Mock;
    send: jest.Mock;
};

let mockExposedApi: ExposedElectronApi | null;
let mockIpcRenderer: MockIpcRenderer;
let mockGetPathForFile: jest.Mock;

function getExposedApi(): ExposedElectronApi {
    if (!mockExposedApi) {
        throw new Error('Expected preload API to be exposed');
    }

    return mockExposedApi;
}

describe('main preload DB IPC contract', () => {
    beforeEach(async () => {
        jest.resetModules();
        mockExposedApi = null;
        mockGetPathForFile = jest.fn();
        mockIpcRenderer = {
            invoke: jest.fn().mockResolvedValue({ success: true }),
            on: jest.fn(),
            off: jest.fn(),
            send: jest.fn(),
        };

        jest.doMock('electron', () => ({
            contextBridge: {
                exposeInMainWorld: jest.fn(
                    (_name: string, api: ExposedElectronApi) => {
                        mockExposedApi = api;
                    }
                ),
            },
            ipcRenderer: mockIpcRenderer,
            webUtils: {
                getPathForFile: mockGetPathForFile,
            },
        }));

        await import('./main.preload');
    });

    afterEach(() => {
        jest.dontMock('electron');
    });

    it('covers every worker-backed DB operation exposed by the preload bridge', () => {
        const workerChannels = dbPreloadCases
            .map((contractCase) => contractCase.channel)
            .filter(
                (channel): channel is DbWorkerOperation =>
                    channel !== 'DB_CANCEL_OPERATION' &&
                    DB_WORKER_OPERATIONS.includes(channel as DbWorkerOperation)
            );

        expect(new Set(workerChannels)).toEqual(new Set(DB_WORKER_OPERATIONS));
    });

    it.each(dbPreloadCases)(
        '$method invokes $channel with the expected arguments',
        async ({ method, args, channel, forwardedArgs }) => {
            const api = getExposedApi();

            await api[method](...args);

            expect(mockIpcRenderer.invoke).toHaveBeenLastCalledWith(
                channel,
                ...forwardedArgs
            );
        }
    );

    it('forwards scoped user-agent override arguments', async () => {
        const api = getExposedApi();

        await api.setUserAgent(
            'ChannelAgent/1.0',
            'https://portal.example/referrer',
            'https://stream.example/live.m3u8'
        );

        expect(mockIpcRenderer.invoke).toHaveBeenLastCalledWith(
            'set-user-agent',
            'ChannelAgent/1.0',
            'https://portal.example/referrer',
            'https://stream.example/live.m3u8'
        );
    });

    it('forwards request-scoped DB operation events and unregisters the listener', () => {
        const api = getExposedApi();
        const callback = jest.fn();
        const event = {
            operationId,
            operation: 'save-content',
            status: 'progress',
            current: 5,
            total: 10,
        };

        const unsubscribe = api.onDbOperationEvent(callback) as () => void;
        const handler = mockIpcRenderer.on.mock.calls[0][1];

        handler({}, event);

        expect(mockIpcRenderer.on).toHaveBeenCalledWith(
            'DB_OPERATION_EVENT',
            expect.any(Function)
        );
        expect(callback).toHaveBeenCalledWith(event);

        unsubscribe();

        expect(mockIpcRenderer.off).toHaveBeenCalledWith(
            'DB_OPERATION_EVENT',
            handler
        );
    });

    it('keeps the legacy save-content progress bridge scoped to progress events', () => {
        const api = getExposedApi();
        const callback = jest.fn();

        api.onDbSaveContentProgress(callback);
        const handler = mockIpcRenderer.on.mock.calls[0][1];

        handler({}, { operation: 'delete-playlist', status: 'progress' });
        handler({}, { operation: 'save-content', status: 'started' });
        handler(
            {},
            {
                operation: 'save-content',
                status: 'progress',
                current: 25,
                increment: 5,
            }
        );

        expect(callback).toHaveBeenCalledTimes(1);
        expect(callback).toHaveBeenCalledWith(5);

        api.removeDbSaveContentProgress();

        expect(mockIpcRenderer.off).toHaveBeenCalledWith(
            'DB_OPERATION_EVENT',
            handler
        );
    });
});
