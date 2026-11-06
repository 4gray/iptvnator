import type { PlaybackPositionData } from '@iptvnator/shared/interfaces';
import type { ActivitySyncClient } from '@iptvnator/services/activity-sync';

type ClearItem = Pick<PlaybackPositionData, 'contentType' | 'contentXtreamId'>;

/** Capture reset ownership at invocation, before reading local or shared positions. */
export async function clearActivityPositions(
    client: ActivitySyncClient,
    method: string,
    args: unknown[],
    localOnly: boolean,
    access: {
        all(): Promise<PlaybackPositionData[]>;
        local(position: PlaybackPositionData): Promise<void>;
        start(item: ClearItem): { current(): boolean; finish(): void };
    }
): Promise<void> {
    const sourceId = args[0] as string;
    const items: ClearItem[] =
        method === 'clearPlaybackPosition'
            ? [
                  {
                      contentXtreamId: args[1] as number,
                      contentType: args[2] as 'vod' | 'episode',
                  },
              ]
            : (args[1] as ClearItem[]);
    const actions = items.map((item) => {
        const write = access.start(item);
        const shared = client.actions.position(sourceId, item);
        return {
            item,
            write,
            current: () =>
                write.current() &&
                shared() &&
                client.options.profileActive?.() !== false,
        };
    });
    try {
        const positions = await access.all();
        for (const { item, current } of actions) {
            if (!current()) continue;
            const position = positions.find(
                (p) =>
                    p.contentType === item.contentType &&
                    p.contentXtreamId === item.contentXtreamId
            );
            const aliases = [...client.aliases.values()].filter(
                (p) =>
                    p.playlistId === sourceId &&
                    p.contentType === item.contentType &&
                    p.contentXtreamId === item.contentXtreamId
            );
            const shared = (await client.positions(sourceId)).filter(
                ({ position: p }) =>
                    p.contentType === item.contentType &&
                    p.contentXtreamId === item.contentXtreamId
            );
            if (!current()) continue;
            if (aliases.length > 1 || shared.length > 1)
                throw new Error('Activity identity ambiguous');
            const target = position ??
                shared[0]?.position ??
                aliases[0] ?? { ...item, positionSeconds: 0 };
            if (localOnly) {
                await access.local(target);
                continue;
            }
            try {
                const delivery = await client.reset(
                    sourceId,
                    position ?? item,
                    current
                );
                if (delivery === 'local-only' && current())
                    await access.local(target);
            } catch (error) {
                if (!current()) continue;
                // An unbound source cannot send a portable reset while offline.
                if (
                    client.contexts.has(sourceId) &&
                    (!(error instanceof Error) ||
                        error.message !== 'Activity identity unavailable')
                )
                    throw error;
                await access.local(target);
            }
        }
    } finally {
        for (const { write } of actions) write.finish();
    }
}
