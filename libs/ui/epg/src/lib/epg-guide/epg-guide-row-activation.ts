import type { EpgGuideChannel, EpgGuideSource } from './epg-guide-source';

/** Coordinates preview clicks and commits from the keyboard or a double-click. */
export function createEpgGuideRowActivation(
    source: EpgGuideSource,
    rows: () => readonly EpgGuideChannel[],
    notify: (id: string) => void,
    close: () => void
) {
    let pointerTune:
        | {
              channel: EpgGuideChannel;
              started: boolean;
              confirmed: boolean;
              committed: boolean;
          }
        | undefined;
    const activate = (
        channel: EpgGuideChannel | undefined,
        confirmed?: () => void,
        skipActive = !confirmed
    ): boolean => {
        if (!channel) return false;
        if (
            skipActive &&
            channel.id === source.activeChannelId() &&
            (source.livePlayback?.() ?? true) &&
            !source.canRetuneActive?.() &&
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

    const commit = (
        channel: EpgGuideChannel | undefined,
        allowRetry: boolean
    ): void => {
        pointerTune = undefined;
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
    };

    return {
        activate(channel: EpgGuideChannel | undefined): void {
            pointerTune = undefined;
            activate(channel);
        },
        commit,
        pointer(channel: EpgGuideChannel, allowRetry?: boolean): void {
            if (allowRetry !== undefined) {
                const tune = pointerTune;
                if (
                    !tune?.started ||
                    tune.channel.id !== channel.id ||
                    tune.channel.epgKey !== channel.epgKey
                )
                    return commit(channel, allowRetry);
                tune.committed = true;
                if (tune.confirmed) close();
                return;
            }
            if (!source.closeOnPlaybackConfirmation) {
                activate(channel);
                return;
            }
            const tune = {
                channel,
                started: false,
                confirmed: false,
                committed: false,
            };
            pointerTune = tune;
            tune.started = activate(
                channel,
                () => {
                    tune.confirmed = true;
                    if (pointerTune === tune && tune.committed) close();
                },
                true
            );
        },
    };
}
