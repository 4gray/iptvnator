import { identity, type Media, type Source, type UserData } from './index';

export function availableChannel(
    item: Media,
    sources: Source[]
): Source | undefined {
    return item.kind === 'live'
        ? sources.find(
              (source) =>
                  source.id === item.sourceId &&
                  item.id ===
                      identity(
                          source,
                          'live',
                          source.provider === 'stalker'
                              ? `live:${item.providerId}`
                              : item.providerId
                      )
          )
        : undefined;
}

/** History is already confirmed by the player; deriving this rail never writes it. */
export function recentChannels(data: UserData): Media[] {
    const seen = new Set<string>();
    return data.history
        .map((progress, ordinal) => ({ progress, ordinal }))
        .filter(({ progress }) => availableChannel(progress.item, data.sources))
        .sort(
            (a, b) =>
                b.progress.updated - a.progress.updated || a.ordinal - b.ordinal
        )
        .filter(({ progress }) => {
            if (seen.has(progress.item.id)) return false;
            seen.add(progress.item.id);
            return true;
        })
        .slice(0, 12)
        .map(({ progress }) => progress.item);
}
