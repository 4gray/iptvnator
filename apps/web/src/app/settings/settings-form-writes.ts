import type { Settings } from '@iptvnator/shared/interfaces';
import type { SettingsUpdateOptions } from '@iptvnator/services';
import { epgUrlsAddedOutside } from './settings-form-rebase';

type EpgUrls = readonly (string | null)[];

/** Tracks EPG and TMDB writes whose Save is still unacknowledged. */
export class SettingsFormWrites {
    private readonly pendingEpg = new Map<number, (string | null)[]>();
    private readonly pendingTmdb = new Map<number, string>();
    private persistedFormUrls?: EpgUrls;
    persistedTmdbKey?: string;
    submittedEpgUrls?: EpgUrls;

    prepare(
        revision: number,
        urls: EpgUrls | undefined,
        patch: Partial<Settings>,
        savedUrls: EpgUrls | undefined,
        storedUrls: Settings['epgUrl'],
        retryEpgCleanup: boolean
    ): [options: SettingsUpdateOptions, onPersisted?: () => void] {
        this.submittedEpgUrls = urls;
        let mergeEpgUrls:
            ((saved: Settings['epgUrl'] | undefined) => string[]) | undefined;
        if (patch.epgUrl) {
            const staged = [...patch.epgUrl];
            const known = this.knownUrls(savedUrls);
            mergeEpgUrls = (saved) => [
                ...staged,
                ...epgUrlsAddedOutside(staged, known, saved),
            ];
            patch.epgUrl = mergeEpgUrls(storedUrls);
            if (urls) this.pendingEpg.set(revision, [...urls]);
        }
        const apiKey = patch.tmdb?.apiKey;
        if (apiKey !== undefined) this.pendingTmdb.set(revision, apiKey);
        const options = {
            retryEpgCleanup,
            ...(mergeEpgUrls && { mergeEpgUrls }),
        };
        return patch.epgUrl || apiKey !== undefined
            ? [options, () => this.persist(revision)]
            : [options];
    }

    private persist(revision: number): void {
        const apiKey = this.pendingTmdb.get(revision);
        if (this.pendingTmdb.delete(revision)) this.persistedTmdbKey = apiKey;
        const urls = this.pendingEpg.get(revision);
        if (!urls) return;
        // The persisted patch can include sources the viewer has never seen.
        // Count the submitted URLs and sources shown by an intervening rebase.
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

    get pendingEpgSources(): EpgUrls | undefined {
        if (!this.pendingEpg.size) return undefined;
        const urls: (string | null)[] = [];
        for (const submitted of this.pendingEpg.values())
            urls.push(...submitted);
        return urls;
    }

    get persistedEpgSources(): EpgUrls | undefined {
        return this.persistedFormUrls;
    }

    canAdoptTmdbKey(key: string): boolean {
        return this.pendingTmdb.size === 0 && key !== this.persistedTmdbKey;
    }

    knownUrls(saved: readonly (string | null)[] | undefined): unknown[] {
        return [
            ...(this.persistedFormUrls ?? saved ?? []),
            ...(this.pendingEpgSources ?? []),
        ];
    }

    rebase(previous: EpgUrls | undefined, next: EpgUrls | undefined): void {
        const previouslyKnown = this.persistedFormUrls ?? previous;
        if (this.persistedFormUrls)
            this.persistedFormUrls = [
                ...this.persistedFormUrls,
                ...epgUrlsAddedOutside(previouslyKnown, [], next),
            ];
        for (const known of this.pendingEpg.values()) {
            known.push(...epgUrlsAddedOutside(previouslyKnown, known, next));
        }
        // A backup can see an optimistic list while a removal is still
        // pending. Keep its confirmed sources available if the write fails.
        if (!this.pendingEpg.size) this.persistedFormUrls = undefined;
    }

    clear(): void {
        this.pendingEpg.clear();
        this.pendingTmdb.clear();
        this.persistedTmdbKey = undefined;
        this.submittedEpgUrls = undefined;
        this.persistedFormUrls = undefined;
    }
}
