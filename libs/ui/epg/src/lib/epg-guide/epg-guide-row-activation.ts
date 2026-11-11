import type { EpgGuideChannel, EpgGuideSource } from './epg-guide-source';

/** Coordinates preview clicks and commits from the keyboard or a double-click. */
export function createEpgGuideRowActivation(
    source: EpgGuideSource,
    rows: () => readonly EpgGuideChannel[],
    notify: (id: string) => void,
    close: () => void
) {
    const activate = (
        channel: EpgGuideChannel | undefined,
        confirmed?: () => void
    ): boolean => {
        if (!channel) return false;
        // The active row is skipped only while live: in catch-up the same click returns to live.
        if (
            !confirmed &&
            channel.id === source.activeChannelId() &&
            (source.livePlayback?.() ?? true) &&
            source.channels().find((row) => row.id === channel.id)?.epgKey ===
                channel.epgKey
        )
            return false;
        if (confirmed)
            source.activate(channel.id, channel.epgKey, rows(), confirmed);
        else source.activate(channel.id, channel.epgKey, rows());
        notify(channel.id);
        return true;
    };

    return {
        activate,
        commit(
            channel: EpgGuideChannel | undefined,
            allowRetry: boolean
        ): void {
            if (!channel) return;
            const confirmed = source.closeOnPlaybackConfirmation
                ? close
                : undefined;
            const retry =
                allowRetry &&
                (confirmed
                    ? source.retryActive?.(channel, rows(), confirmed)
                    : source.retryActive?.(channel, rows()));
            if (retry) notify(channel.id);
            else if (!activate(channel, confirmed)) return close();
            if (!confirmed) close();
        },
    };
}
