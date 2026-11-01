import { ActivityPositionWriteFence } from './activity-position-write-fence';
import type { IXtreamDataSource } from '@iptvnator/portal/xtream/data-access';
import type { PlaybackPositionData } from '@iptvnator/shared/interfaces';
import type { ActivitySyncClient } from '@iptvnator/services/activity-sync';
import {
    ActivityLocalOnlyPositions,
    type LocalActivitySnapshot,
} from './activity-local-only-positions';
import { ActivityLocalWriteQueue } from './activity-local-write-queue';
import {
    isStalkerEpisode,
    localActivityPosition,
    resetPosition,
} from './activity-local-position';

const positionMethods = new Set([
    'savePlaybackPosition',
    'getPlaybackPosition',
    'getSeriesPlaybackPositions',
    'getAllPlaybackPositions',
    'getRecentPlaybackPositions',
    'clearPlaybackPosition',
    'savePlaybackPositionsBatch',
    'clearPlaybackPositionsBatch',
]);

/** Compose the selected local data source with activity; catalog/favorites remain owned by raw. */
export class ActivityPositionAdapter {
    static handles(method: string): boolean {
        return positionMethods.has(method);
    }
    private readonly localWrites = new ActivityLocalWriteQueue();
    private readonly writeFence = new ActivityPositionWriteFence();
    private readonly seenLocalSessions = new Set<string>();
    constructor(
        private readonly client: ActivitySyncClient,
        private readonly strict?: {
            save(sourceId: string, data: PlaybackPositionData): Promise<void>;
            clear(
                sourceId: string,
                id: number,
                type: 'vod' | 'episode'
            ): Promise<void>;
        },
        private readonly localOnly = new ActivityLocalOnlyPositions()
    ) {}

