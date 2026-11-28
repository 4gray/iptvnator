interface PollTimers {
    delay?: NodeJS.Timeout;
    interval?: NodeJS.Timeout;
}

/** Each process contributes activity; only the newest poller saves resume data. */
export class ExternalPlayerPositionPollers {
    private readonly timers = new Map<string, PollTimers>();
    private primary: string | undefined;

    start(
        sessionId: string,
        delayMs: number,
        intervalMs: number,
        poll: (isCurrent: () => boolean) => Promise<void>
    ): void {
        this.stop(sessionId);
        this.primary = sessionId;
        const timers: PollTimers = {};
        const isCurrent = () => this.timers.get(sessionId) === timers;
        timers.delay = setTimeout(() => {
            timers.interval = setInterval(
                () => void poll(isCurrent),
                intervalMs
            );
        }, delayMs);
        this.timers.set(sessionId, timers);
    }

    isPrimary(sessionId: string): boolean {
        return this.primary === sessionId;
    }

    stop(sessionId?: string): void {
        if (sessionId === undefined) {
            this.timers.forEach((_, id) => this.stop(id));
            return;
        }
        const timers = this.timers.get(sessionId);
        clearTimeout(timers?.delay);
        clearInterval(timers?.interval);
        this.timers.delete(sessionId);
        if (this.primary === sessionId) this.primary = undefined;
    }
}
