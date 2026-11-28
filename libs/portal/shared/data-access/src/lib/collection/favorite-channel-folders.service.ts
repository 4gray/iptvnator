import {
    computed,
    DestroyRef,
    inject,
    Injectable,
    Injector,
    signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
    RuntimeCapabilitiesService,
    USER_DATA_STORAGE,
    withIndexedDbExclusiveAccess,
} from '@iptvnator/services';
import {
    FavoriteChannelMembershipEvents,
    type ChangedFavoriteChannel,
} from '@iptvnator/services/favorites-events';
import { activePersonalScope } from '@iptvnator/services/profiles';
import { sourceProfileName } from '@iptvnator/services/source-sync/connection';
import { DEFAULT_PERSONAL_SCOPE } from '@iptvnator/shared/interfaces/profiles';
import { createRandomId } from '@iptvnator/shared/interfaces';
import {
    resolveStalkerProviderId,
    type UnifiedCollectionItem,
} from '@iptvnator/portal/shared/util';
import { UnifiedFavoritesDataService } from './unified-favorites-data.service';

export interface FavoriteChannelFolder {
    id: string;
    name: string;
}

interface FolderDocument {
    version: 1;
    folders: FavoriteChannelFolder[];
    assignments: Record<string, string>;
    // An interrupted provider write leaves the confirmed document intact.
    pendingAdd?: string;
}

const STORAGE_KEY = 'global-favorite-channel-folders-v1';
const EMPTY: FolderDocument = { version: 1, folders: [], assignments: {} };
type FolderChannel = Pick<
    UnifiedCollectionItem,
    | 'sourceType'
    | 'playlistId'
    | 'streamUrl'
    | 'xtreamId'
    | 'stalkerId'
    | 'stalkerItem'
    | 'radio'
> & { contentType?: UnifiedCollectionItem['contentType'] };

export class FavoriteFolderNameError extends Error {
    constructor(readonly reason: 'blank' | 'duplicate' | 'too-long') {
        super(reason);
    }
}

type Digest = (bytes: Uint8Array) => Uint8Array;

function channelReference(item: FolderChannel): string | null {
    if (!item.playlistId || (item.contentType && item.contentType !== 'live')) {
        return null;
    }
    switch (item.sourceType) {
        case 'm3u':
            return item.streamUrl?.trim() || null;
        case 'xtream':
            return item.xtreamId == null ? null : String(item.xtreamId);
        case 'stalker': {
            const id = item.stalkerItem
                ? resolveStalkerProviderId(item.stalkerItem)
                : String(item.stalkerId ?? '').trim();
            return id
                ? (item.radio === 'true' ? 'radio:' : 'live:') + id
                : null;
        }
    }
}

function channelKey(item: FolderChannel, digest: Digest): string | null {
    const reference = channelReference(item);
    if (reference === null) return null;
    // The M3U reference may include credentials in the playlist URL.
    const key =
        item.sourceType === 'm3u'
            ? Array.from(digest(new TextEncoder().encode(reference)), (byte) =>
                  byte.toString(16).padStart(2, '0')
              ).join('')
            : reference;
    return JSON.stringify([item.sourceType, item.playlistId, key]);
}
function parseDocument(raw: string | null): FolderDocument {
    if (raw === null) return EMPTY;
    const value = JSON.parse(raw) as FolderDocument | null;
    if (
        value?.version !== 1 ||
        !Array.isArray(value.folders) ||
        !value.folders.every(
            (folder) =>
                typeof folder?.id === 'string' &&
                typeof folder?.name === 'string'
        ) ||
        typeof value.assignments !== 'object' ||
        value.assignments === null ||
        Array.isArray(value.assignments) ||
        (value.pendingAdd !== undefined && typeof value.pendingAdd !== 'string')
    ) {
        throw new Error('Invalid favorite folders document');
    }
    return value;
}

function validateName(
    folders: readonly FavoriteChannelFolder[],
    name: string,
    exceptId?: string
): string {
    const trimmed = name.trim();
    if (!trimmed) throw new FavoriteFolderNameError('blank');
    if (trimmed.length > 100) throw new FavoriteFolderNameError('too-long');
    const normalized = trimmed.normalize().toLowerCase();
    if (
        folders.some(
            (folder) =>
                folder.id !== exceptId &&
                folder.name.normalize().toLowerCase() === normalized
        )
    ) {
        throw new FavoriteFolderNameError('duplicate');
    }
    return trimmed;
}

