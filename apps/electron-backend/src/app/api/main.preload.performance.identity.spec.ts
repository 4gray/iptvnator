import {
    PRELOAD_PERFORMANCE_CORRELATION_STATE,
    PRELOAD_PERFORMANCE_METHOD,
} from '@iptvnator/shared/interfaces';
import {
    createPlaylist,
    createPreloadPerformanceHarness,
    createRefreshPayload,
    PRELOAD_ENVIRONMENT,
    type PreloadPerformanceHarness,
} from './main.preload.performance.test-helpers';

describe('main preload performance marker identities', () => {
    let harness: PreloadPerformanceHarness;

    beforeEach(async () => {
        harness = createPreloadPerformanceHarness();
        await harness.load({
            [PRELOAD_ENVIRONMENT.PERF_CAPTURE]: '1',
        });
    });

    afterEach(() => {
        harness.cleanup();
    });

    it('completes only for database calls carrying the refresh operation ID', async () => {
        const payload = createRefreshPayload();
        const playlist = createPlaylist(payload.playlistId);
        harness.ipcRenderer.invoke.mockResolvedValue(playlist);
        const api = harness.getApi();

        await api.refreshPlaylist(payload);
        await api.dbGetAppPlaylist(payload.playlistId);
        await api.dbUpsertAppPlaylist(playlist);
        await api.dbGetAppPlaylist(payload.playlistId, 'other-operation');
        await api.dbUpsertAppPlaylist(playlist, 'other-operation');

        expect(
            harness
                .getMarkers()
                .slice(2)
                .every(
                    ({ correlationState }) =>
                        correlationState ===
                        PRELOAD_PERFORMANCE_CORRELATION_STATE.UNCORRELATED
                )
        ).toBe(true);
        expect(
            harness
                .getMarkers()
                .some(
                    ({ correlationState }) =>
                        correlationState ===
                        PRELOAD_PERFORMANCE_CORRELATION_STATE.COMPLETE
                )
        ).toBe(false);

        await api.dbGetAppPlaylist(payload.playlistId, payload.operationId);
        await api.dbUpsertAppPlaylist(playlist, payload.operationId);

        const markers = harness.getMarkers();
        expect(markers.at(-1)).toMatchObject({
            correlationState: PRELOAD_PERFORMANCE_CORRELATION_STATE.COMPLETE,
            method: PRELOAD_PERFORMANCE_METHOD.DB_UPSERT_APP_PLAYLIST,
            operationId: payload.operationId,
            playlistId: payload.playlistId,
        });
        expect(harness.ipcRenderer.invoke.mock.calls).toEqual([
            ['PLAYLIST:REFRESH', payload],
            ['DB_GET_APP_PLAYLIST', payload.playlistId],
            ['DB_UPSERT_APP_PLAYLIST', playlist],
            ['DB_GET_APP_PLAYLIST', payload.playlistId],
            ['DB_UPSERT_APP_PLAYLIST', playlist],
            ['DB_GET_APP_PLAYLIST', payload.playlistId],
            ['DB_UPSERT_APP_PLAYLIST', playlist],
        ]);
    });
});
