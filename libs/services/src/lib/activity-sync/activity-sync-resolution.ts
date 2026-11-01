import { createRandomId } from '@iptvnator/shared/interfaces';
import type { PlaybackPositionData } from '@iptvnator/shared/interfaces';
import {
    applyActivityOperation,
    emptyActivityState,
    type ActivityAddress,
    type ActivityApplyResult,
    type ActivityOperation,
    type ActivityState,
} from '@iptvnator/shared/interfaces/activity-sync';
import type { ActivitySyncClient } from './activity-sync-client';
import {
    projectActivity,
    activityPositionMetadata as metadata,
    activityResume,
} from './activity-projection';

export async function resolveActivity(
    this: ActivitySyncClient,
    address: ActivityAddress,
    useLocal: boolean
): Promise<void> {
    const remote = (await this.request({
        operation: 'activity-read',
        activity: { address },
    })) as ActivityState;
    const consentGeneration = this.consent();
    let session: { id: string; generation: number } | undefined;
    let discardedSessions: string[] = [];
    await this.store.mutate(address, (current) => {
        discardedSessions = [];
        if (!current)
            return {
                state: remote,
                pending: [],
                position: projectActivity(address, remote, this.alias(address)),
            };
        if (!useLocal) {
            for (const { operation } of current.pending)
                if (
                    operation.kind === 'begin' ||
                    operation.kind === 'checkpoint'
                )
                    discardedSessions.push(operation.sessionId);
            if (current.position?.activitySessionId)
                discardedSessions.push(current.position.activitySessionId);
            return {
                state: remote,
                pending: [],
                position: projectActivity(address, remote, this.alias(address)),
            };
        }
        const position =
            current.position ?? projectActivity(address, current.state);
        const base = {
            operationId: createRandomId(),
            deviceId: this.options.deviceId,
        };
        const operations: ActivityOperation[] = [];
        const intents = current.pending;
        const last = intents.length
            ? intents[intents.length - 1].operation.kind
            : undefined;
        const localWatched =
            last === 'mark-watched' ||
            (last !== 'reset' &&
                (position.watched === true ||
                    (!!position.durationSeconds &&
                        Math.round(
                            (position.positionSeconds /
                                position.durationSeconds) *
                                100
                        ) >= 90)));
        if (last === 'import') {
            const original = intents[intents.length - 1].operation;
            if (original.kind !== 'import')
                throw new Error('Invalid import intent');
            operations.push({
                ...original,
                ...base,
                expectedRevision: remote.revision,
            });
        } else if (last === 'mark-watched')
            operations.push({
                ...base,
                kind: 'mark-watched',
                expectedRevision: remote.revision,
                positionMetadata: metadata(position),
            });
        else if (
            last === 'reset' ||
            (!last && !current.state.resume && !current.state.owner)
        )
            operations.push({
                ...base,
                kind: 'reset',
                expectedRevision: remote.revision,
            });
        else {
            const sessionId = position.activitySessionId ?? createRandomId();
            operations.push({
                ...base,
                kind: 'begin',
                expectedRevision: remote.revision,
                sessionId,
                positionMetadata: metadata(position),
            });
            operations.push({
                operationId: createRandomId(),
                deviceId: this.options.deviceId,
                kind: 'checkpoint',
                generation: remote.generation + 1,
                sessionId,
                sequence: 1,
                resume: activityResume(position),
                positionMetadata: metadata(position),
            });
            if (
                localWatched &&
                (!position.durationSeconds ||
                    Math.round(
                        (position.positionSeconds / position.durationSeconds) *
                            100
                    ) < 90)
            )
                operations.push({
                    kind: 'mark-watched',
                    operationId: createRandomId(),
                    deviceId: this.options.deviceId,
                    expectedRevision: remote.revision + 2,
                });
            session = { id: sessionId, generation: remote.generation + 1 };
        }
        let state = remote;
        for (const operation of operations)
            state = applyActivityOperation(state, operation).state;
        return {
            state,
            position,
            pending: operations.map((operation) => ({
                address,
                consentGeneration,
                operation,
            })),
        };
    });
    for (const id of discardedSessions) this.retiredSessions.add(id);
    if (session)
        this.sessions.set(
            session.id,
            Promise.resolve({ address, generation: session.generation })
        );
    this.options.changed();
    await this.flush();
}
