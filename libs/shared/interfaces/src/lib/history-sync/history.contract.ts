import type {
    FavoriteReference,
    FavoriteSnapshot,
    FavoriteSourceContext,
} from '../favorites-sync/favorites-sync.contract';
export const HISTORY_SYNC_CAPABILITY = 'history-v1';
export type HistoryReference = FavoriteReference;
export type HistorySnapshot = FavoriteSnapshot;
export interface HistoryScope extends FavoriteSourceContext {
    instanceId: string;
}
export interface HistoryItem {
    reference: HistoryReference;
    snapshot?: HistorySnapshot;
    revision: number;
    removedAt: number;
    removed: boolean;
    viewedAt: number;
}
export interface HistoryState {
    revision: number;
    cleared: number;
    items: HistoryItem[];
}
export interface HistoryOperation {
    operationId: string;
    deviceId: string;
    kind: 'touch' | 'remove' | 'clear';
    baseRevision: number;
    after?: string;
    reference?: HistoryReference;
    snapshot?: HistorySnapshot;
    viewedAt: number;
}
export interface HistoryPending {
    operation: HistoryOperation;
    consent: string;
}
export interface HistoryRecord {
    /** An explicit clear on this device also hides its original local archive. */
    hideArchive?: boolean;
    /** Device actions retained for explicit import; never implicit delivery. */
    archive?: HistoryOperation[];
    base: HistoryState;
    pending: HistoryPending[];
    local: HistoryOperation[];
}
export interface HistoryStore {
    read(scope: HistoryScope): Promise<HistoryRecord | null>;
    mutate(
        scope: HistoryScope,
        update: (value: HistoryRecord | null) => HistoryRecord
    ): Promise<HistoryRecord>;
}
export interface HistoryResult {
    applied: boolean;
    state: HistoryState;
}
export type HistoryLocalRequest = {
    instanceId: string;
    scope: HistoryScope;
} & (
    | { operation: 'read' }
    | { operation: 'commit'; expected: string | null; value: HistoryRecord }
);
