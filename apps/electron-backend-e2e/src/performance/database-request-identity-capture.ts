import type { ElectronApplication } from '@playwright/test';

export const DATABASE_REQUEST_IDENTITY_CAPTURE_STATE_KEY =
    '__iptvnatorM3uRefreshDatabaseRequestIdentityCapture';

export interface DatabaseRequestIdentity {
    operationId: string | null;
    operationIdUnavailableReason: string | null;
}

export interface DatabaseRequestIdentityCaptureApi {
    matchDatabaseRequest(message: unknown): DatabaseRequestIdentity;
    start(): void;
    stop(): void;
}

interface DatabaseRequestIdentityElectron {
    readonly ipcMain: {
        on(
            channel: string,
            listener: (event: unknown, marker: unknown) => void
        ): void;
    };
}

export function installDatabaseRequestIdentityCaptureInMain(
    { ipcMain }: DatabaseRequestIdentityElectron,
    stateKey: string
): void {
    type JsonRecord = Record<string, unknown>;
    interface PendingMarker {
        readonly ipcCallId: number;
        readonly operation: string;
        readonly operationId: string;
        readonly playlistId: string;
    }
    interface PendingRequest {
        readonly identity: DatabaseRequestIdentity;
        readonly operation: string;
        readonly playlistId: string;
    }
    interface QuarantinedKey {
        readonly operation: string;
        readonly playlistId: string;
    }

    const target = globalThis as unknown as Record<string, unknown>;
    if (target[stateKey] !== undefined) {
        return;
    }

    const markerChannel = 'IPTVNATOR_PERF_CAPTURE_MARKER';
    const markerMethodToOperation: Readonly<Record<string, string>> = {
        dbGetAppPlaylist: 'DB_GET_APP_PLAYLIST',
        dbUpsertAppPlaylist: 'DB_UPSERT_APP_PLAYLIST',
    };
    let active = false;
    let pendingMarkers: PendingMarker[] = [];
    let pendingRequests: PendingRequest[] = [];
    let quarantinedKeys: QuarantinedKey[] = [];

    const readRecord = (value: unknown): JsonRecord | null =>
        typeof value === 'object' && value !== null
            ? (value as JsonRecord)
            : null;
    const readPlaylistId = (
        operation: string,
        payload: unknown
    ): string | null => {
        const value = readRecord(payload);
        if (!value) {
            return null;
        }
        const playlistId =
            operation === 'DB_UPSERT_APP_PLAYLIST'
                ? value['_id']
                : value['playlistId'];
        return typeof playlistId === 'string' && playlistId.length > 0
            ? playlistId
            : null;
    };
    const matches = (
        candidate: { operation: string; playlistId: string },
        operation: string,
        playlistId: string
    ): boolean =>
        candidate.operation === operation &&
        candidate.playlistId === playlistId;
    const markAmbiguous = (requests: PendingRequest[]): void => {
        for (const request of requests) {
            request.identity.operationId = null;
            request.identity.operationIdUnavailableReason =
                'preload-performance-marker-ambiguous';
        }
    };
    const isQuarantined = (operation: string, playlistId: string): boolean =>
        quarantinedKeys.some((key) => matches(key, operation, playlistId));
    const quarantine = (operation: string, playlistId: string): void => {
        if (!isQuarantined(operation, playlistId)) {
            quarantinedKeys.push({ operation, playlistId });
        }
        const requestCandidates = pendingRequests.filter((request) =>
            matches(request, operation, playlistId)
        );
        markAmbiguous(requestCandidates);
        pendingRequests = pendingRequests.filter(
            (request) => !matches(request, operation, playlistId)
        );
        pendingMarkers = pendingMarkers.filter(
            (marker) => !matches(marker, operation, playlistId)
        );
    };

    ipcMain.on(markerChannel, (_event, input) => {
        if (!active) {
            return;
        }
        const marker = readRecord(input);
        if (
            !marker ||
            marker['phase'] !== 'start' ||
            marker['correlationState'] !== 'correlated' ||
            marker['invalidReason'] !== null
        ) {
            return;
        }
        const operation =
            typeof marker['method'] === 'string'
                ? markerMethodToOperation[marker['method']]
                : undefined;
        const operationId = marker['operationId'];
        const playlistId = marker['playlistId'];
        const ipcCallId = marker['ipcCallId'];
        if (
            operation === undefined ||
            typeof operationId !== 'string' ||
            operationId.length === 0 ||
            typeof playlistId !== 'string' ||
            playlistId.length === 0 ||
            !Number.isSafeInteger(ipcCallId) ||
            Number(ipcCallId) < 1
        ) {
            return;
        }

        if (isQuarantined(operation, playlistId)) {
            return;
        }
        const requestCandidates = pendingRequests.filter((request) =>
            matches(request, operation, playlistId)
        );
        if (requestCandidates.length === 1) {
            const request = requestCandidates[0];
            if (!request) {
                return;
            }
            request.identity.operationId = operationId;
            request.identity.operationIdUnavailableReason = null;
            pendingRequests = pendingRequests.filter(
                (candidate) => candidate !== request
            );
            return;
        }
        if (requestCandidates.length > 1) {
            quarantine(operation, playlistId);
            return;
        }

        pendingMarkers.push({
            ipcCallId: Number(ipcCallId),
            operation,
            operationId,
            playlistId,
        });
        pendingMarkers.sort((left, right) => left.ipcCallId - right.ipcCallId);
    });

    const api: DatabaseRequestIdentityCaptureApi = {
        matchDatabaseRequest: (input) => {
            const message = readRecord(input);
            const operation = message?.['operation'];
            const playlistId =
                typeof operation === 'string'
                    ? readPlaylistId(operation, message?.['payload'])
                    : null;
            if (
                !active ||
                (operation !== 'DB_GET_APP_PLAYLIST' &&
                    operation !== 'DB_UPSERT_APP_PLAYLIST') ||
                playlistId === null
            ) {
                return {
                    operationId: null,
                    operationIdUnavailableReason:
                        'preload-performance-marker-not-applicable',
                };
            }

            if (isQuarantined(operation, playlistId)) {
                return {
                    operationId: null,
                    operationIdUnavailableReason:
                        'preload-performance-marker-ambiguous',
                };
            }
            const markerCandidates = pendingMarkers.filter((marker) =>
                matches(marker, operation, playlistId)
            );
            if (markerCandidates.length === 1) {
                const marker = markerCandidates[0];
                if (!marker) {
                    return {
                        operationId: null,
                        operationIdUnavailableReason:
                            'preload-performance-marker-missing',
                    };
                }
                pendingMarkers = pendingMarkers.filter(
                    (candidate) => candidate !== marker
                );
                return {
                    operationId: marker.operationId,
                    operationIdUnavailableReason: null,
                };
            }
            if (markerCandidates.length > 1) {
                quarantine(operation, playlistId);
                return {
                    operationId: null,
                    operationIdUnavailableReason:
                        'preload-performance-marker-ambiguous',
                };
            }

            const identity: DatabaseRequestIdentity = {
                operationId: null,
                operationIdUnavailableReason:
                    'preload-performance-marker-missing',
            };
            pendingRequests.push({
                identity,
                operation,
                playlistId,
            });
            return identity;
        },
        start: () => {
            pendingMarkers = [];
            pendingRequests = [];
            quarantinedKeys = [];
            active = true;
        },
        stop: () => {
            active = false;
            pendingMarkers = [];
            pendingRequests = [];
            quarantinedKeys = [];
        },
    };
    target[stateKey] = api;
}

export async function installDatabaseRequestIdentityCapture(
    electronApp: ElectronApplication
): Promise<void> {
    await electronApp.evaluate(
        installDatabaseRequestIdentityCaptureInMain,
        DATABASE_REQUEST_IDENTITY_CAPTURE_STATE_KEY
    );
}
