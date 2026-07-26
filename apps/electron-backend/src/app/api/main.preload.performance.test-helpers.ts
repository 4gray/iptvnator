import type {
    ElectronBridgeApi,
    Playlist,
    PlaylistRefreshPayload,
    PreloadPerformanceMarker,
} from '@iptvnator/shared/interfaces';

export const PRELOAD_ENVIRONMENT = {
    PERF_CAPTURE: 'IPTVNATOR_PERF_CAPTURE',
    TRACE_IPC: 'IPTVNATOR_TRACE_IPC',
    TRACE_STARTUP: 'IPTVNATOR_TRACE_STARTUP',
} as const;

type PreloadEnvironmentName =
    (typeof PRELOAD_ENVIRONMENT)[keyof typeof PRELOAD_ENVIRONMENT];

type PreloadEnvironment = Partial<Record<PreloadEnvironmentName, string>>;

export type ExposedElectronApi = ElectronBridgeApi &
    Record<string, (...args: unknown[]) => unknown>;

export interface MockIpcRenderer {
    invoke: jest.Mock;
    off: jest.Mock;
    on: jest.Mock;
    send: jest.Mock;
}

export interface PreloadPerformanceHarness {
    cleanup: () => void;
    getApi: () => ExposedElectronApi;
    getMarkers: () => PreloadPerformanceMarker[];
    getSentPayloads: <T>(channel: string) => T[];
    ipcRenderer: MockIpcRenderer;
    load: (environment?: PreloadEnvironment) => Promise<void>;
}

const MARKER_KEYS = [
    'correlationState',
    'invalidReason',
    'ipcCallId',
    'method',
    'operationId',
    'phase',
    'playlistId',
    'sourceEpochMs',
] as const;

export function createPlaylist(
    playlistId: string,
    overrides: Partial<Playlist> = {}
): Playlist {
    return {
        _id: playlistId,
        autoRefresh: false,
        count: 1,
        importDate: '2026-07-26T00:00:00.000Z',
        lastUsage: '2026-07-26T00:00:00.000Z',
        title: 'Performance fixture',
        ...overrides,
    };
}

export function createRefreshPayload(
    overrides: Partial<PlaylistRefreshPayload> = {}
): PlaylistRefreshPayload {
    return {
        operationId: 'operation-1',
        playlistId: 'playlist-1',
        title: 'Performance fixture',
        ...overrides,
    };
}

export function expectFixedMarkers(markers: PreloadPerformanceMarker[]): void {
    for (const [index, marker] of markers.entries()) {
        expect(Object.keys(marker).sort()).toEqual([...MARKER_KEYS].sort());
        expect(Number.isFinite(marker.sourceEpochMs)).toBe(true);
        if (index > 0) {
            expect(marker.sourceEpochMs).toBeGreaterThanOrEqual(
                markers[index - 1].sourceEpochMs
            );
        }
    }
}

export function createPreloadPerformanceHarness(): PreloadPerformanceHarness {
    const originalEnvironment = new Map<
        PreloadEnvironmentName,
        string | undefined
    >(
        Object.values(PRELOAD_ENVIRONMENT).map((name) => [
            name,
            process.env[name],
        ])
    );
    let exposedApi: ExposedElectronApi | null = null;
    const ipcRenderer: MockIpcRenderer = {
        invoke: jest.fn(),
        off: jest.fn(),
        on: jest.fn(),
        send: jest.fn(),
    };

    function getSentPayloads<T>(channel: string): T[] {
        return ipcRenderer.send.mock.calls
            .filter(([sentChannel]) => sentChannel === channel)
            .map(([, payload]) => payload as T);
    }

    return {
        cleanup: () => {
            for (const [name, value] of originalEnvironment) {
                if (value === undefined) {
                    delete process.env[name];
                } else {
                    process.env[name] = value;
                }
            }
            jest.dontMock('electron');
        },
        getApi: () => {
            if (!exposedApi) {
                throw new Error('Expected preload API to be exposed');
            }
            return exposedApi;
        },
        getMarkers: () =>
            getSentPayloads<PreloadPerformanceMarker>(
                'IPTVNATOR_PERF_CAPTURE_MARKER'
            ),
        getSentPayloads,
        ipcRenderer,
        load: async (environment = {}) => {
            jest.resetModules();
            for (const name of Object.values(PRELOAD_ENVIRONMENT)) {
                delete process.env[name];
            }
            Object.assign(process.env, environment);
            exposedApi = null;
            ipcRenderer.invoke.mockReset().mockResolvedValue({ success: true });
            ipcRenderer.off.mockReset();
            ipcRenderer.on.mockReset();
            ipcRenderer.send.mockReset();
            jest.doMock('electron', () => ({
                contextBridge: {
                    exposeInMainWorld: jest.fn(
                        (_name: string, api: ExposedElectronApi) => {
                            exposedApi = api;
                        }
                    ),
                },
                ipcRenderer,
                webUtils: {
                    getPathForFile: jest.fn(),
                },
            }));

            await import('./main.preload');
        },
    };
}
