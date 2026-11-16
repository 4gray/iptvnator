/** Tracks the EPG lists submitted by this form until it adopts a store snapshot. */
export class SettingsFormEpgWrites {
    private readonly pending = new Map<number, string[]>();
    private persistedFormUrls?: string[];

    submit(revision: number, urls: string[]): void {
        this.pending.set(revision, urls);
    }

    persist(revision: number): void {
        const urls = this.pending.get(revision);
        if (!urls) return;
        // The persisted patch can also include outside sources that the
        // viewer has never seen. Only the form's own URLs become known.
        this.persistedFormUrls = urls;
        for (const pending of this.pending.keys()) {
            if (pending <= revision) this.pending.delete(pending);
        }
    }

    reject(revision: number): void {
        this.pending.delete(revision);
    }

    knownUrls(saved: readonly (string | null)[] | undefined): unknown[] {
        const urls = [...(this.persistedFormUrls ?? saved ?? [])];
        for (const submitted of this.pending.values()) urls.push(...submitted);
        return urls;
    }

    adoptStoreSnapshot(): void {
        this.persistedFormUrls = undefined;
    }

    clear(): void {
        this.pending.clear();
        this.adoptStoreSnapshot();
    }
}
