import {
    createRandomId,
    type PlaybackPositionData,
} from '@iptvnator/shared/interfaces';
import type { ActivitySourceContext } from '@iptvnator/shared/interfaces/activity-sync';

type PositionKey = Partial<
    Pick<
        PlaybackPositionData,
        'contentType' | 'contentXtreamId' | 'activitySessionId'
    >
>;
type LocalStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> &
    Partial<Pick<Storage, 'key' | 'length'>>;
interface Ownership {
    version: 2;
    scope: string | null;
    sessionId: string;
    token?: string;
    position?: PlaybackPositionData;
}
export interface LocalActivitySnapshot {
    token: string;
    position: PlaybackPositionData;
}

/** Scope-bound local ownership; an unacknowledged raw write retains its durable point. */
export class ActivityLocalOnlyPositions {
    private readonly storage: LocalStorage;
    private readonly firstScopes = new Map<string, string>();
    constructor(
        private readonly instanceId = 'memory',
        storage?: LocalStorage,
        private readonly incarnation: (
            sourceId: string
        ) => string | undefined = () => undefined,
        contexts: ActivitySourceContext[] = []
    ) {
        const memory = new Map<string, string>();
        this.storage = storage ?? {
            getItem: (key) => memory.get(key) ?? null,
            setItem: (key, value) => {
                memory.set(key, value);
            },
            removeItem: (key) => {
                memory.delete(key);
            },
            key: (index) => [...memory.keys()][index] ?? null,
            get length() {
                return memory.size;
            },
        };
        this.rememberSources(contexts, false);
    }
    private firstKey(sourceId: string): string {
        return `iptvnator-server:${this.instanceId}:activity-local-scope-v1:${sourceId}`;
    }
    /** Persist the bootstrap binding before publishing a newly verified context. */
    rememberSources(contexts: ActivitySourceContext[], persist = true): void {
        for (const context of contexts) {
            const key = this.firstKey(context.sourceId);
            const saved = this.storage.getItem(key);
            const first =
                this.firstScopes.get(context.sourceId) ??
                saved ??
                context.sourceIncarnation;
            this.firstScopes.set(context.sourceId, first);
            if (persist && !saved) this.storage.setItem(key, first);
        }
    }
    private scope(sourceId: string): string | null {
        const known = this.incarnation(sourceId);
        const first =
            this.firstScopes.get(sourceId) ??
            this.storage.getItem(this.firstKey(sourceId)) ??
            known;
        if (first) this.firstScopes.set(sourceId, first);
        return known ?? first ?? null;
    }
    private key(sourceId: string, position: PositionKey): string | null {
        if (
            position.contentType === undefined ||
            position.contentXtreamId === undefined
        )
            return null;
        return `iptvnator-server:${this.instanceId}:activity-local-only-v1:${JSON.stringify([sourceId, position.contentType, position.contentXtreamId])}`;
    }
    private read(sourceId: string, key: string | null): Ownership | null {
        if (!key) return null;
        const value = this.storage.getItem(key);
        if (value === null) return null;
        const scope = this.scope(sourceId);
        if (value === '1' || value.startsWith('local:')) {
            // Development flags had no verified identity; never apply them to a verified source.
            return scope === null
                ? {
                      version: 2,
                      scope: null,
                      sessionId: value === '1' ? '' : value.slice(6),
                  }
                : null;
        }
        const record = JSON.parse(value) as Ownership;
        if (
            record.version !== 2 ||
            (record.scope !== null && typeof record.scope !== 'string') ||
            typeof record.sessionId !== 'string'
        )
            throw new Error('Local activity ownership unavailable');
        const bound = record.scope ?? this.firstScopes.get(sourceId) ?? null;
        if (scope !== bound) return null;
        if (record.position) {
            this.validate(record.position);
            if (typeof record.token !== 'string' || !record.token)
                throw new Error('Local activity snapshot unavailable');
        }
        return record;
    }
    private write(
        sourceId: string,
        position: PositionKey,
        value: Ownership
    ): void {
        const key = this.key(sourceId, position);
        if (!key) throw new Error('Local activity identity unavailable');
        this.storage.setItem(key, JSON.stringify(value));
    }
    has(sourceId: string, position: PositionKey): boolean {
        return this.read(sourceId, this.key(sourceId, position)) !== null;
    }
    owns(sourceId: string, position: PositionKey): boolean {
        return (
            !!position.activitySessionId &&
            this.read(sourceId, this.key(sourceId, position))?.sessionId ===
                position.activitySessionId
        );
    }
    committed(
        sourceId: string,
        position: PositionKey,
        kind: 'begin' | 'checkpoint' | 'command'
    ): void {
        if (kind !== 'checkpoint' || this.owns(sourceId, position))
            this.clear(sourceId, position);
    }
    mark(sourceId: string, position: PositionKey): void {
        this.write(sourceId, position, {
            version: 2,
            scope: this.scope(sourceId),
            sessionId: position.activitySessionId ?? '',
        });
    }
    stage(
        sourceId: string,
        position: PlaybackPositionData,
        sessionId?: string
    ): LocalActivitySnapshot {
        this.validate(position);
        const token = createRandomId();
        const snapshot: PlaybackPositionData = {
            contentType: position.contentType,
            contentXtreamId: position.contentXtreamId,
            seriesXtreamId: position.seriesXtreamId,
            seasonNumber: position.seasonNumber,
            episodeNumber: position.episodeNumber,
            positionSeconds: position.positionSeconds,
            durationSeconds: position.durationSeconds,
            watched: position.watched,
            activityIdentity: position.activityIdentity,
            playlistId: sourceId,
            updatedAt: new Date().toISOString(),
        };
        this.write(sourceId, position, {
            version: 2,
            scope: this.scope(sourceId),
            sessionId: sessionId ?? '',
            token,
            position: snapshot,
        });
        return { token, position: snapshot };
    }
    complete(sourceId: string, snapshot: LocalActivitySnapshot): void {
        const current = this.read(
            sourceId,
            this.key(sourceId, snapshot.position)
        );
        if (current?.token !== snapshot.token) return;
        this.write(sourceId, snapshot.position, {
            version: 2,
            scope: current.scope,
            sessionId: current.sessionId,
        });
    }
    snapshots(sourceId: string): LocalActivitySnapshot[] {
        const prefix = `iptvnator-server:${this.instanceId}:activity-local-only-v1:${JSON.stringify([sourceId]).slice(0, -1)},`;
        const result: LocalActivitySnapshot[] = [];
        const keys = Array.from(
            { length: this.storage.length ?? 0 },
            (_, index) => this.storage.key?.(index)
        );
        for (const key of keys) {
            if (!key?.startsWith(prefix)) continue;
            const record = this.read(sourceId, key);
            if (record?.position && record.token)
                result.push({ token: record.token, position: record.position });
        }
        return result;
    }
    clear(sourceId: string, position: PositionKey): void {
        const key = this.key(sourceId, position);
        if (key && this.storage.getItem(key) !== null)
            this.storage.removeItem(key);
    }
    private validate(position: PlaybackPositionData): void {
        if (
            !['vod', 'episode'].includes(position.contentType) ||
            !Number.isFinite(position.contentXtreamId) ||
            !Number.isFinite(position.positionSeconds) ||
            position.positionSeconds < 0 ||
            (position.durationSeconds !== undefined &&
                (!Number.isFinite(position.durationSeconds) ||
                    position.durationSeconds < 0))
        )
            throw new Error('Local activity position unavailable');
    }
}
