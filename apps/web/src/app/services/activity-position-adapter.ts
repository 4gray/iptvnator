import type { IXtreamDataSource } from '@iptvnator/portal/xtream/data-access';
import type { PlaybackPositionData } from '@iptvnator/shared/interfaces';
import type { ActivitySyncClient } from '@iptvnator/services/activity-sync';

/** Compose the selected local data source with activity; catalog/favorites remain owned by raw. */
export class ActivityPositionAdapter {
    constructor(
        private readonly client: ActivitySyncClient,
        private readonly strict?: {
            save(sourceId: string, data: PlaybackPositionData): Promise<void>;
            clear(
                sourceId: string,
                id: number,
                type: 'vod' | 'episode'
            ): Promise<void>;
        }
    ) {}

    async invoke(
        raw: IXtreamDataSource,
        method: string,
        args: unknown[]
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
                // Compatibility migrations and restores are local writes, never consent to upload.
                if (
                    !position.activitySessionId &&
                    position.activityAction !== 'mark-watched'
                ) {
                    await (this.strict?.save(sourceId, position) ??
                        raw.savePlaybackPosition(sourceId, position));
                    continue;
                }
                try {
                    await this.client.save(sourceId, position);
                } catch (error) {
                    // A new source may never have received its portable incarnation before going offline.
                    const local = { ...position };
                    delete local.activitySessionId;
                    delete local.activityAction;
                    await (this.strict?.save(sourceId, local) ??
                        raw.savePlaybackPosition(sourceId, local));
                    throw error;
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
                try {
                    await this.client.reset(sourceId, position ?? item);
                } catch (error) {
                    // Legacy Stalker aliases have no portable identity; cleanup stays local.
                    if (
                        !(error instanceof Error) ||
                        error.message !== 'Activity identity unavailable'
                    )
                        throw error;
                    await (this.strict?.clear(
                        sourceId,
                        item.contentXtreamId,
                        item.contentType
                    ) ??
                        raw.clearPlaybackPosition(
                            sourceId,
                            item.contentXtreamId,
                            item.contentType
                        ));
                }
            }
            return;
        }
        const positions = await this.all(raw, sourceId);
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

    async all(
        raw: IXtreamDataSource,
        sourceId: string
    ): Promise<PlaybackPositionData[]> {
        const local = await raw.getAllPlaybackPositions(sourceId);
        const positions = new Map(
            local.map((p) => [`${p.contentType}:${p.contentXtreamId}`, p])
        );
        for (const item of await this.client.positions(sourceId)) {
            const key = `${item.position.contentType}:${item.position.contentXtreamId}`;
            if (item.reset) positions.delete(key);
            else positions.set(key, item.position);
        }
        return [...positions.values()];
    }

    async keepLocal(raw: IXtreamDataSource, sourceId: string): Promise<void> {
        for (const item of await this.client.positions(sourceId)) {
            const position = item.position;
            if (item.reset)
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
                const duration =
                    position.durationSeconds && position.durationSeconds > 0
                        ? position.durationSeconds
                        : 1;
                const local = position.watched
                    ? {
                          ...position,
                          positionSeconds: duration,
                          durationSeconds: duration,
                      }
                    : position;
                await (this.strict?.save(sourceId, local) ??
                    raw.savePlaybackPosition(sourceId, local));
            }
        }
    }
}
