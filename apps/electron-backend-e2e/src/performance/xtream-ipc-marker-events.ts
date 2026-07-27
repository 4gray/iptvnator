import {
    createXtreamIpcMarkerProtocol,
    type XtreamIpcMarkerProtocol,
} from './xtream-ipc-marker-protocol';
import type {
    XtreamIpcCallState,
    XtreamIpcMarkerCapture,
    XtreamIpcMarkerCaptureOptions,
    XtreamIpcRequestIdentity,
    XtreamIpcTimelineRecord,
    XtreamMainPhaseState,
} from './xtream-ipc-marker-events.model';
import {
    createXtreamMainLifecycleValidator,
    type XtreamMainLifecycleValidator,
} from './xtream-main-lifecycle';

export { deriveXtreamAcquisitionDurationMs } from './xtream-acquisition-duration';
export type * from './xtream-ipc-marker-events.model';

export function createXtreamIpcMarkerCapture(
    options: XtreamIpcMarkerCaptureOptions,
    protocol: XtreamIpcMarkerProtocol = createXtreamIpcMarkerProtocol(options),
    mainLifecycle: XtreamMainLifecycleValidator = createXtreamMainLifecycleValidator()
): XtreamIpcMarkerCapture {
    let active = false;
    let captureStartedEpochMs = 0;
    let expectedWebContentsId: number | null = null;
    let lastMainEpochMs = 0;
    let lastReceivedEpochMs = 0;
    let lastSourceEpochMs = 0;
    let timeline: XtreamIpcTimelineRecord[] = [];
    let invalidReasons: string[] = [];
    const calls = new Map<number, XtreamIpcCallState>();
    const activeByKey = new Map<string, XtreamIpcCallState>();
    const pendingRequests = new Map<string, XtreamIpcRequestIdentity[]>();
    const quarantinedKeys = new Set<string>();
    const mainPhases = new Map<string, XtreamMainPhaseState>();
    const mainRequestCalls = new Map<string, XtreamIpcCallState>();

    const helpers = {
        invalidate(reason: string): false {
            invalidReasons.push(reason);
            return false;
        },
        mainPhasesForRequest(
            requestId: string
        ): readonly (XtreamMainPhaseState & { readonly phase: string })[] {
            const prefix = `${requestId}\u0000`;
            return [...mainPhases.entries()]
                .filter(([key]) => key.startsWith(prefix))
                .map(([key, state]) => ({
                    ...state,
                    phase: key.slice(prefix.length),
                }));
        },
        matchKey(
            key: string | null | undefined
        ): XtreamIpcRequestIdentity | null {
            if (key === undefined) {
                return null;
            }
            if (key === null || quarantinedKeys.has(key)) {
                return protocol.unavailableIdentity(
                    'xtream-preload-performance-marker-ambiguous'
                );
            }
            const call = activeByKey.get(key);
            if (call && !call.downstreamMatched && !call.quarantined) {
                call.downstreamMatched = true;
                const identity = protocol.unavailableIdentity(
                    'xtream-preload-performance-marker-missing'
                );
                protocol.applyMarkerIdentity(identity, call.marker);
                return identity;
            }
            const identity = protocol.unavailableIdentity(
                'xtream-preload-performance-marker-missing'
            );
            const waiting = pendingRequests.get(key) ?? [];
            waiting.push(identity);
            pendingRequests.set(key, waiting);
            if (waiting.length > 1) {
                helpers.quarantine(key);
            }
            return identity;
        },
        quarantine(key: string): void {
            quarantinedKeys.add(key);
            const activeCall = activeByKey.get(key);
            if (activeCall) {
                activeCall.quarantined = true;
                activeByKey.delete(key);
            }
            for (const identity of pendingRequests.get(key) ?? []) {
                Object.assign(
                    identity,
                    protocol.unavailableIdentity(
                        'xtream-preload-performance-marker-ambiguous'
                    )
                );
            }
            pendingRequests.delete(key);
        },
    };
    return {
        acceptMainPhase(input) {
            if (!active) {
                return false;
            }
            const event = protocol.parseMainPhase(input);
            if (!event) {
                return helpers.invalidate('main-phase-invalid');
            }
            const { boundary, durationMs, epochMs, phase, requestId } = event;
            if (epochMs < captureStartedEpochMs) {
                return helpers.invalidate('main-phase-before-capture-start');
            }
            if (epochMs < lastMainEpochMs) {
                return helpers.invalidate('main-phase-invalid');
            }
            lastMainEpochMs = epochMs;
            const boundaryKey = `${requestId}\u0000${phase}`;
            const phaseState = mainPhases.get(boundaryKey);
            if (boundary === 'start') {
                if (phaseState) {
                    return helpers.invalidate('main-phase-duplicate-boundary');
                }
                mainPhases.set(boundaryKey, {
                    endEpochMs: null,
                    startEpochMs: epochMs,
                });
            } else {
                if (
                    !phaseState ||
                    phaseState.endEpochMs !== null ||
                    epochMs < phaseState.startEpochMs
                ) {
                    return helpers.invalidate('main-phase-duplicate-boundary');
                }
                phaseState.endEpochMs = epochMs;
            }
            let call = mainRequestCalls.get(requestId);
            if (
                !call &&
                boundary === 'start' &&
                (phase === 'xtream.network.total' ||
                    phase === 'xtream.cancel-session')
            ) {
                const method =
                    phase === 'xtream.network.total'
                        ? 'xtreamRequest'
                        : 'xtreamCancelSession';
                call = [...calls.values()]
                    .filter(
                        (candidate) =>
                            !candidate.ended &&
                            !candidate.quarantined &&
                            !candidate.downstreamMatched &&
                            candidate.marker.method === method
                    )
                    .sort(
                        (left, right) =>
                            left.receivedEpochMs - right.receivedEpochMs ||
                            left.marker.ipcCallId - right.marker.ipcCallId
                    )[0];
                if (call) {
                    call.downstreamMatched = true;
                    mainRequestCalls.set(requestId, call);
                } else {
                    invalidReasons.push(
                        'main-phase-preload-performance-marker-missing'
                    );
                }
            }
            timeline.push({
                boundary,
                durationMs: durationMs as number | null,
                epochMs,
                ...(call ? { ipcCallId: call.marker.ipcCallId } : {}),
                phase,
                requestId,
                type: 'xtream-main-phase',
            });
            return true;
        },
        acceptPreload(senderWebContentsId, receivedEpochMs, input) {
            if (
                !active ||
                senderWebContentsId !== expectedWebContentsId ||
                !protocol.isEpoch(receivedEpochMs)
            ) {
                return helpers.invalidate(
                    'preload-marker-sender-or-epoch-invalid'
                );
            }
            if (receivedEpochMs < captureStartedEpochMs) {
                return helpers.invalidate(
                    'preload-marker-before-capture-start'
                );
            }
            if (receivedEpochMs < lastReceivedEpochMs) {
                return helpers.invalidate(
                    'preload-marker-sender-or-epoch-invalid'
                );
            }
            const marker = protocol.parseMarker(input);
            if (!marker) {
                return helpers.invalidate('preload-marker-invalid-schema');
            }
            if (marker.sourceEpochMs < captureStartedEpochMs) {
                return helpers.invalidate(
                    'preload-marker-before-capture-start'
                );
            }
            if (marker.sourceEpochMs > receivedEpochMs) {
                return helpers.invalidate(
                    'preload-marker-source-after-receipt'
                );
            }
            if (marker.sourceEpochMs < lastSourceEpochMs) {
                return helpers.invalidate(
                    'preload-marker-source-epoch-regressed'
                );
            }
            const key = protocol.correlationKey(marker);
            if (!key) {
                return helpers.invalidate(
                    'preload-marker-correlation-key-invalid'
                );
            }
            lastReceivedEpochMs = receivedEpochMs;
            lastSourceEpochMs = marker.sourceEpochMs;
            if (marker.boundary === 'start') {
                if (calls.has(marker.ipcCallId) || activeByKey.has(key)) {
                    helpers.quarantine(key);
                    return helpers.invalidate('preload-marker-duplicate-key');
                }
                const call: XtreamIpcCallState = {
                    completionOutcome: null,
                    downstreamMatched: false,
                    ended: false,
                    key,
                    marker,
                    quarantined: false,
                    receivedEpochMs,
                };
                calls.set(marker.ipcCallId, call);
                activeByKey.set(key, call);
                const waiting = pendingRequests.get(key) ?? [];
                if (waiting.length === 1 && waiting[0]) {
                    protocol.applyMarkerIdentity(waiting[0], marker);
                    call.downstreamMatched = true;
                    pendingRequests.delete(key);
                } else if (waiting.length > 1) {
                    helpers.quarantine(key);
                    return helpers.invalidate('preload-marker-duplicate-key');
                }
            } else {
                const call = calls.get(marker.ipcCallId);
                if (
                    !call ||
                    call.ended ||
                    call.quarantined ||
                    call.key !== key ||
                    !protocol.sameMarkerIdentity(call.marker, marker)
                ) {
                    return helpers.invalidate('preload-marker-unmatched-end');
                }
                call.ended = true;
                call.completionOutcome = marker.outcome;
                activeByKey.delete(key);
            }
            timeline.push({
                action: marker.action,
                boundary: marker.boundary,
                categoryType: marker.categoryType,
                contentType: marker.contentType,
                epochMs: receivedEpochMs,
                ipcCallId: marker.ipcCallId,
                itemCount: marker.itemCount,
                method: marker.method,
                operationId: marker.operationId,
                outcome: marker.outcome,
                playlistId: marker.playlistId,
                sessionId: marker.sessionId,
                sourceEpochMs: marker.sourceEpochMs,
                type: 'xtream-preload-marker',
            });
            return true;
        },
        matchDatabaseCancel(input) {
            if (!active) {
                return null;
            }
            try {
                return helpers.matchKey(protocol.readCancelKey(input));
            } catch {
                helpers.invalidate('preload-marker-correlation-input-invalid');
                return protocol.unavailableIdentity(
                    'xtream-preload-performance-marker-ambiguous'
                );
            }
        },
        matchDatabaseRequest(input) {
            if (!active) {
                return null;
            }
            try {
                return helpers.matchKey(protocol.readRequestKey(input));
            } catch {
                helpers.invalidate('preload-marker-correlation-input-invalid');
                return protocol.unavailableIdentity(
                    'xtream-preload-performance-marker-ambiguous'
                );
            }
        },
        start(webContentsId, startedEpochMs) {
            const validStart = protocol.isEpoch(startedEpochMs);
            active = true;
            captureStartedEpochMs = validStart
                ? startedEpochMs
                : Number.POSITIVE_INFINITY;
            expectedWebContentsId = webContentsId;
            lastMainEpochMs = captureStartedEpochMs;
            lastReceivedEpochMs = captureStartedEpochMs;
            lastSourceEpochMs = captureStartedEpochMs;
            timeline = [];
            invalidReasons = [];
            if (!validStart) {
                invalidReasons.push('capture-start-epoch-invalid');
            }
            calls.clear();
            activeByKey.clear();
            pendingRequests.clear();
            quarantinedKeys.clear();
            mainPhases.clear();
            mainRequestCalls.clear();
        },
        stop() {
            for (const call of calls.values()) {
                if (!call.ended && !call.quarantined) {
                    invalidReasons.push('preload-marker-unclosed');
                }
                if (
                    call.ended &&
                    (call.marker.method === 'xtreamRequest' ||
                        call.marker.method === 'xtreamCancelSession')
                ) {
                    const linkedRequest = [...mainRequestCalls.entries()].find(
                        ([, candidate]) => candidate === call
                    );
                    if (!linkedRequest) {
                        invalidReasons.push('preload-main-linkage-missing');
                        continue;
                    }
                    const lifecycleInvalidReason = mainLifecycle.validate({
                        method: call.marker.method,
                        outcome: call.completionOutcome,
                        phases: helpers.mainPhasesForRequest(linkedRequest[0]),
                    });
                    if (lifecycleInvalidReason) {
                        invalidReasons.push(lifecycleInvalidReason);
                    }
                }
            }
            for (const phase of mainPhases.values()) {
                if (phase.endEpochMs === null) {
                    invalidReasons.push('main-phase-unclosed');
                }
            }
            for (const key of mainPhases.keys()) {
                const requestId = key.slice(0, key.indexOf('\u0000'));
                if (!mainRequestCalls.has(requestId)) {
                    invalidReasons.push(
                        'main-phase-preload-performance-marker-missing'
                    );
                }
            }
            active = false;
            expectedWebContentsId = null;
            return Object.freeze({
                invalidReasons: Object.freeze([...invalidReasons]),
                quarantinedKeyCount: quarantinedKeys.size,
                timeline: Object.freeze([...timeline]),
            });
        },
    };
}