@Injectable({ providedIn: 'root' })
export class FavoriteChannelFoldersService {
    private readonly storage = inject(USER_DATA_STORAGE);
    private readonly injector = inject(Injector);
    private readonly native = inject(RuntimeCapabilitiesService)
        .supportsAppStateStorage
        ? window.electron
        : undefined;
    private readonly profile = sourceProfileName();
    /**
     * The Default profile keeps its historic key. Another profile has its own
     * document, empty until it files something: the household's folders and
     * assignments are never shown to it and never written by it.
     */
    private currentKey(): string {
        const scope = activePersonalScope();
        return scope === DEFAULT_PERSONAL_SCOPE
            ? STORAGE_KEY
            : `${STORAGE_KEY}:${scope}`;
    }

    /** The key under the source profile's namespace, as the app state and the locks see it. */
    private qualified(key: string): string {
        return this.profile === 'iptvnator' ? key : `${this.profile}:${key}`;
    }
    private readonly document = signal<FolderDocument>(EMPTY);
    private queue = Promise.resolve<unknown>(undefined);
    private initialLoad?: Promise<void>;
    private digest?: Digest;

    readonly folders = computed(() => this.document().folders);

    constructor() {
        const destroyRef = inject(DestroyRef);
        inject(FavoriteChannelMembershipEvents)
            .changed$.pipe(takeUntilDestroyed(destroyRef))
            .subscribe((item) => this.forgetAssignment(item));

        const onStorage = (event: StorageEvent) => {
            if (
                !this.native &&
                (event.key === this.qualified(this.currentKey()) ||
                    event.key === null)
            ) {
                void this.refresh();
            }
        };
        // The device moved to another profile: drop this one's folders now.
        const onSwitched = () => {
            this.document.set(EMPTY);
            this.initialLoad = undefined;
            void this.refresh();
        };
        window.addEventListener('storage', onStorage);
        window.addEventListener('iptvnator-profile-switched', onSwitched);
        destroyRef.onDestroy(() => {
            window.removeEventListener('storage', onStorage);
            window.removeEventListener(
                'iptvnator-profile-switched',
                onSwitched
            );
        });
    }

    private refresh(): Promise<void> {
        return this.enqueue(async () => {
            const key = this.currentKey();
            const document = await this.read(key);
            if (key === this.currentKey()) this.document.set(document);
        }).catch(() => undefined);
    }

    load(): Promise<void> {
        return (this.initialLoad ??= this.enqueue(async () => {
            const key = this.currentKey();
            const document = await this.read(key);
            if (key === this.currentKey()) this.document.set(document);
        }).catch((error) => {
            this.initialLoad = undefined;
            throw error;
        }));
    }

    canFile(item: FolderChannel): boolean {
        return channelReference(item) !== null;
    }

    folderOf(item: FolderChannel): string | null {
        const { folders, assignments } = this.document();
        if (!folders.length || !this.digest) return null;
        const key = channelKey(item, this.digest);
        const folder = key ? assignments[key] : null;
        return folder && folders.some(({ id }) => id === folder)
            ? folder
            : null;
    }

    hasAssignments(id: string): boolean {
        return Object.values(this.document().assignments).includes(id);
    }

    create(name: string): Promise<string> {
        return this.mutate(async (key) => {
            const current = await this.read(key);
            const id = createRandomId();
            const folder = { id, name: validateName(current.folders, name) };
            await this.commit(key, {
                ...current,
                folders: [...current.folders, folder],
            });
            return id;
        });
    }

    rename(id: string, name: string): Promise<void> {
        return this.mutate(async (key) => {
            const current = await this.read(key);
            this.requireFolder(current, id);
            const nextName = validateName(current.folders, name, id);
            await this.commit(key, {
                ...current,
                folders: current.folders.map((folder) =>
                    folder.id === id ? { id, name: nextName } : folder
                ),
            });
        });
    }

    remove(id: string): Promise<void> {
        return this.mutate(async (key) => {
            const current = await this.read(key);
            this.requireFolder(current, id);
            const assignments = { ...current.assignments };
            for (const [key, folder] of Object.entries(assignments)) {
                if (folder === id) delete assignments[key];
            }
            await this.commit(key, {
                ...current,
                folders: current.folders.filter((folder) => folder.id !== id),
                assignments,
            });
        });
    }

