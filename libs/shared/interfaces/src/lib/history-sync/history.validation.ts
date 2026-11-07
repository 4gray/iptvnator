import { assertActivityToken } from '../activity-sync/activity-sync.identity';
import {
    parseFavoriteAddress,
    parseFavoriteOperation,
    favoriteReferenceKey,
} from '../favorites-sync/favorites-sync.validation';
import type {
    HistoryScope,
    HistoryOperation,
    HistoryState,
    HistoryRecord,
} from './history.contract';
const count = (v: unknown) => {
    if (!Number.isSafeInteger(v) || Number(v) < 0)
        throw new Error('Invalid history number');
};
export function parseHistoryScope(input: unknown): HistoryScope {
    const v = input as HistoryScope;
    if (!v) throw new Error('Invalid history scope');
    for (const key of ['instanceId', 'sourceId', 'sourceIncarnation'] as const)
        assertActivityToken(v[key]);
    if (!['m3u', 'xtream', 'stalker'].includes(v.provider))
        throw new Error('Invalid history provider');
    return {
        instanceId: v.instanceId,
        sourceId: v.sourceId,
        sourceIncarnation: v.sourceIncarnation,
        provider: v.provider,
    };
}
export const historyScopeKey = (scope: HistoryScope) => {
    const v = parseHistoryScope(scope);
    return JSON.stringify([
        v.instanceId,
        v.sourceId,
        v.sourceIncarnation,
        v.provider,
    ]);
};
export function parseHistoryOperation(input: unknown): HistoryOperation {
    const v = input as HistoryOperation;
    if (!v || !['touch', 'remove', 'clear'].includes(v.kind))
        throw new Error('Invalid history operation');
    assertActivityToken(v.operationId);
    assertActivityToken(v.deviceId);
    count(v.baseRevision);
    count(v.viewedAt);
    if (v.viewedAt > 8640000000000000) throw new Error('Invalid history date');
    if (v.after !== undefined) assertActivityToken(v.after);
    const result: HistoryOperation = {
        operationId: v.operationId,
        deviceId: v.deviceId,
        kind: v.kind,
        baseRevision: v.baseRevision,
        viewedAt: v.viewedAt,
        ...(v.after ? { after: v.after } : {}),
    };
    if (v.kind === 'clear') {
        if (v.reference !== undefined || v.snapshot !== undefined)
            throw new Error('Invalid history clear');
        return result;
    }
    const address = parseFavoriteAddress({
        instanceId: 'history',
        scope: 'shared',
        sourceId: 'source',
        sourceIncarnation: 'incarnation',
        content: v.reference,
    });
    const operation = parseFavoriteOperation({
        operationId: v.operationId,
        deviceId: v.deviceId,
        expectedRevision: v.baseRevision,
        member: v.kind === 'touch',
        ...(v.snapshot ? { snapshot: v.snapshot } : {}),
    });
    if (operation.snapshot?.title?.includes('://')) {
        delete operation.snapshot.title;
    }
    return {
        ...result,
        reference: address.content,
        ...(operation.snapshot ? { snapshot: operation.snapshot } : {}),
    };
}
export function assertHistoryState(v: HistoryState): void {
    if (!v || !Array.isArray(v.items)) throw new Error('Invalid history state');
    count(v.revision);
    count(v.cleared);
    if (v.cleared > v.revision) throw new Error('Invalid history revision');
    const keys = new Set<string>();
    for (const item of v.items) {
        const op = parseHistoryOperation({
            kind: 'touch',
            operationId: 'validate',
            deviceId: 'validate',
            baseRevision: item.revision,
            viewedAt: item.viewedAt,
            reference: item.reference,
            ...(item.snapshot ? { snapshot: item.snapshot } : {}),
        });
        count(item.removedAt);
        if (
            typeof item.removed !== 'boolean' ||
            item.removedAt > item.revision ||
            item.revision > v.revision
        )
            throw new Error('Invalid history item');
        const key = favoriteReferenceKey(op.reference!);
        if (keys.has(key)) throw new Error('Duplicate history item');
        keys.add(key);
    }
}
export function assertHistoryRecord(
    scope: HistoryScope,
    v: HistoryRecord
): void {
    parseHistoryScope(scope);
    assertHistoryState(v.base);
    if (
        v.base.items.some(
            (item) => item.reference.provider !== scope.provider
        ) ||
        (v.hideArchive !== undefined && typeof v.hideArchive !== 'boolean') ||
        (v.archive !== undefined && !Array.isArray(v.archive))
    )
        throw new Error('Invalid history record');
    if (!Array.isArray(v.pending) || !Array.isArray(v.local))
        throw new Error('Invalid history record');
    for (const pending of v.pending) {
        assertActivityToken(pending.consent);
        const op = parseHistoryOperation(pending.operation);
        if (op.reference && op.reference.provider !== scope.provider)
            throw new Error('History provider mismatch');
    }
    for (const value of [...v.local, ...(v.archive ?? [])]) {
        const op = parseHistoryOperation(value);
        if (op.reference && op.reference.provider !== scope.provider)
            throw new Error('History provider mismatch');
    }
}
