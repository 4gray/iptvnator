/** What releasing a held choice needs from the page once its launch settled. */
export interface StalkerSeriesLaunchRelease {
    /** Whether the page still shows the series: a choice the viewer left behind is dropped. */
    readonly stillShown: () => boolean;
    /** Closes the player the launch opened; false keeps it and drops the choice. */
    readonly replacePlayer: () => Promise<boolean>;
}

/**
 * Episode choices made while a forced MPV/VLC launch of their series is
 * mid-flight. The launch IPC cannot be cancelled by a later request, so the
 * choice waits and, once the launch settled, replaces the player it opened
 * instead of playing beside it; the last choice per series wins.
 *
 * Keyed by `playlist:series`: the series view is reused across series, so a
 * launch of one series settling must not drop what another series holds.
 */
export class StalkerSeriesLaunchQueue {
    private readonly launching = new Map<string, number>();
    private readonly choices = new Map<string, () => void>();

    /** True while a launch of `seriesKey`, or the release of its held choice, is mid-flight. */
    isLaunching(seriesKey: string): boolean {
        return (this.launching.get(seriesKey) ?? 0) > 0;
    }

    /**
     * Holds `choice` until the launch of `seriesKey` settles, replacing an
     * earlier one. The choice must start the episode directly: the series
     * still counts as launching when it runs.
     */
    hold(seriesKey: string, choice: () => void): void {
        this.choices.set(seriesKey, choice);
    }

    /**
     * Runs `launch`, then the choice held for `seriesKey` meanwhile, after
     * `replacePlayer` closed what the launch opened. The series counts as
     * launching until that choice started, so nothing slips in between.
     */
    async run(
        seriesKey: string,
        launch: () => Promise<void>,
        release: StalkerSeriesLaunchRelease
    ): Promise<void> {
        this.count(seriesKey, 1);
        try {
            await launch();
        } finally {
            try {
                await this.releaseChoice(seriesKey, release);
            } finally {
                this.count(seriesKey, -1);
            }
        }
    }

    private async releaseChoice(
        seriesKey: string,
        release: StalkerSeriesLaunchRelease
    ): Promise<void> {
        if (!this.choices.has(seriesKey)) return;
        if (!release.stillShown()) {
            this.choices.delete(seriesKey);
            return;
        }
        const replaced = await release.replacePlayer();
        // The latest choice wins, including one held while the player closed.
        const choice = this.choices.get(seriesKey);
        this.choices.delete(seriesKey);
        if (replaced && release.stillShown()) choice?.();
    }

    private count(seriesKey: string, delta: number): void {
        const next = (this.launching.get(seriesKey) ?? 0) + delta;
        if (next > 0) {
            this.launching.set(seriesKey, next);
        } else {
            this.launching.delete(seriesKey);
        }
    }
}
