import type { XtreamIpcMarkerCaptureOptions } from './xtream-ipc-marker-events.model';
import type { XtreamIpcRequestIdentity } from './xtream-ipc-marker-events.model';

export interface SafeXtreamPreloadMarker {
    action: string | null;
    boundary: 'end' | 'start';
    categoryType: string | null;
    contentType: string | null;
    ipcCallId: number;
    itemCount: number | null;
    method: string;
    operationId: string | null;
    outcome: 'error' | 'success' | null;
    playlistId: string | null;
    schemaVersion: number;
    sessionId: string | null;
    sourceEpochMs: number;
}

export interface SafeXtreamMainPhase {
    boundary: 'end' | 'start';
    durationMs: number | null;
    epochMs: number;
    phase: string;
    requestId: string;
}

export interface XtreamIpcMarkerProtocol {
    applyMarkerIdentity(
        identity: XtreamIpcRequestIdentity,
        marker: SafeXtreamPreloadMarker
    ): void;
    correlationKey(marker: SafeXtreamPreloadMarker): string | null;
    isEpoch(value: unknown): value is number;
    parseMainPhase(input: unknown): SafeXtreamMainPhase | null;
    parseMarker(input: unknown): SafeXtreamPreloadMarker | null;
    readCancelKey(input: unknown): string | null | undefined;
    readRequestKey(input: unknown): string | null | undefined;
    sameMarkerIdentity(
        start: SafeXtreamPreloadMarker,
        end: SafeXtreamPreloadMarker
    ): boolean;
    unavailableIdentity(reason: string): XtreamIpcRequestIdentity;
}

