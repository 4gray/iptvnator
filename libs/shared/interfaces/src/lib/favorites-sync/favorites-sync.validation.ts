import { assertActivityToken } from '../activity-sync/activity-sync.identity';
import type {
    FavoriteAddress,
    FavoriteReference,
    FavoriteSnapshot,
    FavoriteOperation,
    FavoriteState,
    FavoriteLocalRecord,
} from './favorites-sync.contract';

export const FAVORITES_SYNC_CAPABILITY = 'favorites-v1';
export function favoriteReferenceKey(ref: FavoriteReference): string {
    return JSON.stringify(parseFavoriteReference(ref));
}
export function parseFavoriteReference(value: unknown): FavoriteReference {
    const ref = value as FavoriteReference;
    if (ref?.provider === 'm3u') {
        if (ref.version !== 1 || !/^[a-f0-9]{64}$/.test(ref.urlHash))
            throw new Error('Invalid M3U favorite reference');
        return { provider: 'm3u', version: 1, urlHash: ref.urlHash };
    }
    if (!ref || !['xtream', 'stalker'].includes(ref.provider))
        throw new Error('Invalid favorite provider');
    assertActivityToken(ref.id);
    if (/[/?#@\s]/.test(ref.id))
        throw new Error('Invalid favorite provider ID');
    if (
        ref.provider === 'xtream' &&
        (!/^[1-9][0-9]*$/.test(ref.id) || !Number.isSafeInteger(Number(ref.id)))
    )
        throw new Error('Invalid Xtream favorite ID');
    if (
        ![
            'live',
            'movie',
            'series',
            ...(ref.provider === 'stalker' ? ['radio'] : []),
        ].includes(ref.kind)
    )
        throw new Error('Invalid favorite kind');
    if (ref.provider === 'xtream')
        return { provider: 'xtream', kind: ref.kind, id: ref.id };
    if (
        (ref.kind === 'series') !== (ref.mode !== undefined) ||
        (ref.mode !== undefined &&
            !['regular', 'embedded', 'lazy'].includes(ref.mode))
    )
        throw new Error('Invalid Stalker favorite mode');
    return {
        provider: 'stalker',
        kind: ref.kind,
        id: ref.id,
        ...(ref.mode ? { mode: ref.mode } : {}),
    };
}
export function parseFavoriteAddress(value: unknown): FavoriteAddress {
    const input = value as FavoriteAddress;
    if (!input || input.scope !== 'shared')
        throw new Error('Invalid favorite scope');
    for (const token of [
        input.instanceId,
        input.sourceId,
        input.sourceIncarnation,
    ])
        assertActivityToken(token);
    return {
        instanceId: input.instanceId,
        scope: 'shared',
        sourceId: input.sourceId,
        sourceIncarnation: input.sourceIncarnation,
        content: parseFavoriteReference(input.content),
    };
}
export function favoriteAddressKey(value: FavoriteAddress): string {
    const a = parseFavoriteAddress(value);
    return JSON.stringify([
        a.instanceId,
        a.scope,
        a.sourceId,
        a.sourceIncarnation,
        a.content,
    ]);
}
export function parseFavoriteSnapshot(
    value: FavoriteSnapshot
): FavoriteSnapshot {
    if (!value || typeof value !== 'object')
        throw new Error('Invalid favorite snapshot');
    const result: FavoriteSnapshot = {};
    for (const key of [
        'title',
        'categoryId',
        'tmdbId',
        'releaseYear',
    ] as const) {
        const text = value[key];
        if (text === undefined || text === null) continue;
        if (
            typeof text !== 'string' ||
            text.length > (key === 'title' ? 512 : 128) ||
            Array.from(text).some((character) => character.charCodeAt(0) < 32)
        )
            throw new Error('Invalid favorite metadata');
        if (
            (key === 'tmdbId' || key === 'releaseYear') &&
            (!/^[0-9]+$/.test(text) || !Number.isSafeInteger(Number(text)))
        )
            throw new Error('Invalid numeric favorite metadata');
        result[key] = text;
    }
    if (value.identityConflict !== undefined) {
        if (typeof value.identityConflict !== 'boolean')
            throw new Error('Invalid favorite conflict');
        result.identityConflict = value.identityConflict;
    }
    if (value.episodes !== undefined) {
        if (
            !Array.isArray(value.episodes) ||
            value.episodes.length > 2000 ||
            value.episodes.some((n) => !Number.isSafeInteger(n) || n < 0)
        )
            throw new Error('Invalid favorite episodes');
        result.episodes = [...value.episodes];
    }
    return result;
}
export function assertFavoriteState(state: FavoriteState): void {
    if (
        !state ||
        !Number.isSafeInteger(state.revision) ||
        state.revision < 0 ||
        typeof state.member !== 'boolean'
    )
        throw new Error('Invalid favorite state');
    if (state.snapshot !== undefined) parseFavoriteSnapshot(state.snapshot);
}
export function parseFavoriteOperation(
    input: FavoriteOperation
): FavoriteOperation {
    assertActivityToken(input?.operationId);
    assertActivityToken(input.deviceId);
    assertFavoriteState({
        revision: input.expectedRevision,
        member: input.member,
    });
    return {
        operationId: input.operationId,
        deviceId: input.deviceId,
        expectedRevision: input.expectedRevision,
        member: input.member,
        ...(input.snapshot === undefined
            ? {}
            : { snapshot: parseFavoriteSnapshot(input.snapshot) }),
    };
}
export function assertFavoriteLocalRecord(
    address: FavoriteAddress,
    record: FavoriteLocalRecord
): void {
    const key = favoriteAddressKey(address);
    assertFavoriteState(record.state);
    assertFavoriteState(record.base);
    if (record.local) assertFavoriteState(record.local);
    if (record.conflict) assertFavoriteState(record.conflict);
    if (!Array.isArray(record.pending))
        throw new Error('Invalid favorite outbox');
    const ids = new Set<string>();
    for (const intent of record.pending) {
        if (favoriteAddressKey(intent.address) !== key)
            throw new Error('Favorite address mismatch');
        assertActivityToken(intent.consentGeneration);
        parseFavoriteOperation(intent.operation);
        const id = JSON.stringify([
            intent.operation.deviceId,
            intent.operation.operationId,
        ]);
        if (ids.has(id)) throw new Error('Duplicate favorite operation');
        ids.add(id);
    }
}
