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
    type CorrelationHarness,
} from './preload-performance-correlation.test-helpers';

function completeDatabaseSequence(
    advance: CorrelationHarness['advance'],
    firstCallId: number,
    playlistId: string,
    operationId: string
) {
    return [
        advance({
            ipcCallId: firstCallId,
            method: PRELOAD_PERFORMANCE_METHOD.DB_GET_APP_PLAYLIST,
            operationId,
            phase: 'start',
            playlistId,
        }),
        advance({
            ipcCallId: firstCallId,
            method: PRELOAD_PERFORMANCE_METHOD.DB_GET_APP_PLAYLIST,
            operationId,
            phase: 'success',
            playlistId,
        }),
        advance({
            ipcCallId: firstCallId + 1,
            method: PRELOAD_PERFORMANCE_METHOD.DB_UPSERT_APP_PLAYLIST,
            operationId,
            phase: 'start',
            playlistId,
        }),
        advance({
            ipcCallId: firstCallId + 1,
            method: PRELOAD_PERFORMANCE_METHOD.DB_UPSERT_APP_PLAYLIST,
            operationId,
            phase: 'success',
            playlistId,
        }),
    ];
}

describe('preload performance marker correlation completions', () => {
    let advance: CorrelationHarness['advance'];

    beforeEach(() => {
        ({ advance } = createCorrelationHarness());
    });

    it.each(['success', 'error'] as const)(
        'invalidates only the matching playlist after an unknown call ID %s',
        (phase) => {
            advance({
                ipcCallId: 1,
                method: PRELOAD_PERFORMANCE_METHOD.REFRESH_PLAYLIST,
                operationId: OPERATION_ONE,
                phase: 'start',
                playlistId: PLAYLIST_ONE,
            });
            advance({
                ipcCallId: 10,
                method: PRELOAD_PERFORMANCE_METHOD.REFRESH_PLAYLIST,
                operationId: OPERATION_TWO,
                phase: 'start',
                playlistId: PLAYLIST_TWO,
            });

            const unknownCompletion = advance({
                ipcCallId: 99,
                method: PRELOAD_PERFORMANCE_METHOD.REFRESH_PLAYLIST,
                operationId: OPERATION_TWO,
                phase,
                playlistId: PLAYLIST_ONE,
            });
            const matchingCompletion = advance({
                ipcCallId: 1,
                method: PRELOAD_PERFORMANCE_METHOD.REFRESH_PLAYLIST,
                operationId: OPERATION_ONE,
                phase: 'success',
                playlistId: PLAYLIST_ONE,
            });
            const samePlaylistPersistence = completeDatabaseSequence(
                advance,
                20,
                PLAYLIST_ONE,
                OPERATION_ONE
            );

            const unrelatedRefreshCompletion = advance({
                ipcCallId: 10,
                method: PRELOAD_PERFORMANCE_METHOD.REFRESH_PLAYLIST,
                operationId: OPERATION_TWO,
                phase: 'success',
                playlistId: PLAYLIST_TWO,
            });
            const unrelatedPersistence = completeDatabaseSequence(
                advance,
                30,
                PLAYLIST_TWO,
                OPERATION_TWO
            );

            expect(unknownCompletion).toMatchObject({
                correlationState: PRELOAD_PERFORMANCE_CORRELATION_STATE.INVALID,
                invalidReason: PRELOAD_PERFORMANCE_INVALID_REASON.OUT_OF_ORDER,
                operationId: OPERATION_ONE,
                playlistId: PLAYLIST_ONE,
            });
            expect(matchingCompletion).toMatchObject({
                correlationState: PRELOAD_PERFORMANCE_CORRELATION_STATE.INVALID,
                invalidReason: PRELOAD_PERFORMANCE_INVALID_REASON.OUT_OF_ORDER,
            });
            expect(
                [matchingCompletion, ...samePlaylistPersistence].some(
                    ({ correlationState }) =>
                        correlationState ===
                        PRELOAD_PERFORMANCE_CORRELATION_STATE.COMPLETE
                )
            ).toBe(false);
            expect(unrelatedRefreshCompletion.correlationState).toBe(
                PRELOAD_PERFORMANCE_CORRELATION_STATE.CORRELATED
            );
            expect(unrelatedPersistence.at(-1)).toMatchObject({
                correlationState:
                    PRELOAD_PERFORMANCE_CORRELATION_STATE.COMPLETE,
                operationId: OPERATION_TWO,
                playlistId: PLAYLIST_TWO,
            });
        }
    );

    it('invalidates persistence after a duplicate completion without touching another playlist', () => {
        advance({
            ipcCallId: 1,
            method: PRELOAD_PERFORMANCE_METHOD.REFRESH_PLAYLIST,
            operationId: OPERATION_ONE,
            phase: 'start',
            playlistId: PLAYLIST_ONE,
        });
        advance({
            ipcCallId: 10,
            method: PRELOAD_PERFORMANCE_METHOD.REFRESH_PLAYLIST,
            operationId: OPERATION_TWO,
            phase: 'start',
            playlistId: PLAYLIST_TWO,
        });
        advance({
            ipcCallId: 1,
            method: PRELOAD_PERFORMANCE_METHOD.REFRESH_PLAYLIST,
            operationId: OPERATION_ONE,
            phase: 'success',
            playlistId: PLAYLIST_ONE,
        });

        const duplicateCompletion = advance({
            ipcCallId: 1,
            method: PRELOAD_PERFORMANCE_METHOD.REFRESH_PLAYLIST,
            operationId: OPERATION_ONE,
            phase: 'success',
            playlistId: PLAYLIST_ONE,
        });
        const samePlaylistPersistence = completeDatabaseSequence(
            advance,
            20,
            PLAYLIST_ONE,
            OPERATION_ONE
        );

        advance({
            ipcCallId: 10,
            method: PRELOAD_PERFORMANCE_METHOD.REFRESH_PLAYLIST,
            operationId: OPERATION_TWO,
            phase: 'success',
            playlistId: PLAYLIST_TWO,
        });
        const unrelatedPersistence = completeDatabaseSequence(
            advance,
            30,
            PLAYLIST_TWO,
            OPERATION_TWO
        );

        expect(duplicateCompletion).toMatchObject({
            correlationState: PRELOAD_PERFORMANCE_CORRELATION_STATE.INVALID,
            invalidReason: PRELOAD_PERFORMANCE_INVALID_REASON.OUT_OF_ORDER,
            operationId: OPERATION_ONE,
            playlistId: PLAYLIST_ONE,
        });
        expect(
            samePlaylistPersistence.some(
                ({ correlationState }) =>
                    correlationState ===
                    PRELOAD_PERFORMANCE_CORRELATION_STATE.COMPLETE
            )
        ).toBe(false);
        expect(unrelatedPersistence.at(-1)).toMatchObject({
            correlationState: PRELOAD_PERFORMANCE_CORRELATION_STATE.COMPLETE,
            operationId: OPERATION_TWO,
            playlistId: PLAYLIST_TWO,
        });
    });

    it('invalidates a correlated sequence when a target call errors', () => {
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

        const error = advance({
            ipcCallId: 2,
            method: PRELOAD_PERFORMANCE_METHOD.DB_GET_APP_PLAYLIST,
            operationId: OPERATION_ONE,
            phase: 'error',
            playlistId: PLAYLIST_ONE,
        });
        const laterUpsert = advance({
            ipcCallId: 3,
            method: PRELOAD_PERFORMANCE_METHOD.DB_UPSERT_APP_PLAYLIST,
            operationId: OPERATION_ONE,
            phase: 'start',
            playlistId: PLAYLIST_ONE,
        });
        const restart = advance({
            ipcCallId: 4,
            method: PRELOAD_PERFORMANCE_METHOD.REFRESH_PLAYLIST,
            operationId: OPERATION_TWO,
            phase: 'start',
            playlistId: PLAYLIST_ONE,
        });

        expect(error).toMatchObject({
            correlationState: PRELOAD_PERFORMANCE_CORRELATION_STATE.INVALID,
            invalidReason: PRELOAD_PERFORMANCE_INVALID_REASON.IPC_ERROR,
            operationId: OPERATION_ONE,
        });
        expect(laterUpsert).toMatchObject({
            correlationState:
                PRELOAD_PERFORMANCE_CORRELATION_STATE.UNCORRELATED,
            invalidReason: null,
            operationId: OPERATION_ONE,
        });
        expect(restart.correlationState).toBe(
            PRELOAD_PERFORMANCE_CORRELATION_STATE.CORRELATED
        );
    });

    it('closes a cancelled refresh without awaiting database persistence', () => {
        advance({
            ipcCallId: 1,
            method: PRELOAD_PERFORMANCE_METHOD.REFRESH_PLAYLIST,
            operationId: OPERATION_ONE,
            phase: 'start',
            playlistId: PLAYLIST_ONE,
        });

        const cancelled = advance({
            ipcCallId: 1,
            method: PRELOAD_PERFORMANCE_METHOD.REFRESH_PLAYLIST,
            operationId: OPERATION_ONE,
            phase: 'success',
            playlistId: PLAYLIST_ONE,
            refreshCancelled: true,
        });
        const laterGet = advance({
            ipcCallId: 2,
            method: PRELOAD_PERFORMANCE_METHOD.DB_GET_APP_PLAYLIST,
            operationId: OPERATION_ONE,
            phase: 'start',
            playlistId: PLAYLIST_ONE,
        });

        expect(cancelled).toMatchObject({
            correlationState: PRELOAD_PERFORMANCE_CORRELATION_STATE.INVALID,
            invalidReason: PRELOAD_PERFORMANCE_INVALID_REASON.REFRESH_CANCELLED,
            operationId: OPERATION_ONE,
        });
        expect(laterGet).toMatchObject({
            correlationState:
                PRELOAD_PERFORMANCE_CORRELATION_STATE.UNCORRELATED,
            invalidReason: null,
            operationId: OPERATION_ONE,
        });
    });
});
