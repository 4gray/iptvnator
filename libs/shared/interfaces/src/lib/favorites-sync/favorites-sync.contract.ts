/** Portable collection membership, scoped to one verified shared source. */
export type FavoriteReference =
    | { provider: 'm3u'; version: 1; urlHash: string }
    | { provider: 'xtream'; kind: 'live' | 'movie' | 'series'; id: string }
    | {
          provider: 'stalker';
          kind: 'live' | 'radio' | 'movie' | 'series';
          id: string;
          mode?: 'regular' | 'embedded' | 'lazy';
      };

/** Display hints only. Playback coordinates and credentials are never snapshots. */
export interface FavoriteSnapshot {
    title?: string;
    categoryId?: string;
    tmdbId?: string;
    releaseYear?: string;
    identityConflict?: boolean;
    /** Embedded series episode numbers, without cmd or stream addresses. */
    episodes?: number[];
}
export interface FavoriteAddress {
    instanceId: string;
    scope: 'shared';
    sourceId: string;
    sourceIncarnation: string;
    content: FavoriteReference;
}
export interface FavoriteSourceContext {
    sourceId: string;
    sourceIncarnation: string;
    provider: FavoriteReference['provider'];
}
export interface FavoriteState {
    revision: number;
    member: boolean;
    snapshot?: FavoriteSnapshot;
}
export interface FavoriteOperation {
    operationId: string;
    deviceId: string;
    expectedRevision: number;
    member: boolean;
    snapshot?: FavoriteSnapshot;
}
export interface FavoriteResult {
    status: 'applied' | 'conflict';
    state: FavoriteState;
}
export interface FavoritePending {
    address: FavoriteAddress;
    consentGeneration: string;
    operation: FavoriteOperation;
}
/** Projection and outbox are committed together; base is the last accepted server state. */
export interface FavoriteLocalRecord {
    state: FavoriteState;
    base: FavoriteState;
    pending: FavoritePending[];
    conflict?: FavoriteState;
    /** Retained pre-enable/local-only choice; never uploaded implicitly. */
    local?: FavoriteState;
    localOnly?: boolean;
}
export interface FavoriteEntry {
    address: FavoriteAddress;
    record: FavoriteLocalRecord;
}
export interface FavoriteLocalStore {
    read(address: FavoriteAddress): Promise<FavoriteLocalRecord | null>;
    entries(sourceId: string): Promise<FavoriteEntry[]>;
    pending(): Promise<FavoritePending[]>;
    mutate(
        address: FavoriteAddress,
        change: (current: FavoriteLocalRecord | null) => FavoriteLocalRecord
    ): Promise<FavoriteLocalRecord>;
}
export interface FavoriteList {
    entries: { address: FavoriteAddress; state: FavoriteState }[];
    cursor?: string;
}
export type FavoriteLocalRequest =
    | { operation: 'read'; instanceId: string; address: FavoriteAddress }
    | { operation: 'list'; instanceId: string; sourceId: string }
    | { operation: 'pending'; instanceId: string }
    | {
          operation: 'commit';
          instanceId: string;
          address: FavoriteAddress;
          expected: string | null;
          value: FavoriteLocalRecord;
      };
