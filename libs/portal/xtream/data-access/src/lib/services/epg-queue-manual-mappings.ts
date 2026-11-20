import { buildXtreamEpgMappingKey } from '@iptvnator/shared/interfaces';

type ManualMappingEntry = {
    streamId: number;
    playlistId?: string | null;
    epgChannelId?: string | null;
    manualEpgMapping?: boolean;
};

type GetEpgMappingsBatch = (
    keys: string[]
) => Promise<Record<string, string | null | undefined>>;

/** Resolve user mappings in one bridge call and retain their explicit priority. */
export async function resolveManualEpgMappings(
    entries: ManualMappingEntry[],
    getMappings: GetEpgMappingsBatch | null,
    log: (message: string) => void
): Promise<void> {
    if (!getMappings) return;
    const keyByStreamId = new Map<number, string>();
    for (const entry of entries) {
        if (entry.playlistId) {
            keyByStreamId.set(
                entry.streamId,
                buildXtreamEpgMappingKey(entry.playlistId, entry.streamId)
            );
        }
    }
    if (!keyByStreamId.size) return;

    try {
        const mappings = await getMappings([...keyByStreamId.values()]);
        for (const entry of entries) {
            const key = keyByStreamId.get(entry.streamId);
            const mapped = key ? mappings[key]?.trim() : undefined;
            if (mapped) {
                log(`Mapped stream ${entry.streamId}: ${entry.epgChannelId ?? '(none)'} → ${mapped}`);
                entry.epgChannelId = mapped;
                entry.manualEpgMapping = true;
            }
        }
    } catch {
        // A lookup failure keeps the provider ID and normal fallback behavior.
    }
}
