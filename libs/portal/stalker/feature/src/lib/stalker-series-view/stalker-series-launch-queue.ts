/**
 * Episode choices made while a forced MPV/VLC launch of their series is
 * mid-flight. The launch IPC cannot be cancelled by a later request, so the
 * choice waits and plays once the launch settles instead of opening a second
 * player; the last choice per series wins.
 *
 * Keyed by `playlist:series`: the series view is reused across series, so a
 * launch of one series settling must not drop what another series holds.
 */
export class StalkerSeriesLaunchQueue {
    private readonly launching = new Set<string>();
    private readonly choices = new Map<string, () => void>();

    /** True while a launch of `seriesKey` is mid-flight. */
    isLaunching(seriesKey: string): boolean {
        return this.launching.has(seriesKey);
    }

    /** Holds `choice` until the launch of `seriesKey` settles, replacing an earlier one. */
    hold(seriesKey: string, choice: () => void): void {
        this.choices.set(seriesKey, choice);
    }

    /**
     * Runs `launch`, then the choice held for `seriesKey` meanwhile, unless
     * `stillShown` reports that the page moved on to another series.
     */
    async run(
        seriesKey: string,
        launch: () => Promise<void>,
        stillShown: () => boolean
    ): Promise<void> {
        this.launching.add(seriesKey);
        try {
            await launch();
        } finally {
            this.launching.delete(seriesKey);
            const choice = this.choices.get(seriesKey);
            this.choices.delete(seriesKey);
            if (choice && stillShown()) choice();
        }
    }
}