export function createXtreamIpcMarkerProtocol(
    options: XtreamIpcMarkerCaptureOptions
): XtreamIpcMarkerProtocol {
    type JsonRecord = Record<string, unknown>;
    const markerKeys = new Set([
        'schemaVersion',
        'sourceEpochMs',
        'ipcCallId',
        'method',
        'boundary',
        'outcome',
        'playlistId',
        'operationId',
        'sessionId',
        'action',
        'categoryType',
        'contentType',
        'itemCount',
    ]);
    const actions = new Set(options.actions);
    const mainPhases = new Set(options.mainPhases);
    const methods = new Set(options.methods);
    const categoryTypes = new Set(['live', 'movies', 'series']);
    const contentTypes = new Set(['live', 'movie', 'series']);
    const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
    const rendererRequestId = /^xtream-[0-9a-z]+-[1-9][0-9]*$/;
    const internalRequestId =
        /^xtream-main-(?:fallback-[1-9][0-9]*|[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/;
    const operationToMethod: Readonly<Record<string, string>> = {
        DB_DELETE_PLAYLIST: 'dbDeletePlaylist',
        DB_DELETE_XTREAM_CONTENT: 'dbDeleteXtreamContent',
        DB_GET_CATEGORIES: 'dbGetCategories',
        DB_GET_CONTENT: 'dbGetContent',
        DB_GLOBAL_SEARCH: 'dbGlobalSearch',
        DB_RESTORE_XTREAM_USER_DATA: 'dbRestoreXtreamUserData',
        DB_SAVE_CATEGORIES: 'dbSaveCategories',
        DB_SAVE_CONTENT: 'dbSaveContent',
        DB_SEARCH_CONTENT: 'dbSearchContent',
    };
    const helpers = {
        correlationKey(marker: SafeXtreamPreloadMarker): string | null {
            const values: Array<number | string | null> = [marker.method];
            switch (marker.method) {
                case 'xtreamRequest':
                    if (marker.action === null) return null;
                    values.push(marker.ipcCallId);
                    break;
                case 'xtreamCancelSession':
                    values.push(marker.sessionId);
                    break;
                case 'dbGetCategories':
                case 'dbSaveCategories':
                    values.push(marker.playlistId, marker.categoryType);
                    break;
                case 'dbGetContent':
                    values.push(marker.playlistId, marker.contentType);
                    break;
                case 'dbSaveContent':
                    values.push(
                        marker.playlistId,
                        marker.contentType,
                        marker.operationId
                    );
                    break;
                case 'dbDeletePlaylist':
                    values.push(
                        marker.playlistId,
                        marker.operationId ?? '<no-operation-id>'
                    );
                    break;
                case 'dbDeleteXtreamContent':
                case 'dbRestoreXtreamUserData':
                    values.push(marker.playlistId, marker.operationId);
                    break;
                case 'dbSearchContent':
                    values.push(marker.playlistId);
                    break;
                case 'dbGlobalSearch':
                    break;
                case 'dbCancelOperation':
                    values.push(marker.operationId);
                    break;
                default:
                    return null;
            }
            return values.some((value) => value === null)
                ? null
                : JSON.stringify(values);
        },
        isEpoch(value: unknown): value is number {
            return (
                typeof value === 'number' && Number.isFinite(value) && value > 0
            );
        },
        isIdentifier(value: unknown): value is string {
            return typeof value === 'string' && identifierPattern.test(value);
        },
        isNullableIdentifier(value: unknown): value is string | null {
            return value === null || helpers.isIdentifier(value);
        },
        isNullableMember(
            value: unknown,
            allowed: ReadonlySet<string>
        ): value is string | null {
            return (
                value === null ||
                (typeof value === 'string' && allowed.has(value))
            );
        },
        isRecord(value: unknown): value is JsonRecord {
            return (
                typeof value === 'object' &&
                value !== null &&
                !Array.isArray(value)
            );
        },
    };
    return {
        applyMarkerIdentity(identity, marker): void {
            identity.ipcCallId = marker.ipcCallId;
            identity.operationId = marker.operationId;
            identity.operationIdUnavailableReason = null;
            identity.sourceEpochMs = marker.sourceEpochMs;
        },
        correlationKey(marker): string | null {
            return helpers.correlationKey(marker);
        },
        isEpoch(value): value is number {
            return helpers.isEpoch(value);
        },
        parseMainPhase(input): SafeXtreamMainPhase | null {
            try {
                if (!helpers.isRecord(input)) {
                    return null;
                }
                const boundary = input['boundary'];
                const durationMs = input['durationMs'];
                const epochMs = input['epochMs'];
                const phase = input['phase'];
                const requestId = input['requestId'];
                if (
                    (boundary !== 'start' && boundary !== 'end') ||
                    !helpers.isEpoch(epochMs) ||
                    typeof phase !== 'string' ||
                    !mainPhases.has(phase) ||
                    typeof requestId !== 'string' ||
                    requestId.length > 64 ||
                    (!rendererRequestId.test(requestId) &&
                        !internalRequestId.test(requestId)) ||
                    (boundary === 'start'
                        ? durationMs !== null
                        : typeof durationMs !== 'number' ||
                          !Number.isFinite(durationMs) ||
                          durationMs < 0)
                ) {
                    return null;
                }
                return {
                    boundary,
                    durationMs: durationMs as number | null,
                    epochMs,
                    phase,
                    requestId,
                };
            } catch {
                return null;
            }
        },
        parseMarker(input): SafeXtreamPreloadMarker | null {
            try {
                if (
                    !helpers.isRecord(input) ||
                    Reflect.ownKeys(input).length !== markerKeys.size ||
                    Reflect.ownKeys(input).some(
                        (key) => typeof key !== 'string' || !markerKeys.has(key)
                    )
                ) {
                    return null;
                }
                const boundary = input['boundary'];
                const outcome = input['outcome'];
                const itemCount = input['itemCount'];
                if (
                    input['schemaVersion'] !== options.schemaVersion ||
                    !helpers.isEpoch(input['sourceEpochMs']) ||
                    !Number.isSafeInteger(input['ipcCallId']) ||
                    Number(input['ipcCallId']) < 1 ||
                    typeof input['method'] !== 'string' ||
                    !methods.has(input['method']) ||
                    (boundary !== 'start' && boundary !== 'end') ||
                    (boundary === 'start'
                        ? outcome !== null
                        : outcome !== 'success' && outcome !== 'error') ||
                    !helpers.isNullableIdentifier(input['playlistId']) ||
                    !helpers.isNullableIdentifier(input['operationId']) ||
                    !helpers.isNullableIdentifier(input['sessionId']) ||
                    !helpers.isNullableMember(input['action'], actions) ||
                    !helpers.isNullableMember(
                        input['categoryType'],
                        categoryTypes
                    ) ||
                    !helpers.isNullableMember(
                        input['contentType'],
                        contentTypes
                    ) ||
                    (itemCount !== null &&
                        (!Number.isSafeInteger(itemCount) ||
                            Number(itemCount) < 0 ||
                            Number(itemCount) > 1_000_000))
                ) {
                    return null;
                }
                return input as unknown as SafeXtreamPreloadMarker;
            } catch {
                return null;
            }
        },
        readCancelKey(input): string | null | undefined {
            if (!helpers.isRecord(input) || input['type'] !== 'cancel') {
                return undefined;
            }
            return helpers.correlationKey({
                method: 'dbCancelOperation',
                operationId:
                    typeof input['operationId'] === 'string'
                        ? input['operationId']
                        : null,
            } as SafeXtreamPreloadMarker);
        },
        readRequestKey(input): string | null | undefined {
            if (
                !helpers.isRecord(input) ||
                typeof input['operation'] !== 'string'
            ) {
                return undefined;
            }
            const method = operationToMethod[input['operation']];
            if (!method) {
                return undefined;
            }
            const payload = helpers.isRecord(input['payload'])
                ? input['payload']
                : {};
            return helpers.correlationKey({
                method,
                playlistId:
                    typeof payload['playlistId'] === 'string'
                        ? payload['playlistId']
                        : null,
                operationId:
                    typeof payload['operationId'] === 'string'
                        ? payload['operationId']
                        : null,
                categoryType:
                    typeof payload['type'] === 'string' &&
                    categoryTypes.has(payload['type'])
                        ? payload['type']
                        : null,
                contentType:
                    typeof payload['type'] === 'string' &&
                    contentTypes.has(payload['type'])
                        ? payload['type']
                        : null,
            } as SafeXtreamPreloadMarker);
        },
        sameMarkerIdentity(start, end): boolean {
            return (
                start.ipcCallId === end.ipcCallId &&
                start.method === end.method &&
                start.playlistId === end.playlistId &&
                start.operationId === end.operationId &&
                start.sessionId === end.sessionId &&
                start.action === end.action &&
                start.categoryType === end.categoryType &&
                start.contentType === end.contentType &&
                start.itemCount === end.itemCount
            );
        },
        unavailableIdentity(reason): XtreamIpcRequestIdentity {
            return {
                ipcCallId: null,
                operationId: null,
                operationIdUnavailableReason: reason,
                sourceEpochMs: null,
            };
        },
    };
}
