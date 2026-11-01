import type { IXtreamDataSource } from '@iptvnator/portal/xtream/data-access';
import type { ActivitySyncClient } from '@iptvnator/services/activity-sync';
import type { PlaybackPositionData } from '@iptvnator/shared/interfaces';
import type { ActivityPositionAdapter } from './activity-position-adapter';

export type ActivityImportPreview = {
    sourceId: string;
    items: PlaybackPositionData[];
}[];

export async function handleParkedActivity(
    client: ActivitySyncClient,
    adapter: ActivityPositionAdapter,
    raw: IXtreamDataSource,
    sourceIds: string[],
    send: boolean,
    generation: string
): Promise<void> {
    for (const sourceId of sourceIds) {
        if (!send) await adapter.keepLocal(raw, sourceId);
        for (const { address, record } of await client.store.entries(
            sourceId
        )) {
            if (
                !record.pending.length ||
                address.sourceIncarnation !==
                    client.contexts.get(sourceId)?.sourceIncarnation
            )
                continue;
            if (!send) {
                if (record.position)
                    adapter.protectLocal(sourceId, record.position);
                await client.resolve(address, false, true);
            } else
                await client.store.mutate(address, (current) => ({
                    ...current!,
                    pending: current!.pending.map((intent) => ({
                        ...intent,
                        consentGeneration: generation,
                        deliveryLease: undefined,
                    })),
                }));
        }
    }
    await client.flush();
}

export async function previewLocalActivity(
    raw: IXtreamDataSource,
    sourceIds: string[]
): Promise<ActivityImportPreview> {
    const preview: ActivityImportPreview = [];
    for (const sourceId of sourceIds)
        preview.push({
            sourceId,
            items: await raw.getAllPlaybackPositions(sourceId),
        });
    return preview;
}

export async function importLocalActivity(
    client: ActivitySyncClient,
    preview: ActivityImportPreview
): Promise<number> {
    let unresolved = 0;
    for (const source of preview)
        for (const position of source.items) {
            try {
                await client.importPosition(source.sourceId, position);
            } catch {
                unresolved++;
            }
        }
    return unresolved;
}

export async function readActivitySummary(
    client: ActivitySyncClient,
    sourceIds: string[]
) {
    const entries = (
        await Promise.all(sourceIds.map((id) => client.store.entries(id)))
    )
        .reduce((all, group) => all.concat(group), [])
        .filter(
            (entry) =>
                entry.address.sourceIncarnation ===
                client.contexts.get(entry.address.sourceId)?.sourceIncarnation
        );
    return {
        pending: entries.reduce(
            (count, entry) => count + entry.record.pending.length,
            0
        ),
        conflicts: entries.filter((entry) => !!entry.record.conflict),
    };
}
