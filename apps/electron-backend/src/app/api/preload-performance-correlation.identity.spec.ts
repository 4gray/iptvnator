import {
    PRELOAD_PERFORMANCE_CORRELATION_STATE,
    PRELOAD_PERFORMANCE_INVALID_REASON,
    PRELOAD_PERFORMANCE_METHOD,
} from '@iptvnator/shared/interfaces';
import {
    createCorrelationHarness,
    OPERATION_ONE,
    OPERATION_TWO,
    PLAYLIST_ONE,
    PLAYLIST_TWO,
} from './preload-performance-correlation.test-helpers';

describe('preload performance correlation identities', () => {
    it('advances only database calls tagged with the refresh operation', () => {
        const { advance } = createCorrelationHarness();
        advance({
            ipcCallId: 1,
            method: PRELOAD_PERFORMANCE_METHOD.REFRESH_PLAYLIST,
            operationId: OPERATION_ONE,
            phase: 'start',
            playlistId: PLAYLIST_ONE,
        });
        advance({
            ipcCallId: 1,
            method: PRELOAD_PERFORMANCE_METHOD.REFRESH_PLAYLIST,
            operationId: OPERATION_ONE,
            phase: 'success',
            playlistId: PLAYLIST_ONE,
        });

        const unrelated = [
            advance({
                ipcCallId: 2,
                method: PRELOAD_PERFORMANCE_METHOD.DB_GET_APP_PLAYLIST,
                operationId: null,
                phase: 'start',
                playlistId: PLAYLIST_ONE,
            }),
            advance({
                ipcCallId: 2,
                method: PRELOAD_PERFORMANCE_METHOD.DB_GET_APP_PLAYLIST,
                operationId: null,
                phase: 'success',
                playlistId: PLAYLIST_ONE,
            }),
            advance({
                ipcCallId: 3,
                method: PRELOAD_PERFORMANCE_METHOD.DB_UPSERT_APP_PLAYLIST,
                operationId: OPERATION_TWO,
                phase: 'start',
                playlistId: PLAYLIST_ONE,
            }),
            advance({
                ipcCallId: 3,
                method: PRELOAD_PERFORMANCE_METHOD.DB_UPSERT_APP_PLAYLIST,
                operationId: OPERATION_TWO,
                phase: 'success',
                playlistId: PLAYLIST_ONE,
            }),
        ];

        expect(
            unrelated.every(
                ({ correlationState }) =>
                    correlationState ===
                    PRELOAD_PERFORMANCE_CORRELATION_STATE.UNCORRELATED
            )
        ).toBe(true);

        for (const event of [
            {
                ipcCallId: 4,
                method: PRELOAD_PERFORMANCE_METHOD.DB_GET_APP_PLAYLIST,
                phase: 'start',
            },
            {
                ipcCallId: 4,
                method: PRELOAD_PERFORMANCE_METHOD.DB_GET_APP_PLAYLIST,
                phase: 'success',
            },
            {
                ipcCallId: 5,
                method: PRELOAD_PERFORMANCE_METHOD.DB_UPSERT_APP_PLAYLIST,
                phase: 'start',
            },
        ] as const) {
            advance({
                ...event,
                operationId: OPERATION_ONE,
                playlistId: PLAYLIST_ONE,
            });
        }
        const complete = advance({
            ipcCallId: 5,
            method: PRELOAD_PERFORMANCE_METHOD.DB_UPSERT_APP_PLAYLIST,
            operationId: OPERATION_ONE,
            phase: 'success',
            playlistId: PLAYLIST_ONE,
        });

        expect(complete).toMatchObject({
            correlationState: PRELOAD_PERFORMANCE_CORRELATION_STATE.COMPLETE,
            operationId: OPERATION_ONE,
            playlistId: PLAYLIST_ONE,
        });
    });

    it.each([
        {
            label: 'operation',
            method: PRELOAD_PERFORMANCE_METHOD.DB_GET_APP_PLAYLIST,
            operationId: OPERATION_TWO,
            playlistId: PLAYLIST_ONE,
        },
        {
            label: 'playlist',
            method: PRELOAD_PERFORMANCE_METHOD.DB_GET_APP_PLAYLIST,
            operationId: OPERATION_ONE,
            playlistId: PLAYLIST_TWO,
        },
        {
            label: 'method',
            method: PRELOAD_PERFORMANCE_METHOD.DB_UPSERT_APP_PLAYLIST,
            operationId: OPERATION_ONE,
            playlistId: PLAYLIST_ONE,
        },
    ])(
        'fails closed when the completion changes the started $label',
        ({ method, operationId, playlistId }) => {
            const { advance } = createCorrelationHarness();
            advance({
                ipcCallId: 1,
                method: PRELOAD_PERFORMANCE_METHOD.REFRESH_PLAYLIST,
                operationId: OPERATION_ONE,
                phase: 'start',
                playlistId: PLAYLIST_ONE,
            });
            advance({
                ipcCallId: 1,
                method: PRELOAD_PERFORMANCE_METHOD.REFRESH_PLAYLIST,
                operationId: OPERATION_ONE,
                phase: 'success',
                playlistId: PLAYLIST_ONE,
            });
            advance({
                ipcCallId: 2,
                method: PRELOAD_PERFORMANCE_METHOD.DB_GET_APP_PLAYLIST,
                operationId: OPERATION_ONE,
                phase: 'start',
                playlistId: PLAYLIST_ONE,
            });

            const completion = advance({
                ipcCallId: 2,
                method,
                operationId,
                phase: 'success',
                playlistId,
            });
            const laterUpsert = advance({
                ipcCallId: 3,
                method: PRELOAD_PERFORMANCE_METHOD.DB_UPSERT_APP_PLAYLIST,
                operationId: OPERATION_ONE,
                phase: 'start',
                playlistId: PLAYLIST_ONE,
            });

            expect(completion).toMatchObject({
                correlationState: PRELOAD_PERFORMANCE_CORRELATION_STATE.INVALID,
                invalidReason: PRELOAD_PERFORMANCE_INVALID_REASON.OUT_OF_ORDER,
                method: PRELOAD_PERFORMANCE_METHOD.DB_GET_APP_PLAYLIST,
                operationId: OPERATION_ONE,
                playlistId: PLAYLIST_ONE,
            });
            expect(laterUpsert).toMatchObject({
                correlationState:
                    PRELOAD_PERFORMANCE_CORRELATION_STATE.UNCORRELATED,
                invalidReason: null,
            });
        }
    );
});
