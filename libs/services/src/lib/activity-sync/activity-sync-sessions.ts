import { createRandomId } from '@iptvnator/shared/interfaces';
import type { PlaybackPositionData } from '@iptvnator/shared/interfaces';
import {
    applyActivityOperation,
    emptyActivityState,
    type ActivityAddress,
    type ActivityLocalRecord,
    type ActivityOperation,
} from '@iptvnator/shared/interfaces/activity-sync';
import type { ActivitySyncClient } from './activity-sync-client';
import {
    projectActivity,
    activityPositionMetadata as metadata,
    activityResume,
} from './activity-projection';

export function beginActivity(
    this: ActivitySyncClient,
    sourceId: string,
    position: PlaybackPositionData
): Promise<{ address: ActivityAddress; generation: number }> {
    const sessionId = position.activitySessionId;
    if (!sessionId)
        return Promise.reject(new Error('Activity session missing'));
    const existing = this.sessions.get(sessionId);
    if (existing) return existing;
    let incarnation = this.contexts.get(sourceId)?.sourceIncarnation;
    const operationId = createRandomId();
    const begin = (async () => {
        const address = await this.address(sourceId, position);
        incarnation = address.sourceIncarnation;
        let generation = 0;
        const consentGeneration = this.consent();
        this.delivery.begins.set(operationId, consentGeneration);
        const committed = await this.store.mutate(address, (current) => {
            const state = current?.state ?? emptyActivityState();
            const operation: ActivityOperation = {
                kind: 'begin',
                operationId,
                deviceId: this.options.deviceId,
                expectedRevision: state.revision,
                sessionId,
                positionMetadata: metadata(position),
            };
            const fresh =
                !current?.conflict &&
                (current?.pending ?? []).every(
                    (intent) =>
                        intent.consentGeneration === consentGeneration &&
                        this.delivery.live(intent)
                );
            const result = applyActivityOperation(state, operation);
            generation = result.state.generation;
            return {
                ...current,
                state: result.state,
                position: {
                    ...position,
                    watched: result.state.watched,
                    updatedAt: new Date().toISOString(),
                },
                pending: [
                    ...(current?.pending ?? []),
                    {
                        address,
                        consentGeneration,
                        operation,
                        ...(fresh
                            ? { deliveryLease: this.delivery.lease() }
                            : {}),
                    },
                ],
            };
        });
        if (
            committed.pending.some(
                (intent) =>
                    intent.operation.operationId === operationId &&
                    intent.deliveryLease?.owner === this.delivery.owner
            )
        )
            this.delivery.start();
        else this.delivery.settled(operationId);
        this.localSessions.delete(sessionId);
        this.retiredSessions.delete(sessionId);
        this.options.committed?.(sourceId, position, 'begin');
        this.options.changed();
        void this.flush();
        return { address, generation };
    })();
    void begin.catch(() => {
        this.localSessions.set(sessionId, { sourceId, incarnation });
        this.delivery.settled(operationId);
        if (this.sessions.get(sessionId) === begin)
            this.sessions.delete(sessionId);
    });
    this.sessions.set(sessionId, begin);
    return begin;
}

