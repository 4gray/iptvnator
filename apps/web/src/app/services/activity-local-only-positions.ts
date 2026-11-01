import type { PlaybackPositionData } from '@iptvnator/shared/interfaces';

type PositionKey = Partial<
    Pick<
        PlaybackPositionData,
        'contentType' | 'contentXtreamId' | 'activitySessionId'
    >
>;

/** Per-item flags protect local fallback rows without uploading them or copying progress. */
export class ActivityLocalOnlyPositions {
    private readonly memory = new Map<string, string>();
    constructor(
        private readonly instanceId = 'memory',
        private readonly storage: Pick<
            Storage,
            'getItem' | 'setItem' | 'removeItem'
        > = {
            getItem: (key) => this.memory.get(key) ?? null,
            setItem: (key, value) => {
                this.memory.set(key, value);
            },
            removeItem: (key) => {
                this.memory.delete(key);
            },
        }
    ) {}
    private key(sourceId: string, position: PositionKey): string | null {
        if (
            position.contentType === undefined ||
            position.contentXtreamId === undefined
        )
            return null;
        return `iptvnator-server:${this.instanceId}:activity-local-only-v1:${JSON.stringify([sourceId, position.contentType, position.contentXtreamId])}`;
    }
    private session(sourceId: string, position: PositionKey): string | null {
        const key = this.key(sourceId, position);
        if (!key) return null;
        const value = this.storage.getItem(key);
        if (value === null) return null;
        if (value === '1') return ''; // Preserve anonymous flags from development snapshots.
        if (!value.startsWith('local:'))
            throw new Error('Local activity ownership unavailable');
        return value.slice(6);
    }
    has(sourceId: string, position: PositionKey): boolean {
        return this.session(sourceId, position) !== null;
    }
    owns(sourceId: string, position: PositionKey): boolean {
        return (
            !!position.activitySessionId &&
            this.session(sourceId, position) === position.activitySessionId
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
        const key = this.key(sourceId, position);
        if (!key) throw new Error('Local activity identity unavailable');
        this.storage.setItem(key, `local:${position.activitySessionId ?? ''}`);
    }
    clear(sourceId: string, position: PositionKey): void {
        const key = this.key(sourceId, position);
        if (key && this.storage.getItem(key) !== null)
            this.storage.removeItem(key);
    }
}
