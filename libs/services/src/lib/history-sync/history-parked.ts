import { favoriteReferenceKey } from '@iptvnator/shared/interfaces/favorites-sync';
import {
    emptyHistoryRecord,
    retainLocalHistory,
    type HistoryOperation,
} from '@iptvnator/shared/interfaces/history-sync';
import type { HistorySyncClient } from './history-client';

/** Send or keep local the operations parked under an older consent generation. */
export async function parkHistory(
    client: HistorySyncClient,
    sourceId: string,
    send: boolean
): Promise<void> {
    const scope = await client.scope(sourceId);
    const generation = client.options.consent();
    const snapshot = await client.store.read(scope);
    client.current(scope);
    if (!snapshot?.pending.some((p) => p.consent !== generation)) return;
    await client.store.mutate(scope, (current) => {
        client.current(scope);
        const record = current ?? emptyHistoryRecord();
        if (generation !== client.options.consent())
            throw new Error('History consent changed');
        const parked = record.pending.filter((p) => p.consent !== generation);
        if (!parked.length) return record;
        if (send) {
            if (!generation || generation !== client.options.consent())
                throw new Error('History consent changed');
            return {
                ...record,
                pending: record.pending.map((p) => ({
                    ...p,
                    consent: generation,
                })),
            };
        }
        const parkedIds = new Set(parked.map((p) => p.operation.operationId));
        const pending = record.pending
            .filter((p) => p.consent === generation)
            .map((p) => {
                if (!p.operation.after || !parkedIds.has(p.operation.after))
                    return p;
                // The parked head blocked delivery, so this successor has never been sent.
                const operation = { ...p.operation };
                delete operation.after;
                return { ...p, operation };
            });
        const all = parked.map((p) => p.operation);
        const references = new Map(
            [
                ...record.base.items.map((item) => item.reference),
                ...[...all, ...record.local].reduce<
                    NonNullable<HistoryOperation['reference']>[]
                >((refs, op) => {
                    if (op.reference) refs.push(op.reference);
                    return refs;
                }, []),
            ].map((ref) => [favoriteReferenceKey(ref), ref])
        );
        const converted = all
            .reduce<HistoryOperation[]>(
                (kept, op) =>
                    op.kind === 'clear'
                        ? [...references.values()].map((reference) => ({
                              ...op,
                              kind: 'remove',
                              reference,
                          }))
                        : retainLocalHistory(kept, op),
                []
            )
            .filter(
                (op) =>
                    !pending.some(
                        (p) =>
                            p.operation.kind === 'clear' ||
                            (p.operation.reference &&
                                op.reference &&
                                favoriteReferenceKey(p.operation.reference) ===
                                    favoriteReferenceKey(op.reference))
                    )
            );
        const local = [...converted, ...record.local].reduce(
            retainLocalHistory,
            [] as HistoryOperation[]
        );
        return { ...record, pending, local };
    });
    client.options.changed();
    if (send) await client.flush(sourceId);
    else void client.flush(sourceId).catch(() => undefined);
}
