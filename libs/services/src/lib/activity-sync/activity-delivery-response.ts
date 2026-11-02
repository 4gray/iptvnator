import { createRandomId } from '@iptvnator/shared/interfaces';
import {
    applyActivityOperation,
    type ActivityAddress,
    type ActivityApplyResult,
    type ActivityPendingOperation,
} from '@iptvnator/shared/interfaces/activity-sync';
import type { ActivitySyncClient } from './activity-sync-client';
import { projectActivity } from './activity-projection';

/** Commit against the current lease: a request snapshot may predate heartbeat renewal. */
export async function commitActivityDelivery(
    client: ActivitySyncClient,
    address: ActivityAddress,
    next: ActivityPendingOperation,
    result: ActivityApplyResult,
    rebases: number
) {
    const rebasedId = result.status === 'conflict' ? createRandomId() : '';
    let rebased: { sessionId: string; generation: number } | undefined;
    let retired: string | undefined;
    let discarded: string[] = [];
    const record = await client.store.mutate(address, (current) => {
        rebased = undefined;
        retired = undefined;
        discarded = [];
        if (!current) throw new Error('Activity outbox disappeared');
        const head = current.pending[0];
        if (head?.operation.operationId !== next.operation.operationId)
            return current;
        if (result.status === 'conflict') {
            if (
                head.operation.kind === 'checkpoint' &&
                client.delivery.fresh(head)
            ) {
                const session = head.operation.sessionId;
                retired = session;
                const pending = current.pending.filter((intent) => {
                    const remove =
                        intent.operation.kind === 'checkpoint' &&
                        intent.operation.sessionId === session;
                    if (remove) discarded.push(intent.operation.operationId);
                    return !remove;
                });
                return {
                    ...current,
                    pending,
                    ...(pending.length
                        ? {}
                        : {
                              state: result.state,
                              position: projectActivity(
                                  address,
                                  result.state,
                                  client.alias(address)
                              ),
                          }),
                };
            }
            if (
                head.operation.kind === 'begin' &&
                client.delivery.fresh(head) &&
                rebases < 3
            ) {
                const old = head.operation;
                let state = result.state;
                const pending = current.pending.map((intent, index) => {
                    let operation = intent.operation;
                    if (index === 0)
                        operation = {
                            ...old,
                            operationId: rebasedId,
                            expectedRevision: state.revision,
                        };
                    else if (operation.kind === 'checkpoint')
                        operation = {
                            ...operation,
                            generation: state.generation,
                        };
                    else
                        operation = {
                            ...operation,
                            expectedRevision: state.revision,
                        };
                    state = applyActivityOperation(state, operation).state;
                    return { ...intent, operation };
                });
                rebased = {
                    sessionId: old.sessionId,
                    generation: result.state.generation + 1,
                };
                return { ...current, state, pending };
            }
            return { ...current, conflict: result.state };
        }
        const pending = current.pending.slice(1);
        return {
            ...current,
            pending,
            ...(pending.length
                ? {}
                : {
                      state: result.state,
                      position: projectActivity(
                          address,
                          result.state,
                          client.alias(address)
                      ),
                  }),
        };
    });
    if (rebased) {
        client.delivery.begins.set(rebasedId, next.consentGeneration);
        client.sessions.set(
            rebased.sessionId,
            Promise.resolve({ address, generation: rebased.generation })
        );
        client.delivery.start();
    }
    if (retired) client.retiredSessions.add(retired);
    for (const id of discarded) client.delivery.settled(id);
    if (
        !record.pending.some(
            (intent) =>
                intent.operation.operationId === next.operation.operationId
        )
    )
        client.delivery.settled(next.operation.operationId);
    return { record, rebased: !!rebased };
}