export async function saveActivity(
    this: ActivitySyncClient,
    sourceId: string,
    position: PlaybackPositionData
): Promise<'local-only' | void> {
    const failed = position.activitySessionId
        ? this.localSessions.get(position.activitySessionId)
        : undefined;
    const currentScope = this.contexts.get(sourceId)?.sourceIncarnation;
    if (
        failed?.incarnation &&
        currentScope &&
        failed.incarnation !== currentScope
    ) {
        this.localSessions.delete(position.activitySessionId!);
        this.retiredSessions.add(position.activitySessionId!);
        return;
    }
    // Failed explicit launches have no shared owner. Keep the adapter's local
    // fallback active until another explicit launch commits ownership.
    if (
        position.activitySessionId &&
        this.localSessions.has(position.activitySessionId) &&
        !this.sessions.has(position.activitySessionId)
    )
        return 'local-only';
    if (
        position.activitySessionId &&
        this.retiredSessions.has(position.activitySessionId)
    )
        return;
    const sessionId = position.activitySessionId;
    let session = sessionId ? await this.sessions.get(sessionId) : undefined;
    const address =
        session?.address ?? (await this.address(sourceId, position));
    if (sessionId && !session) {
        // External players may outlive the renderer. A checkpoint can recover
        // durable ownership, but only an explicit launch may acquire it.
        const state = (await this.store.read(address))?.state;
        if (
            state?.owner?.deviceId === this.options.deviceId &&
            state.owner.sessionId === sessionId
        ) {
            session = { address, generation: state.generation };
            this.sessions.set(sessionId, Promise.resolve(session));
        } else {
            this.retiredSessions.add(sessionId);
            return;
        }
    }
    if (
        sessionId &&
        session &&
        session.address.sourceIncarnation !==
            this.contexts.get(sourceId)?.sourceIncarnation
    ) {
        this.retiredSessions.add(sessionId);
        return;
    }
    const operationId = createRandomId();
    const consentGeneration = this.consent();
    if (session) this.delivery.checkpoints.set(operationId, consentGeneration);
    let committed: ActivityLocalRecord;
    try {
        committed = await this.store.mutate(address, (current) => {
            const state = current?.state ?? emptyActivityState();
            if (
                session &&
                (this.retiredSessions.has(position.activitySessionId!) ||
                    (state.generation > session.generation &&
                        state.owner?.sessionId !== position.activitySessionId))
            ) {
                this.retiredSessions.add(position.activitySessionId!);
                return current!;
            }
            const operation: ActivityOperation = session
                ? {
                      kind: 'checkpoint',
                      operationId,
                      deviceId: this.options.deviceId,
                      generation:
                          state.owner?.deviceId === this.options.deviceId &&
                          state.owner?.sessionId === position.activitySessionId
                              ? state.generation
                              : session.generation,
                      sessionId: position.activitySessionId!,
                      sequence:
                          Math.max(
                              state.owner?.sequence ?? 0,
                              ...(current?.pending ?? []).map((p) =>
                                  p.operation.kind === 'checkpoint' &&
                                  p.operation.sessionId ===
                                      position.activitySessionId
                                      ? p.operation.sequence
                                      : 0
                              )
                          ) + 1,
                      resume: activityResume(position),
                      positionMetadata: metadata(position),
                  }
                : {
                      kind: 'mark-watched',
                      operationId,
                      deviceId: this.options.deviceId,
                      expectedRevision: state.revision,
                      positionMetadata: metadata(position),
                  };
            const result = applyActivityOperation(state, operation);
            return {
                ...current,
                state: result.state,
                position: {
                    ...position,
                    watched: result.state.watched,
                    updatedAt: new Date().toISOString(),
                },
                pending: [
                    ...(current?.pending ?? []),
                    {
                        address,
                        consentGeneration,
                        operation,
                        ...(session && !current?.conflict
                            ? { deliveryLease: this.delivery.lease() }
                            : {}),
                    },
                ],
                ...(result.status === 'conflict' ? { conflict: state } : {}),
            };
        });
    } catch (error) {
        this.delivery.settled(operationId);
        throw error;
    }
    if (
        committed.pending.some(
            (intent) =>
                intent.operation.operationId === operationId &&
                intent.deliveryLease?.owner === this.delivery.owner
        )
    )
        this.delivery.start();
    else this.delivery.settled(operationId);
    if (
        committed.pending.some(
            (intent) => intent.operation.operationId === operationId
        )
    )
        this.options.committed?.(
            sourceId,
            position,
            session ? 'checkpoint' : 'command'
        );
    this.options.changed();
    void this.flush();
}

export async function resetActivity(
    this: ActivitySyncClient,
    sourceId: string,
    position: Partial<PlaybackPositionData>
): Promise<void> {
    const address = await this.address(sourceId, position);
    const committed = await this.store.mutate(address, (current) => {
        const state = current?.state ?? emptyActivityState();
        const operation: ActivityOperation = {
            kind: 'reset',
            operationId: createRandomId(),
            deviceId: this.options.deviceId,
            expectedRevision: state.revision,
            positionMetadata: metadata({
                ...projectActivity(address, state, this.alias(address)),
                ...position,
                positionSeconds: 0,
            }),
        };
        return {
            ...current,
            state: applyActivityOperation(state, operation).state,
            position: projectActivity(
                address,
                {
                    ...emptyActivityState(),
                    positionMetadata: operation.positionMetadata,
                },
                this.alias(address) ?? { ...current?.position, ...position }
            ),
            pending: [
                ...(current?.pending ?? []),
                { address, consentGeneration: this.consent(), operation },
            ],
        };
    });
    this.options.committed?.(sourceId, position, 'command');
    if (committed.position)
        this.options.committed?.(sourceId, committed.position, 'command');
    this.options.changed();
    void this.flush();
}
