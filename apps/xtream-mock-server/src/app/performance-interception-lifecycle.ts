type InvalidateInterception = (abortHeldResponse: boolean) => void;

export class PerformanceInterceptionLifecycle {
    private currentGeneration = 1;
    private stopped = false;
    private readonly active = new Map<symbol, InvalidateInterception>();

    get generation(): number {
        return this.currentGeneration;
    }

    get shuttingDown(): boolean {
        return this.stopped;
    }

    isCurrent(generation: number): boolean {
        return generation === this.currentGeneration;
    }

    register(id: symbol, invalidate: InvalidateInterception): void {
        this.active.set(id, invalidate);
    }

    unregister(id: symbol): void {
        this.active.delete(id);
    }

    reset(): void {
        this.invalidate(false);
    }

    shutdown(): boolean {
        if (this.stopped) return false;
        this.stopped = true;
        this.invalidate(true);
        return true;
    }

    private invalidate(abortHeldResponses: boolean): void {
        this.currentGeneration += 1;
        for (const invalidate of [...this.active.values()]) {
            invalidate(abortHeldResponses);
        }
    }
}
