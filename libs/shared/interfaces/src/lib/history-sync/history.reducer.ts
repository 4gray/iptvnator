import { favoriteReferenceKey } from '../favorites-sync/favorites-sync.validation';
import type {
    HistoryState,
    HistoryOperation,
    HistoryResult,
    HistoryRecord,
} from './history.contract';
export const emptyHistoryState = (): HistoryState => ({
    revision: 0,
    cleared: 0,
    items: [],
});
export const emptyHistoryRecord = (): HistoryRecord => ({
    base: emptyHistoryState(),
    pending: [],
    local: [],
});
/** Local projection is optimistic; the server alone checks durable removal barriers. */
export function applyHistoryOperation(
    state: HistoryState,
    operation: HistoryOperation,
    force = false,
    now = operation.viewedAt
): HistoryResult {
    if (force)
        now = state.items.reduce(
            (latest, item) => Math.max(latest, item.viewedAt + 1),
            now
        );
    const key = operation.reference
        ? favoriteReferenceKey(operation.reference)
        : '';
    const previous = state.items.find(
        (item) => favoriteReferenceKey(item.reference) === key
    );
    if (
        !force &&
        operation.kind === 'touch' &&
        operation.baseRevision <
            Math.max(state.cleared, previous?.removedAt ?? 0)
    )
        return { applied: false, state };
    const revision = state.revision + 1;
    if (!Number.isSafeInteger(revision))
        throw new Error('History revision exhausted');
    if (operation.kind === 'clear')
        return {
            applied: true,
            state: { ...state, revision, cleared: revision },
        };
    return {
        applied: true,
        state: {
            ...state,
            revision,
            items: [
                ...state.items.filter(
                    (item) => favoriteReferenceKey(item.reference) !== key
                ),
                {
                    reference: operation.reference!,
                    ...((operation.snapshot ?? previous?.snapshot)
                        ? { snapshot: operation.snapshot ?? previous?.snapshot }
                        : {}),
                    revision,
                    removedAt:
                        operation.kind === 'remove'
                            ? revision
                            : (previous?.removedAt ?? 0),
                    removed: operation.kind === 'remove',
                    viewedAt: now,
                },
            ],
        },
    };
}
export function projectHistory(record: HistoryRecord): HistoryState {
    return [...record.pending.map((p) => p.operation), ...record.local].reduce(
        (state, op) => applyHistoryOperation(state, op, true).state,
        record.base
    );
}
export const visibleHistory = (state: HistoryState) =>
    state.items
        .filter((item) => !item.removed && item.revision > state.cleared)
        .sort((a, b) => b.viewedAt - a.viewedAt || b.revision - a.revision);
/** One retained local action per item; a local clear subsumes older local choices. */
export function retainLocalHistory(
    operations: HistoryOperation[],
    operation: HistoryOperation
): HistoryOperation[] {
    if (operation.kind === 'clear') return [operation];
    const key = favoriteReferenceKey(operation.reference!);
    return [
        ...operations.filter(
            (op) =>
                op.kind === 'clear' ||
                favoriteReferenceKey(op.reference!) !== key
        ),
        operation,
    ];
}
