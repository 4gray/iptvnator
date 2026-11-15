/** Per-helper acknowledgements: queue acceptance is not native completion. */
export class EmbeddedMpvCommandAck {
    private nextId = 0;
    private pending = new Map<
        string,
        { resolve(): void; reject(error: Error): void }
    >();

    send(write: (requestId: string) => void): Promise<void> {
        const id = String(++this.nextId);
        return new Promise((resolve, reject) => {
            const timer = setTimeout(
                () => finish(new Error('MPV command timed out')),
                3000
            );
            const finish = (error?: Error) => {
                clearTimeout(timer);
                this.pending.delete(id);
                if (error) reject(error);
                else resolve();
            };
            this.pending.set(id, { resolve: () => finish(), reject: finish });
            try {
                write(id);
            } catch {
                finish(new Error('MPV command failed'));
            }
        });
    }

    accept(event: {
        event?: string;
        requestId?: string;
        success?: boolean;
    }): boolean {
        if (event.event !== 'command-result') return false;
        const pending = this.pending.get(event.requestId ?? '');
        if (event.success === true) pending?.resolve();
        else pending?.reject(new Error('MPV command rejected'));
        return true;
    }

    close(): void {
        for (const pending of this.pending.values()) {
            pending.reject(new Error('MPV session closed'));
        }
    }
}
