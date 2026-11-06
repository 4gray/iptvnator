import type {
    ActivityApplyResult,
    ActivityOperation,
    ActivityResume,
    ActivityState,
} from './activity-sync.contract';
import { assertActivityToken } from './activity-sync.identity';

export function emptyActivityState(): ActivityState {
    return {
        revision: 0,
        generation: 0,
        owner: null,
        resume: null,
        watched: false,
        watchedOrigin: null,
    };
}

/** Deterministic server reducer; idempotency receipts belong to the storage transaction. */
export function applyActivityOperation(
    current: ActivityState,
    operation: ActivityOperation
): ActivityApplyResult {
    assertActivityToken(operation.operationId);
    assertActivityToken(operation.deviceId);
    assertCounter(current.revision);
    assertCounter(current.generation);
    if (operation.kind === 'checkpoint') {
        assertActivityToken(operation.sessionId);
        assertCounter(operation.generation);
        assertCounter(operation.sequence);
        assertResume(operation.resume);
        if (
            operation.generation !== current.generation ||
            operation.sessionId !== current.owner?.sessionId ||
            operation.deviceId !== current.owner?.deviceId
        ) {
            return { status: 'conflict', reason: 'session', state: current };
        }
        if (operation.sequence <= current.owner.sequence) {
            return { status: 'conflict', reason: 'sequence', state: current };
        }
        // Match the existing portal's rounded percentage threshold. Rewinding
        // changes resume, but never implicitly removes an explicit watched mark.
        const watched =
            !!operation.resume.durationSeconds &&
            Math.round(
                (operation.resume.positionSeconds /
                    operation.resume.durationSeconds) *
                    100
            ) >= 90;
        return {
            status: 'applied',
            state: {
                ...current,
                ...(operation.positionMetadata
                    ? { positionMetadata: { ...operation.positionMetadata } }
                    : {}),
                revision: nextCounter(current.revision),
                owner: { ...current.owner, sequence: operation.sequence },
                resume: { ...operation.resume },
                watched: current.watched || watched,
                watchedOrigin: current.watched
                    ? current.watchedOrigin
                    : watched
                      ? 'automatic'
                      : null,
            },
        };
    }
    if (
        !['begin', 'mark-watched', 'reset', 'import'].includes(operation.kind)
    ) {
        throw new Error('Invalid activity operation');
    }
    assertCounter(operation.expectedRevision);
    if (operation.expectedRevision !== current.revision) {
        return { status: 'conflict', reason: 'revision', state: current };
    }
    const state: ActivityState = {
        ...current,
        ...(operation.positionMetadata
            ? { positionMetadata: { ...operation.positionMetadata } }
            : {}),
        revision: nextCounter(current.revision),
        generation: nextCounter(current.generation),
        owner: null,
    };
    switch (operation.kind) {
        case 'begin':
            assertActivityToken(operation.sessionId);
            state.owner = {
                deviceId: operation.deviceId,
                sessionId: operation.sessionId,
                sequence: 0,
            };
            break;
        case 'mark-watched':
            state.watched = true;
            state.watchedOrigin = 'manual';
            break;
        case 'reset':
            state.resume = null;
            state.watched = false;
            state.watchedOrigin = null;
            break;
        case 'import':
            if (operation.resume) assertResume(operation.resume);
            if (typeof operation.watched !== 'boolean')
                throw new Error('Invalid watched state');
            state.resume = operation.resume ? { ...operation.resume } : null;
            state.watched = operation.watched;
            state.watchedOrigin = operation.watched ? 'legacy-unknown' : null;
            break;
    }
    return { status: 'applied', state };
}

function assertCounter(value: number): void {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new Error('Invalid activity counter');
    }
}

function nextCounter(value: number): number {
    const next = value + 1;
    assertCounter(next);
    return next;
}

function assertResume(resume: ActivityResume): void {
    assertCounter(resume.positionSeconds);
    if (resume.durationSeconds !== undefined) {
        assertCounter(resume.durationSeconds);
        if (resume.durationSeconds === 0) {
            throw new Error('Invalid activity duration');
        }
    }
}
