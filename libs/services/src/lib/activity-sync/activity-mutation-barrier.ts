/** Keep opt-out behind local mutations already started by this renderer. */
export class ActivityMutationBarrier {
    private readonly pending = new Set<Promise<unknown>>();
    track<T>(operation: Promise<T>): Promise<T> {
        const tracked = operation.finally(() => this.pending.delete(tracked));
        this.pending.add(tracked);
        return tracked;
    }
    async drain(): Promise<void> {
        while (this.pending.size)
            await Promise.all(
                [...this.pending].map((operation) =>
                    operation.catch(() => undefined)
                )
            );
    }
}
