import {
    PRELOAD_PERFORMANCE_CORRELATION_STATE,
    PRELOAD_PERFORMANCE_INVALID_REASON,
    PRELOAD_PERFORMANCE_MARKER_CHANNEL,
    PRELOAD_PERFORMANCE_METHOD,
    type Playlist,
    type PreloadPerformanceMarker,
} from '@iptvnator/shared/interfaces';
import {
    createPlaylist,
    createPreloadPerformanceHarness,
    createRefreshPayload,
    expectFixedMarkers,
    PRELOAD_ENVIRONMENT,
    type PreloadPerformanceHarness,
} from './main.preload.performance.test-helpers';

describe('main preload performance marker contract', () => {
    let harness: PreloadPerformanceHarness;

    beforeEach(() => {
        harness = createPreloadPerformanceHarness();
    });

    afterEach(() => {
        harness.cleanup();
    });

    async function loadPerformancePreload(): Promise<void> {
        await harness.load({
            [PRELOAD_ENVIRONMENT.PERF_CAPTURE]: '1',
        });
    }

    it('preserves calls while emitting ordered, correlated, fixed, redacted markers', async () => {
        const secrets = {
            favorite: 'sentinel-favorite-secret',
            filePath: '/sentinel/private/playlist.m3u',
            host: 'sentinel.private.example',
            item: 'sentinel-item-secret',
            result: 'sentinel-result-secret',
            title: 'sentinel-title-secret',
            url: 'https://sentinel.example/private.m3u?token=secret',
        };
        const payload = createRefreshPayload({
            filePath: secrets.filePath,
            title: secrets.title,
            trustedInsecureTlsHosts: [secrets.host],
            url: secrets.url,
        });
        const refreshedPlaylist = createPlaylist(payload.playlistId, {
            favorites: [secrets.favorite],
            items: [{ name: secrets.item }],
            title: secrets.title,
            url: secrets.url,
        });
        const storedPlaylist = createPlaylist(payload.playlistId, {
            filePath: secrets.filePath,
            title: secrets.title,
        });
        const upsertPlaylist = createPlaylist(payload.playlistId, {
            favorites: [secrets.favorite],
            items: [{ name: secrets.item }],
            title: secrets.title,
        });
        const upsertResult = {
            secretResult: secrets.result,
            success: true,
        };
        await loadPerformancePreload();
        harness.ipcRenderer.invoke
            .mockResolvedValueOnce(refreshedPlaylist)
            .mockResolvedValueOnce(storedPlaylist)
            .mockResolvedValueOnce(upsertResult);
        const api = harness.getApi();

        await expect(api.refreshPlaylist(payload)).resolves.toBe(
            refreshedPlaylist
        );
        await expect(api.dbGetAppPlaylist(payload.playlistId)).resolves.toBe(
            storedPlaylist
        );
        await expect(api.dbUpsertAppPlaylist(upsertPlaylist)).resolves.toBe(
            upsertResult
        );

        expect(harness.ipcRenderer.invoke.mock.calls).toEqual([
            ['PLAYLIST:REFRESH', payload],
            ['DB_GET_APP_PLAYLIST', payload.playlistId],
            ['DB_UPSERT_APP_PLAYLIST', upsertPlaylist],
        ]);
        const markers = harness.getMarkers();
        expect(markers).toHaveLength(6);
        expect(
            markers.map(({ ipcCallId, method, phase }) => [
                ipcCallId,
                method,
                phase,
            ])
        ).toEqual([
            [1, PRELOAD_PERFORMANCE_METHOD.REFRESH_PLAYLIST, 'start'],
            [1, PRELOAD_PERFORMANCE_METHOD.REFRESH_PLAYLIST, 'success'],
            [2, PRELOAD_PERFORMANCE_METHOD.DB_GET_APP_PLAYLIST, 'start'],
            [2, PRELOAD_PERFORMANCE_METHOD.DB_GET_APP_PLAYLIST, 'success'],
            [3, PRELOAD_PERFORMANCE_METHOD.DB_UPSERT_APP_PLAYLIST, 'start'],
            [3, PRELOAD_PERFORMANCE_METHOD.DB_UPSERT_APP_PLAYLIST, 'success'],
        ]);
        expect(markers.map(({ correlationState }) => correlationState)).toEqual(
            [
                PRELOAD_PERFORMANCE_CORRELATION_STATE.CORRELATED,
                PRELOAD_PERFORMANCE_CORRELATION_STATE.CORRELATED,
                PRELOAD_PERFORMANCE_CORRELATION_STATE.CORRELATED,
                PRELOAD_PERFORMANCE_CORRELATION_STATE.CORRELATED,
                PRELOAD_PERFORMANCE_CORRELATION_STATE.CORRELATED,
                PRELOAD_PERFORMANCE_CORRELATION_STATE.COMPLETE,
            ]
        );
        expect(markers.map(({ operationId }) => operationId)).toEqual(
            Array(6).fill(payload.operationId)
        );
        expect(markers.map(({ playlistId }) => playlistId)).toEqual(
            Array(6).fill(payload.playlistId)
        );
        expect(markers.map(({ invalidReason }) => invalidReason)).toEqual(
            Array(6).fill(null)
        );
        expectFixedMarkers(markers);

        const markerSendOrders = harness.ipcRenderer.send.mock.calls.flatMap(
            ([channel], index) =>
                channel === PRELOAD_PERFORMANCE_MARKER_CHANNEL
                    ? [harness.ipcRenderer.send.mock.invocationCallOrder[index]]
                    : []
        );
        const invokeOrders =
            harness.ipcRenderer.invoke.mock.invocationCallOrder;
        for (const [index, invokeOrder] of invokeOrders.entries()) {
            expect(markerSendOrders[index * 2]).toBeLessThan(invokeOrder);
        }

        const serializedMarkers = JSON.stringify(markers);
        for (const secret of Object.values(secrets)) {
            expect(serializedMarkers).not.toContain(secret);
        }
    });

    it('preserves rejection identity and emits a redacted error', async () => {
        const payload = createRefreshPayload({
            title: 'sentinel-rejection-title',
            url: 'https://sentinel.example/rejected.m3u',
        });
        const rejection = new Error('sentinel-rejection-error');
        await loadPerformancePreload();
        harness.ipcRenderer.invoke.mockRejectedValueOnce(rejection);

        await expect(harness.getApi().refreshPlaylist(payload)).rejects.toBe(
            rejection
        );

        const markers = harness.getMarkers();
        expect(markerPhases(markers)).toEqual([
            [1, 'start'],
            [1, 'error'],
        ]);
        expect(markers[1]).toMatchObject({
            correlationState: PRELOAD_PERFORMANCE_CORRELATION_STATE.INVALID,
            invalidReason: PRELOAD_PERFORMANCE_INVALID_REASON.IPC_ERROR,
            operationId: payload.operationId,
            playlistId: payload.playlistId,
        });
        expect(JSON.stringify(markers)).not.toContain(rejection.message);
        expect(JSON.stringify(markers)).not.toContain(payload.title);
        expect(JSON.stringify(markers)).not.toContain(payload.url);
    });

    it('preserves synchronous throw identity and emits a redacted error', async () => {
        const synchronousError = new Error('sentinel-synchronous-error');
        const payload = createRefreshPayload();
        await loadPerformancePreload();
        harness.ipcRenderer.invoke.mockImplementationOnce(() => {
            throw synchronousError;
        });

        let caughtError: unknown;
        try {
            harness.getApi().refreshPlaylist(payload);
        } catch (error) {
            caughtError = error;
        }

        expect(caughtError).toBe(synchronousError);
        const markers = harness.getMarkers();
        expect(markerPhases(markers)).toEqual([
            [1, 'start'],
            [1, 'error'],
        ]);
        expect(markers[1]).toMatchObject({
            correlationState: PRELOAD_PERFORMANCE_CORRELATION_STATE.INVALID,
            invalidReason: PRELOAD_PERFORMANCE_INVALID_REASON.IPC_ERROR,
        });
        expect(JSON.stringify(markers)).not.toContain(synchronousError.message);
    });

    it('closes a structured refresh cancellation with a fixed reason', async () => {
        const payload = createRefreshPayload();
        const cancelledResult = {
            operationId: payload.operationId,
            type: 'playlist-refresh-cancelled',
        } as const;
        await loadPerformancePreload();
        harness.ipcRenderer.invoke
            .mockResolvedValueOnce(cancelledResult)
            .mockResolvedValueOnce(null);
        const api = harness.getApi();

        await expect(api.refreshPlaylist(payload)).resolves.toBe(
            cancelledResult
        );
        await api.dbGetAppPlaylist(payload.playlistId);

        const markers = harness.getMarkers();
        expect(markers[1]).toMatchObject({
            correlationState: PRELOAD_PERFORMANCE_CORRELATION_STATE.INVALID,
            invalidReason: PRELOAD_PERFORMANCE_INVALID_REASON.REFRESH_CANCELLED,
            ipcCallId: 1,
            method: PRELOAD_PERFORMANCE_METHOD.REFRESH_PLAYLIST,
            operationId: payload.operationId,
            phase: 'success',
            playlistId: payload.playlistId,
        });
        expect(markers[2]).toMatchObject({
            correlationState:
                PRELOAD_PERFORMANCE_CORRELATION_STATE.UNCORRELATED,
            ipcCallId: 2,
            method: PRELOAD_PERFORMANCE_METHOD.DB_GET_APP_PLAYLIST,
            operationId: null,
            phase: 'start',
        });
    });

    it('uses the exact upsert _id and keeps one malformed reason in both phases', async () => {
        const malformedPlaylist = {
            ...createPlaylist('placeholder'),
            _id: {
                secret: 'sentinel-malformed-playlist-id',
            },
        } as unknown as Playlist;
        const result = { success: true };
        await loadPerformancePreload();
        harness.ipcRenderer.invoke.mockResolvedValueOnce(result);

        await expect(
            harness.getApi().dbUpsertAppPlaylist(malformedPlaylist)
        ).resolves.toBe(result);
        expect(harness.ipcRenderer.invoke).toHaveBeenCalledWith(
            'DB_UPSERT_APP_PLAYLIST',
            malformedPlaylist
        );

        const markers = harness.getMarkers();
        expect(
            markers.map(
                ({ correlationState, invalidReason, phase, playlistId }) => ({
                    correlationState,
                    invalidReason,
                    phase,
                    playlistId,
                })
            )
        ).toEqual([
            {
                correlationState: PRELOAD_PERFORMANCE_CORRELATION_STATE.INVALID,
                invalidReason:
                    PRELOAD_PERFORMANCE_INVALID_REASON.MALFORMED_IDENTIFIER,
                phase: 'start',
                playlistId: null,
            },
            {
                correlationState: PRELOAD_PERFORMANCE_CORRELATION_STATE.INVALID,
                invalidReason:
                    PRELOAD_PERFORMANCE_INVALID_REASON.MALFORMED_IDENTIFIER,
                phase: 'success',
                playlistId: null,
            },
        ]);
        expect(markers[0].ipcCallId).toBe(markers[1].ipcCallId);
        expect(JSON.stringify(markers)).not.toContain(
            'sentinel-malformed-playlist-id'
        );
    });

    it('keeps results unchanged when marker delivery throws', async () => {
        const payload = createRefreshPayload();
        const result = createPlaylist(payload.playlistId);
        await loadPerformancePreload();
        harness.ipcRenderer.invoke.mockResolvedValueOnce(result);
        harness.ipcRenderer.send.mockImplementation((channel: string) => {
            if (channel === PRELOAD_PERFORMANCE_MARKER_CHANNEL) {
                throw new Error('marker-send-failed');
            }
        });

        await expect(harness.getApi().refreshPlaylist(payload)).resolves.toBe(
            result
        );
        expect(
            harness.ipcRenderer.send.mock.calls.filter(
                ([channel]) => channel === PRELOAD_PERFORMANCE_MARKER_CHANNEL
            )
        ).toHaveLength(2);
    });
});

function markerPhases(
    markers: PreloadPerformanceMarker[]
): [number, PreloadPerformanceMarker['phase']][] {
    return markers.map(({ ipcCallId, phase }) => [ipcCallId, phase]);
}
