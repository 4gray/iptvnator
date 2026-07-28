export interface DatabaseWorkerCancelTimelineRecord {
    readonly epochMs: number;
    readonly ipcCallId: number;
    readonly operationId: string;
    readonly requestId: string;
    readonly sourceEpochMs: number;
    readonly type:
        | 'db-cancel-dispatched'
        | 'db-cancel-received'
        | 'db-cancel-terminal-received';
}

export interface DatabaseWorkerCancelCaptureSnapshot {
    readonly invalidReasons: readonly string[];
    readonly timeline: readonly DatabaseWorkerCancelTimelineRecord[];
}

export interface DatabaseWorkerCancelCapture {
    acceptDispatch(input: unknown): boolean;
    acceptReceipt(input: {
        readonly captureGeneration: number;
        readonly message: unknown;
        readonly receivedEpochMs: number;
        readonly recordGeneration: number | null;
    }): boolean;
    acceptTerminal(input: {
        readonly captureGeneration: number;
        readonly operationId: string;
        readonly receivedEpochMs: number;
        readonly recordGeneration: number | null;
        readonly requestId: string;
    }): boolean;
    start(captureGeneration: number): void;
    stop(): DatabaseWorkerCancelCaptureSnapshot;
}

export function createDatabaseWorkerCancelCapture(): DatabaseWorkerCancelCapture {
    type JsonRecord = Record<string, unknown>;
    interface DispatchState {
        readonly captureGeneration: number;
        readonly ipcCallId: number;
        readonly operationId: string;
        readonly postedEpochMs: number;
        readonly requestId: string;
        readonly sourceEpochMs: number;
        receiptEpochMs: number | null;
        terminalEpochMs: number | null;
    }

    const dispatchKeys = new Set([
        'captureGeneration',
        'ipcCallId',
        'operationId',
        'postedEpochMs',
        'requestId',
        'sourceEpochMs',
    ]);
    const receiptKeys = new Set([
        'type',
        'epochMs',
        'operationId',
        'requestId',
    ]);
    const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
    let active = false;
    let generation = 0;
    let invalidReasons: string[] = [];
    let timeline: DatabaseWorkerCancelTimelineRecord[] = [];
    const dispatches = new Map<string, DispatchState>();
    const helpers = {
        invalidate(reason: string): false {
            invalidReasons.push(reason);
            return false;
        },
        isEpoch(value: unknown): value is number {
            return (
                typeof value === 'number' && Number.isFinite(value) && value > 0
            );
        },
        isGeneration(value: unknown): value is number {
            return Number.isSafeInteger(value) && Number(value) > 0;
        },
        isIdentifier(value: unknown): value is string {
            return typeof value === 'string' && identifierPattern.test(value);
        },
        isRecord(value: unknown): value is JsonRecord {
            return (
                typeof value === 'object' &&
                value !== null &&
                !Array.isArray(value)
            );
        },
        ownsOnly(value: JsonRecord, keys: ReadonlySet<string>): boolean {
            const ownKeys = Reflect.ownKeys(value);
            return (
                ownKeys.length === keys.size &&
                ownKeys.every((key) => typeof key === 'string' && keys.has(key))
            );
        },
        timelineRecord(
            dispatch: DispatchState,
            epochMs: number,
            type: DatabaseWorkerCancelTimelineRecord['type']
        ): DatabaseWorkerCancelTimelineRecord {
            return {
                epochMs,
                ipcCallId: dispatch.ipcCallId,
                operationId: dispatch.operationId,
                requestId: dispatch.requestId,
                sourceEpochMs: dispatch.sourceEpochMs,
                type,
            };
        },
    };
    return {
        acceptDispatch(input): boolean {
            try {
                if (
                    !active ||
                    !helpers.isRecord(input) ||
                    !helpers.ownsOnly(input, dispatchKeys) ||
                    input['captureGeneration'] !== generation ||
                    !helpers.isGeneration(input['captureGeneration']) ||
                    !Number.isSafeInteger(input['ipcCallId']) ||
                    Number(input['ipcCallId']) <= 0 ||
                    !helpers.isIdentifier(input['operationId']) ||
                    !helpers.isIdentifier(input['requestId']) ||
                    !helpers.isEpoch(input['postedEpochMs']) ||
                    !helpers.isEpoch(input['sourceEpochMs']) ||
                    Number(input['sourceEpochMs']) >
                        Number(input['postedEpochMs'])
                ) {
                    return helpers.invalidate('cancel-dispatch-invalid');
                }
                const requestId = input['requestId'];
                if (dispatches.has(requestId)) {
                    return helpers.invalidate('cancel-dispatch-duplicate');
                }
                const dispatch = {
                    captureGeneration: generation,
                    ipcCallId: Number(input['ipcCallId']),
                    operationId: input['operationId'],
                    postedEpochMs: Number(input['postedEpochMs']),
                    receiptEpochMs: null,
                    requestId,
                    sourceEpochMs: Number(input['sourceEpochMs']),
                    terminalEpochMs: null,
                };
                dispatches.set(requestId, dispatch);
                timeline.push(
                    helpers.timelineRecord(
                        dispatch,
                        dispatch.postedEpochMs,
                        'db-cancel-dispatched'
                    )
                );
                return true;
            } catch {
                return helpers.invalidate('cancel-dispatch-invalid');
            }
        },
        acceptReceipt(input): boolean {
            try {
                if (
                    !active ||
                    input.captureGeneration !== generation ||
                    input.recordGeneration !== generation
                ) {
                    return helpers.invalidate(
                        'cancel-receipt-generation-mismatch'
                    );
                }
                const message = input.message;
                if (
                    !helpers.isRecord(message) ||
                    !helpers.ownsOnly(message, receiptKeys) ||
                    message['type'] !== 'performance-cancel-received' ||
                    !helpers.isIdentifier(message['operationId']) ||
                    !helpers.isIdentifier(message['requestId']) ||
                    !helpers.isEpoch(message['epochMs']) ||
                    !helpers.isEpoch(input.receivedEpochMs)
                ) {
                    return helpers.invalidate('cancel-receipt-invalid-schema');
                }
                const dispatch = dispatches.get(message['requestId']);
                if (!dispatch) {
                    return helpers.invalidate(
                        'cancel-receipt-dispatch-missing'
                    );
                }
                if (dispatch.operationId !== message['operationId']) {
                    return helpers.invalidate(
                        'cancel-receipt-correlation-mismatch'
                    );
                }
                if (
                    Number(message['epochMs']) < dispatch.postedEpochMs ||
                    Number(message['epochMs']) > input.receivedEpochMs
                ) {
                    return helpers.invalidate('cancel-receipt-epoch-invalid');
                }
                if (dispatch.receiptEpochMs !== null) {
                    return helpers.invalidate('cancel-receipt-duplicate');
                }
                dispatch.receiptEpochMs = Number(message['epochMs']);
                timeline.push(
                    helpers.timelineRecord(
                        dispatch,
                        dispatch.receiptEpochMs,
                        'db-cancel-received'
                    )
                );
                return true;
            } catch {
                return helpers.invalidate('cancel-receipt-invalid-schema');
            }
        },
        acceptTerminal(input): boolean {
            try {
                if (
                    !active ||
                    input.captureGeneration !== generation ||
                    input.recordGeneration !== generation
                ) {
                    return helpers.invalidate(
                        'cancel-terminal-generation-mismatch'
                    );
                }
                if (
                    !helpers.isIdentifier(input.operationId) ||
                    !helpers.isIdentifier(input.requestId) ||
                    !helpers.isEpoch(input.receivedEpochMs)
                ) {
                    return helpers.invalidate('cancel-terminal-invalid');
                }
                const dispatch = dispatches.get(input.requestId);
                if (!dispatch) {
                    return helpers.invalidate(
                        'cancel-terminal-dispatch-missing'
                    );
                }
                if (dispatch.operationId !== input.operationId) {
                    return helpers.invalidate(
                        'cancel-terminal-correlation-mismatch'
                    );
                }
                if (
                    dispatch.receiptEpochMs === null ||
                    input.receivedEpochMs < dispatch.receiptEpochMs
                ) {
                    return helpers.invalidate('cancel-terminal-before-receipt');
                }
                if (dispatch.terminalEpochMs !== null) {
                    return helpers.invalidate('cancel-terminal-duplicate');
                }
                dispatch.terminalEpochMs = input.receivedEpochMs;
                timeline.push(
                    helpers.timelineRecord(
                        dispatch,
                        dispatch.terminalEpochMs,
                        'db-cancel-terminal-received'
                    )
                );
                return true;
            } catch {
                return helpers.invalidate('cancel-terminal-invalid');
            }
        },
        start(captureGeneration): void {
            if (!helpers.isGeneration(captureGeneration)) {
                throw new Error('database-worker-cancel-generation-invalid');
            }
            active = true;
            generation = captureGeneration;
            invalidReasons = [];
            timeline = [];
            dispatches.clear();
        },
        stop(): DatabaseWorkerCancelCaptureSnapshot {
            for (const dispatch of dispatches.values()) {
                if (dispatch.receiptEpochMs === null) {
                    invalidReasons.push('cancel-receipt-missing');
                }
                if (dispatch.terminalEpochMs === null) {
                    invalidReasons.push('cancel-terminal-missing');
                }
            }
            active = false;
            return Object.freeze({
                invalidReasons: Object.freeze([...invalidReasons]),
                timeline: Object.freeze([...timeline]),
            });
        },
    };
}
