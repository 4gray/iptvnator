import type { UserDataStorage } from '../user-data-storage';
import { keepPages } from './server-page-pointer';
import {
    hasRecord,
    markClosed,
    markUnconfirmed,
    orphanedPages,
    othersUnconfirmed,
    pageIsLive,
} from './server-page-registry';
import type { DeferredEdit } from './server-user-data-edit';
import type { UserDataWriteQueue } from './server-user-data-queue';
import {
    removePage,
    saveDeferredEdits,
    saveUnsentWrites,
} from './server-unsent-writes';

/**
 * What `ServerUserDataStorage` keeps of its page load in `localStorage`:
 * the writes the server has not confirmed, the early edits and the
 * registry record that names them, so a reload or another tab can send
 * them. Copies of other page loads it took over go once its own is saved.
 */
export class PageJournal {
    private unsentSaved = false;
    /** A record stands for this page: a stale one is adopted elsewhere. */
    private recorded = false;
    /** Page loads taken over whose copy stays until this one saves. */
    private readonly retained = new Set<string>();

    constructor(
        private readonly local: UserDataStorage,
        private readonly instanceId: string,
        /** This page load: names its saved writes and its registry record. */
        private readonly tabId: string,
        /** The tab's own storage, where its page pointer lives. */
        private readonly tabStore: UserDataStorage,
        private readonly writes: UserDataWriteQueue,
        private readonly deferred: ReadonlyMap<string, DeferredEdit>
    ) {}

    /** The page unloads: a reload of this tab may take its writes over. */
    close(): void {
        markClosed(this.local, this.instanceId, this.tabId);
    }

    /** Whether another page load still runs (see `pageIsLive`). */
    isLive(page: string): boolean {
        return pageIsLive(this.local, this.instanceId, page);
    }

    /** Closed tabs' page loads, whose writes nobody sends (`orphanedPages`). */
    orphans(): string[] {
        return orphanedPages(this.local, this.instanceId, this.tabId);
    }

    /** Entry keys other live tabs have not had confirmed yet. */
    unconfirmedElsewhere(): Set<string> {
        return othersUnconfirmed(this.local, this.instanceId, this.tabId);
    }

    /**
     * Its record is gone: another tab took this page's writes over, so
     * nothing more of them goes out or is saved here.
     */
    superseded(): boolean {
        return (
            this.recorded && !hasRecord(this.local, this.instanceId, this.tabId)
        );
    }

    /**
     * Persists what the server has not confirmed; skips idle rewrites.
     * False when browser storage refused the copy.
     */
    saveUnsent(): boolean {
        if (this.superseded()) {
            return false;
        }
        // A newer edit can be queued while an older one is still travelling.
        const writes = this.writes.unsentWrites();
        if (writes.length === 0 && !this.unsentSaved) {
            return true;
        }
        const saved = saveUnsentWrites(
            this.local,
            this.instanceId,
            this.tabId,
            writes
        );
        this.unsentSaved = writes.length > 0 || !saved;
        this.publishUnconfirmed();
        if (saved && this.retained.size > 0 && this.saveDeferred()) {
            // This page's copy now stands for the ones it kept.
            for (const page of this.retained) {
                removePage(this.local, this.instanceId, page);
            }
            this.retained.clear();
            keepPages(this.tabStore, this.instanceId, this.tabId, []);
        }
        return saved;
    }

    /** Forgets another page load's copy, or keeps it until this one saves. */
    release(page: string, saved: boolean): void {
        if (saved) {
            removePage(this.local, this.instanceId, page);
        } else {
            this.retained.add(page);
            keepPages(this.tabStore, this.instanceId, this.tabId, [
                ...this.retained,
            ]);
        }
    }

    saveDeferred(): boolean {
        return saveDeferredEdits(this.local, this.instanceId, this.tabId, [
            ...this.deferred.values(),
        ]);
    }

    publishUnconfirmed(): void {
        // Superseded, it stays so: the record is not written again.
        this.recorded =
            this.superseded() ||
            markUnconfirmed(this.local, this.instanceId, this.tabId, [
                ...this.writes.unconfirmedKeys(),
                ...this.deferred.keys(),
            ]);
    }
}
