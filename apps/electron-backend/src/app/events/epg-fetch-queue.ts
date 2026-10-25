/** One import owns the SQLite writer slot through its worker's shutdown. */
export class EpgFetchQueue {
    private tail: Promise<void> | undefined;

    run(operation: () => Promise<void>): Promise<void> {
        // Start an idle queue immediately. Only admission waits here; callers
        // authorize local files first and retain their own generation fence.
        const result = this.tail ? this.tail.then(operation) : operation();
        const tail = result.then(
            () => undefined,
            () => undefined
        );
        this.tail = tail;
        void tail.then(() => {
            if (this.tail === tail) this.tail = undefined;
        });
        return result;
    }
}
