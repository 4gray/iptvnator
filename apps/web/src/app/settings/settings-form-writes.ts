import type { Settings } from '@iptvnator/shared/interfaces';
import { epgUrlsAddedOutside } from './settings-form-rebase';

type EpgUrls = readonly (string | null)[];

/** Tracks EPG and TMDB writes whose Save is still unacknowledged. */
export class SettingsFormWrites {
    private readonly pendingEpg = new Map<number, EpgUrls>();
    private readonly pendingTmdb = new Map<number, string>();
    private persistedFormUrls?: EpgUrls;
    persistedTmdbKey?: string;
    submittedEpgUrls?: EpgUrls;

    prepare(
        revision: number,
        urls: EpgUrls | undefined,
        patch: Partial<Settings>,
        savedUrls: EpgUrls | undefined,
        storedUrls: Settings['epgUrl']
    ): { onPersisted?: () => void } {
        this.submittedEpgUrls = urls;
        if (patch.epgUrl) {
            const outside = epgUrlsAddedOutside(
                patch.epgUrl,
                this.knownUrls(savedUrls),
                storedUrls
            );
            patch.epgUrl = [...patch.epgUrl, ...outside];
            if (urls) this.pendingEpg.set(revision, urls);
        }
        const apiKey = patch.tmdb?.apiKey;
        if (apiKey !== undefined) this.pendingTmdb.set(revision, apiKey);
        return patch.epgUrl || apiKey !== undefined
            ? { onPersisted: () => this.persist(revision) }
            : {};
    }

    private persist(revision: number): void {
        const apiKey = this.pendingTmdb.get(revision);
        if (this.pendingTmdb.delete(revision)) this.persistedTmdbKey = apiKey;
        const urls = this.pendingEpg.get(revision);
        if (!urls) return;
        // The persisted patch can also include outside sources that the
        // viewer has never seen. Only the form's own URLs become known.
        this.persistedFormUrls = urls;
        for (const pending of this.pendingEpg.keys()) {
            if (pending <= revision) this.pendingEpg.delete(pending);
        }
    }

    /** True when the failed write attempted to persist a key. */
    reject(revision: number): boolean {
        this.pendingEpg.delete(revision);
        return this.pendingTmdb.delete(revision);
    }

    get hasUnsettledTmdbKey(): boolean {
        return this.persistedTmdbKey !== undefined || this.pendingTmdb.size > 0;
    }

    canAdoptTmdbKey(key: string): boolean {
        return this.pendingTmdb.size === 0 && key !== this.persistedTmdbKey;
    }

    knownUrls(saved: readonly (string | null)[] | undefined): unknown[] {
        const urls = [...(this.persistedFormUrls ?? saved ?? [])];
        for (const submitted of this.pendingEpg.values())
            urls.push(...submitted);
        return urls;
    }

    adoptStoreSnapshot(): void {
        this.persistedFormUrls = undefined;
    }

    clear(): void {
        this.pendingEpg.clear();
        this.pendingTmdb.clear();
        this.persistedTmdbKey = undefined;
        this.submittedEpgUrls = undefined;
        this.adoptStoreSnapshot();
    }
}
