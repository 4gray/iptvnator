/** Stops automatic reopen when a live stream keeps ending immediately. */
export class ChannelLoopLimiter {
    private source = '';
    private lastEnd = 0;
    private fastEnds = 0;
    private suspended = false;

    setSource(url: string): void {
        if (url === this.source) return;
        this.source = url;
        this.reset();
    }

    allow(now = Date.now()): boolean {
        if (this.suspended) return false;
        if (this.lastEnd && now - this.lastEnd < 4000) {
            this.fastEnds += 1;
            if (this.fastEnds >= 3) {
                this.suspended = true;
                console.warn(
                    'Loop channel stopped after repeated immediate endings.'
                );
                return false;
            }
        } else {
            this.fastEnds = 0;
        }
        this.lastEnd = now;
        return true;
    }

    reset(): void {
        this.lastEnd = 0;
        this.fastEnds = 0;
        this.suspended = false;
    }
}
