import type { PlaybackPositionData } from '@iptvnator/shared/interfaces';
import type { ActivitySyncClient } from './activity-sync-client';
import {
    projectActivity,
    activityPositionMetadata as metadata,
} from './activity-projection';

/** The positions of this client's scope and the source's current incarnation. */
export async function readActivityPositions(
    client: ActivitySyncClient,
    sourceId: string
): Promise<
    { position: PlaybackPositionData; reset: boolean; conflict: boolean }[]
> {
    const incarnation = client.contexts.get(sourceId)?.sourceIncarnation;
    return (await client.store.entries(sourceId))
        .filter(
            (entry) =>
                entry.address.scope === client.scope &&
                (!incarnation ||
                    entry.address.sourceIncarnation === incarnation)
        )
        .map(({ address, record }) => ({
            position: {
                ...(record.position ?? projectActivity(address, record.state)),
                ...metadata(
                    client.alias(address) ??
                        record.position ??
                        projectActivity(address, record.state)
                ),
                watched: record.position?.watched ?? record.state.watched,
            },
            reset:
                !record.state.resume &&
                !record.state.watched &&
                !record.state.owner &&
                (!record.pending.length ||
                    record.pending[record.pending.length - 1]?.operation
                        .kind === 'reset'),
            conflict: !!record.conflict,
        }));
}
