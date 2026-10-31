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
    const begin = (async () => {
        const address = await this.address(sourceId, position);
        let generation = 0;
        await this.store.mutate(address, (current) => {
            const state = current?.state ?? emptyActivityState();
            const operation: ActivityOperation = {
                kind: 'begin',
                operationId: createRandomId(),
                deviceId: this.options.deviceId,
                expectedRevision: state.revision,
                sessionId,
                positionMetadata: metadata(position),
            };
            if (!current?.pending.length)
                this.freshBegins.add(operation.operationId);
            const result = applyActivityOperation(state, operation);
            generation = result.state.generation;
            return {
                ...current,
                state: result.state,
                position: { ...position, watched: result.state.watched },
                pending: [
                    ...(current?.pending ?? []),
                    {
                        address,
                        consentGeneration: this.consent(),
                        operation,
                    },
                ],
            };
        });
        this.options.changed();
        void this.flush();
        return { address, generation };
    })();
    void begin.catch(() => {
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
): Promise<void> {
    if (
        position.activitySessionId &&
        this.retiredSessions.has(position.activitySessionId)
    )
        return;
    const session = position.activitySessionId
        ? await this.begin(sourceId, position)
        : null;
    const address =
        session?.address ?? (await this.address(sourceId, position));
    await this.store.mutate(address, (current) => {
        const state = current?.state ?? emptyActivityState();
        if (
            session &&
            state.generation > session.generation &&
            state.owner?.sessionId !== position.activitySessionId
        ) {
            this.retiredSessions.add(position.activitySessionId!);
            return current!;
        }
        const operation: ActivityOperation = session
            ? {
                  kind: 'checkpoint',
                  operationId: createRandomId(),
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
                  resume: {
                      positionSeconds: Math.max(
                          0,
                          Math.floor(position.positionSeconds)
                      ),
                      ...(Number.isFinite(position.durationSeconds) &&
                      position.durationSeconds! > 0
                          ? {
                                durationSeconds: Math.floor(
                                    position.durationSeconds!
                                ),
                            }
                          : {}),
                  },
                  positionMetadata: metadata(position),
              }
            : {
                  kind: 'mark-watched',
                  operationId: createRandomId(),
                  deviceId: this.options.deviceId,
                  expectedRevision: state.revision,
                  positionMetadata: metadata(position),
              };
        if (operation.kind === 'checkpoint')
            this.freshCheckpoints.add(operation.operationId);
        const result = applyActivityOperation(state, operation);
        return {
            ...current,
            state: result.state,
            position,
            pending: [
                ...(current?.pending ?? []),
                { address, consentGeneration: this.consent(), operation },
            ],
            ...(result.status === 'conflict' ? { conflict: state } : {}),
        };
    });
    this.options.changed();
    void this.flush();
}

export async function resetActivity(
    this: ActivitySyncClient,
    sourceId: string,
    position: Partial<PlaybackPositionData>
): Promise<void> {
    const address = await this.address(sourceId, position);
    await this.store.mutate(address, (current) => {
        const state = current?.state ?? emptyActivityState();
        const operation: ActivityOperation = {
            kind: 'reset',
            operationId: createRandomId(),
            deviceId: this.options.deviceId,
            expectedRevision: state.revision,
        };
        return {
            ...current,
            state: applyActivityOperation(state, operation).state,
            position: projectActivity(
                address,
                emptyActivityState(),
                current?.position
            ),
            pending: [
                ...(current?.pending ?? []),
                { address, consentGeneration: this.consent(), operation },
            ],
        };
    });
    this.options.changed();
    void this.flush();
}