    async invoke(
        raw: IXtreamDataSource,
        method: string,
        args: unknown[],
        localOnly = false
    ): Promise<unknown> {
        const sourceId = args[0] as string;
        if (
            method === 'savePlaybackPosition' ||
            method === 'savePlaybackPositionsBatch'
        ) {
            const positions = (
                method === 'savePlaybackPosition' ? [args[1]] : args[1]
            ) as PlaybackPositionData[];
            for (const position of positions) {
                const { current, finish } = this.writeFence.start(
                    sourceId,
                    position
                );
                try {
                    if (localOnly) {
                        await this.saveLocalOnly(raw, sourceId, position);
                        continue;
                    }
                    // Compatibility migrations and restores are local writes, never consent to upload.
                    if (
                        !position.activitySessionId &&
                        position.activityAction !== 'mark-watched'
                    ) {
                        await (this.strict?.save(sourceId, position) ??
                            raw.savePlaybackPosition(sourceId, position));
                        continue;
                    }
                    const localSession = position.activitySessionId;
                    if (
                        localSession &&
                        this.seenLocalSessions.has(localSession) &&
                        !this.localOnly.owns(sourceId, position) &&
                        !this.client.sessions.has(localSession)
                    ) {
                        // A committed action cleared this fallback, including in a sibling tab.
                        this.client.retiredSessions.add(localSession);
                        this.client.localSessions.delete(localSession);
                        continue;
                    }
                    if (
                        position.activitySessionId &&
                        this.localOnly.has(sourceId, position) &&
                        !this.client.sessions.has(position.activitySessionId)
                    ) {
                        if (
                            !this.localOnly.owns(sourceId, position) &&
                            !this.client.localSessions.has(
                                position.activitySessionId
                            )
                        ) {
                            this.client.retiredSessions.add(
                                position.activitySessionId
                            );
                            continue;
                        }
                        await this.saveLocalOnly(raw, sourceId, position);
                        continue;
                    }
                    let delivery: 'local-only' | void;
                    try {
                        delivery = await this.client.save(sourceId, position);
                    } catch (error) {
                        // A new source may never have received its portable incarnation before going offline.
                        if (current())
                            await this.saveLocalOnly(raw, sourceId, position);
                        throw error;
                    }
                    if (delivery === 'local-only' && current())
                        await this.saveLocalOnly(raw, sourceId, position);
                } finally {
                    finish();
                }
            }
            return;
        }
        if (
            method === 'clearPlaybackPosition' ||
            method === 'clearPlaybackPositionsBatch'
        ) {
            const items =
                method === 'clearPlaybackPosition'
                    ? [
                          {
                              contentXtreamId: args[1] as number,
                              contentType: args[2] as 'vod' | 'episode',
                          },
                      ]
                    : (args[1] as {
                          contentXtreamId: number;
                          contentType: 'vod' | 'episode';
                      }[]);
            this.supersede(method, args);
            const current = await this.all(raw, sourceId);
            for (const item of items) {
                const position = current.find(
                    (p) =>
                        p.contentType === item.contentType &&
                        p.contentXtreamId === item.contentXtreamId
                );
                const aliases = [...this.client.aliases.values()].filter(
                    (candidate) =>
                        candidate.playlistId === sourceId &&
                        candidate.contentType === item.contentType &&
                        candidate.contentXtreamId === item.contentXtreamId
                );
                const shared = (await this.client.positions(sourceId)).filter(
                    (candidate) =>
                        candidate.position.contentType === item.contentType &&
                        candidate.position.contentXtreamId ===
                            item.contentXtreamId
                );
                if (aliases.length > 1 || shared.length > 1)
                    throw new Error('Activity identity ambiguous');
                if (localOnly) {
                    const target = position ??
                        shared[0]?.position ??
                        aliases[0] ?? { ...item, positionSeconds: 0 };
                    await this.resetLocal(raw, sourceId, target);
                    continue;
                }
                try {
                    await this.client.reset(sourceId, position ?? item);
                } catch (error) {
                    // An unbound source cannot send a portable reset while offline.
                    if (
                        this.client.contexts.has(sourceId) &&
                        (!(error instanceof Error) ||
                            error.message !== 'Activity identity unavailable')
                    )
                        throw error;
                    await this.resetLocal(
                        raw,
                        sourceId,
                        position ??
                            shared[0]?.position ??
                            aliases[0] ?? { ...item, positionSeconds: 0 }
                    );
                }
            }
            return;
        }
        const positions = await this.all(
            raw,
            sourceId,
            method === 'getSeriesPlaybackPositions'
        );
        if (method === 'getPlaybackPosition')
            return (
                positions.find(
                    (p) =>
                        p.contentXtreamId === args[1] &&
                        p.contentType === args[2]
                ) ?? null
            );
        if (method === 'getSeriesPlaybackPositions')
            return positions.filter(
                (p) =>
                    p.contentType === 'episode' && p.seriesXtreamId === args[1]
            );
        if (method === 'getRecentPlaybackPositions') {
            positions.sort(
                (a, b) =>
                    Date.parse(b.updatedAt ?? '') -
                    Date.parse(a.updatedAt ?? '')
            );
            return args[1] === undefined
                ? positions
                : positions.slice(0, args[1] as number);
        }
        return positions;
    }

    supersede(method: string, args: unknown[]): void {
        this.writeFence.supersede(method, args);
    }

    private async resetLocal(
        raw: IXtreamDataSource,
        sourceId: string,
        position: PlaybackPositionData
    ): Promise<void> {
        for (const sessionId of new Set([
            ...this.seenLocalSessions,
            ...this.client.localSessions.keys(),
        ]))
            if (
                this.localOnly.owns(sourceId, {
                    ...position,
                    activitySessionId: sessionId,
                })
            ) {
                this.client.localSessions.delete(sessionId);
                this.client.retiredSessions.add(sessionId);
            }
        await this.saveLocalOnly(
            raw,
            sourceId,
            resetPosition(position),
            !isStalkerEpisode(position)
        );
    }

    private async saveLocalOnly(
        raw: IXtreamDataSource,
        sourceId: string,
        position: PlaybackPositionData,
        clearing = false
    ): Promise<void> {
        const local = localActivityPosition(position);
        const snapshot = this.localOnly.stage(
            sourceId,
            local,
            position.activitySessionId,
            clearing
        );
        if (position.activitySessionId)
            this.seenLocalSessions.add(position.activitySessionId);
        await this.persistLocal(raw, sourceId, snapshot);
        this.client.options.changed();
    }