    move(
        items: readonly UnifiedCollectionItem[],
        destination: string | null | { name: string },
        options?: { add?: boolean }
    ): Promise<void> {
        return this.mutate(async (key) => {
            const digest = await this.prepareDigest();
            const keys = items.map((item) => channelKey(item, digest));
            if (
                !keys.length ||
                keys.some((key) => key === null) ||
                (options?.add && items.length !== 1)
            ) {
                throw new Error('Missing favorite channel identity');
            }

            const favorites = this.injector.get(UnifiedFavoritesDataService);
            const members = await this.membershipKeys(favorites, items, digest);
            const missing = keys.some(
                (key) => key !== null && !members.has(key)
            );
            if (missing && !options?.add) {
                throw new Error('A channel is no longer in favorites');
            }

            const current = await this.read(key);
            const folders = [...current.folders];
            let id: string | null;
            if (destination && typeof destination === 'object') {
                id = createRandomId();
                folders.push({
                    id,
                    name: validateName(folders, destination.name),
                });
            } else {
                id = destination;
                if (id) this.requireFolder(current, id);
            }
            const assignments = { ...current.assignments };
            for (const key of keys) {
                if (key === null) continue;
                if (id) assignments[key] = id;
                else delete assignments[key];
            }
            const next: FolderDocument = { version: 1, folders, assignments };

            if (missing) {
                // Check storage before adding membership. A pending marker
                // never makes the proposed folder or assignment visible.
                await this.write(key, {
                    ...current,
                    pendingAdd: keys[0] ?? undefined,
                });
                try {
                    await favorites.addFavorite(items[0]);
                } catch (error) {
                    await this.write(key, current).catch(() => undefined);
                    throw error;
                }
            }
            await this.commit(key, next);
        });
    }

    unfile(items: readonly FolderChannel[]): Promise<void> {
        return this.mutate(async (key) => {
            const current = await this.read(key);
            if (!current.pendingAdd && !Object.keys(current.assignments).length)
                return;
            const digest = await this.prepareDigest();
            const assignments = { ...current.assignments };
            let pendingAdd = current.pendingAdd;
            let changed = false;
            for (const item of items) {
                const key = channelKey(item, digest);
                if (!key) continue;
                if (key === pendingAdd) pendingAdd = undefined;
                if (assignments[key] !== undefined) {
                    delete assignments[key];
                    changed = true;
                }
            }
            if (changed || pendingAdd !== current.pendingAdd) {
                await this.commit(key, { ...current, assignments, pendingAdd });
            }
        });
    }

    private async membershipKeys(
        favorites: UnifiedFavoritesDataService,
        items: readonly UnifiedCollectionItem[],
        digest: Digest
    ): Promise<Set<string>> {
        const sources = new Map(
            items.map(({ sourceType, playlistId }) => [
                JSON.stringify([sourceType, playlistId]),
                { sourceType, playlistId },
            ])
        );
        const loaded = await Promise.all(
            Array.from(sources.values(), ({ playlistId, sourceType }) =>
                favorites.getPlaylistFavoritesForMembership(
                    playlistId,
                    sourceType
                )
            )
        );
        const keys = new Set<string>();
        for (const rows of loaded) {
            for (const item of rows) {
                const key = channelKey(item, digest);
                if (key) keys.add(key);
            }
        }
        return keys;
    }

    private forgetAssignment(item: ChangedFavoriteChannel): void {
        void this.unfile([item]).catch(() => undefined);
    }

    private requireFolder(document: FolderDocument, id: string): void {
        if (!document.folders.some((folder) => folder.id === id))
            throw new Error('Favorite folder no longer exists');
    }

    private mutate<T>(action: (key: string) => Promise<T>): Promise<T> {
        // One scope for the whole write, even if the device switches meanwhile.
        const key = this.currentKey();
        return this.enqueue(() => {
            const lockName = this.qualified(key);
            const run = () => action(key);
            const locks = navigator.locks;
            if (locks) return locks.request(lockName, run);
            if (this.native) return run();
            return withIndexedDbExclusiveAccess(
                `iptvnator-favorite-folders:${lockName}`,
                run
            );
        });
    }

    private enqueue<T>(action: () => Promise<T>): Promise<T> {
        const operation = this.queue.then(action);
        this.queue = operation.catch(() => undefined);
        return operation;
    }

    private async read(key: string): Promise<FolderDocument> {
        const raw = this.native
            ? await this.native.dbGetAppState(this.qualified(key))
            : this.storage.getItem(key);
        const document = parseDocument(raw);
        if (document.folders.length) await this.prepareDigest();
        return document;
    }

    private async prepareDigest(): Promise<Digest> {
        return (this.digest ??= (await import('@noble/hashes/sha2.js')).sha256);
    }

    private async write(key: string, document: FolderDocument): Promise<void> {
        const serialized = JSON.stringify(document);
        if (this.native) {
            const result = await this.native.dbSetAppState(
                this.qualified(key),
                serialized
            );
            if (!result.success)
                throw new Error('Favorite folders could not be saved');
        } else {
            this.storage.setItem(key, serialized);
        }
    }

    private async commit(key: string, document: FolderDocument): Promise<void> {
        await this.write(key, document);
        if (key === this.currentKey()) this.document.set(document);
    }
}
