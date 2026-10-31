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

export async function sendPendingActivity(
    this: ActivitySyncClient
): Promise<void> {
    try {
        for (const source of this.contexts.keys()) {
            for (const entry of await this.store.entries(source)) {
                if (
                    entry.address.sourceIncarnation !==
                    this.contexts.get(source)?.sourceIncarnation
                )
                    continue;
                let record = entry.record;
                let rebases = 0;
                while (record.pending.length && !record.conflict) {
                    const next = record.pending[0];
                    if (next.consentGeneration !== this.options.consent())
                        break;
                    this.options.status('pending');
                    const result = (await this.request({
                        operation: 'activity-apply',
                        activity: {
                            address: next.address,
                            operation: next.operation,
                        },
                    })) as ActivityApplyResult;
                    if (
                        result.status === 'conflict' &&
                        next.operation.kind === 'checkpoint' &&
                        this.freshCheckpoints.has(next.operation.operationId)
                    ) {
                        const sessionId = next.operation.sessionId;
                        this.retiredSessions.add(sessionId);
                        record = await this.store.mutate(
                            entry.address,
                            (current) => {
                                const pending = (current?.pending ?? []).filter(
                                    (intent) =>
                                        intent.operation.kind !==
                                            'checkpoint' ||
                                        intent.operation.sessionId !== sessionId
                                );
                                return {
                                    ...current!,
                                    pending,
                                    state: result.state,
                                    position: projectActivity(
                                        entry.address,
                                        result.state,
                                        this.alias(entry.address)
                                    ),
                                };
                            }
                        );
                        this.freshCheckpoints.delete(
                            next.operation.operationId
                        );
                        continue;
                    }
                    if (
                        result.status === 'conflict' &&
                        next.operation.kind === 'begin' &&
                        this.freshBegins.has(next.operation.operationId) &&
                        rebases++ < 3
                    ) {
                        const old = next.operation;
                        record = await this.store.mutate(
                            entry.address,
                            (current) => {
                                if (
                                    !current ||
                                    current.pending[0]?.operation
                                        .operationId !== old.operationId
                                )
                                    return current ?? record;
                                let state = result.state;
                                const pending = current.pending.map(
                                    (intent, index) => {
                                        let operation = intent.operation;
                                        if (index === 0)
                                            operation = {
                                                ...old,
                                                operationId: createRandomId(),
                                                expectedRevision:
                                                    state.revision,
                                            };
                                        else if (
                                            operation.kind === 'checkpoint'
                                        )
                                            operation = {
                                                ...operation,
                                                generation: state.generation,
                                            };
                                        else
                                            operation = {
                                                ...operation,
                                                expectedRevision:
                                                    state.revision,
                                            };
                                        state = applyActivityOperation(
                                            state,
                                            operation
                                        ).state;
                                        return { ...intent, operation };
                                    }
                                );
                                this.freshBegins.delete(old.operationId);
                                this.freshBegins.add(
                                    pending[0].operation.operationId
                                );
                                this.sessions.set(
                                    old.sessionId,
                                    Promise.resolve({
                                        address: entry.address,
                                        generation: result.state.generation + 1,
                                    })
                                );
                                return { ...current, state, pending };
                            }
                        );
                        continue;
                    }
                    record = await this.store.mutate(
                        entry.address,
                        (current) => {
                            if (
                                !current ||
                                current.pending[0]?.operation.operationId !==
                                    next.operation.operationId
                            )
                                return current ?? record;
                            if (result.status === 'conflict')
                                return {
                                    ...current,
                                    conflict: result.state,
                                };
                            const pending = current.pending.slice(1);
                            return {
                                ...current,
                                pending,
                                ...(pending.length
                                    ? {}
                                    : {
                                          state: result.state,
                                          position: projectActivity(
                                              entry.address,
                                              result.state,
                                              this.alias(entry.address)
                                          ),
                                      }),
                            };
                        }
                    );
                    this.freshBegins.delete(next.operation.operationId);
                    this.freshCheckpoints.delete(next.operation.operationId);
                }
                if (record.conflict) this.options.status('conflict');
            }
        }
        this.options.changed();
        const pending = await this.store.pending();
        if (!pending.length) this.options.status('ready');
    } catch {
        this.freshBegins.clear();
        this.freshCheckpoints.clear();
        this.options.status('offline');
    }
}