    private persistLocal(
        raw: IXtreamDataSource,
        sourceId: string,
        snapshot: LocalActivitySnapshot
    ): Promise<void> {
        return this.localWrites.run(sourceId, snapshot.position, async () => {
            if (snapshot.clearing) {
                const { contentXtreamId, contentType } = snapshot.position;
                await (this.strict?.clear(
                    sourceId,
                    contentXtreamId,
                    contentType
                ) ??
                    raw.clearPlaybackPosition(
                        sourceId,
                        contentXtreamId,
                        contentType
                    ));
            } else
                await (this.strict?.save(sourceId, snapshot.position) ??
                    raw.savePlaybackPosition(sourceId, snapshot.position));
            this.localOnly.complete(sourceId, snapshot);
        });
    }

    async all(
        raw: IXtreamDataSource,
        sourceId: string,
        includeSeriesResets = false
    ): Promise<PlaybackPositionData[]> {
        return this.project(
            sourceId,
            await raw.getAllPlaybackPositions(sourceId),
            includeSeriesResets
        );
    }

    async project(
        sourceId: string,
        local: PlaybackPositionData[],
        includeSeriesResets = false
    ): Promise<PlaybackPositionData[]> {
        const positions = new Map(
            local.map((p) => [`${p.contentType}:${p.contentXtreamId}`, p])
        );
        for (const snapshot of this.localOnly.snapshots(sourceId)) {
            const key = `${snapshot.position.contentType}:${snapshot.position.contentXtreamId}`;
            if (snapshot.clearing) positions.delete(key);
            else
                positions.set(key, {
                    ...positions.get(key),
                    ...snapshot.position,
                });
        }
        for (const item of await this.client.positions(sourceId)) {
            const key = `${item.position.contentType}:${item.position.contentXtreamId}`;
            if (this.localOnly.has(sourceId, item.position)) {
                if (
                    !positions.has(key) &&
                    includeSeriesResets &&
                    isStalkerEpisode(item.position)
                )
                    positions.set(key, resetPosition(item.position));
                continue;
            }
            if (item.reset) {
                positions.delete(key);
                // An exact zero row blocks guarded legacy aliases from promoting
                // old Stalker episode progress back into the series view.
                if (includeSeriesResets && isStalkerEpisode(item.position))
                    positions.set(key, resetPosition(item.position));
            } else positions.set(key, item.position);
        }
        return [...positions.values()];
    }

    async exportPositions(
        sourceId: string,
        local: PlaybackPositionData[]
    ): Promise<PlaybackPositionData[]> {
        return (await this.project(sourceId, local, true)).map(
            localActivityPosition
        );
    }

    protectLocal(sourceId: string, position: PlaybackPositionData): void {
        this.localOnly.mark(sourceId, position);
    }

    async keepLocal(raw: IXtreamDataSource, sourceId: string): Promise<void> {
        do {
            await this.localWrites.wait(sourceId);
            for (const snapshot of this.localOnly.snapshots(sourceId))
                await this.persistLocal(raw, sourceId, snapshot);
            for (const item of await this.client.positions(sourceId)) {
                const position = item.position;
                if (this.localOnly.has(sourceId, position)) continue;
                if (item.reset && isStalkerEpisode(position)) {
                    const reset = localActivityPosition(
                        resetPosition(position)
                    );
                    await (this.strict?.save(sourceId, reset) ??
                        raw.savePlaybackPosition(sourceId, reset));
                } else if (item.reset)
                    await (this.strict?.clear(
                        sourceId,
                        position.contentXtreamId,
                        position.contentType
                    ) ??
                        raw.clearPlaybackPosition(
                            sourceId,
                            position.contentXtreamId,
                            position.contentType
                        ));
                else {
                    const local = localActivityPosition(position);
                    await (this.strict?.save(sourceId, local) ??
                        raw.savePlaybackPosition(sourceId, local));
                }
            }
            await this.localWrites.wait(sourceId);
        } while (this.localOnly.snapshots(sourceId).length);
    }
}
