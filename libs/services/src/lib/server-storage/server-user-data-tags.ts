import type { ServerUserStateNamespace } from '@iptvnator/shared/interfaces';
import { idMap } from './server-user-data-entries';

/** The server version tag of each user-state entry, by namespace. */
export class UserStateTags {
    /** Absent for a namespace until the first read. */
    private readonly tags = new Map<
        ServerUserStateNamespace,
        Record<string, string>
    >();

    set(
        namespace: ServerUserStateNamespace,
        tags: Readonly<Record<string, string>>
    ): void {
        this.tags.set(namespace, idMap(tags));
    }

    /** `undefined` until the server's tags are known (or not offered). */
    of(
        namespace: ServerUserStateNamespace,
        playlistId: string
    ): string | null | undefined {
        const tags = this.tags.get(namespace);
        return tags ? (tags[playlistId] ?? null) : undefined;
    }

    /** `null`: the entry is gone. */
    update(
        namespace: ServerUserStateNamespace,
        playlistId: string,
        tag: string | null
    ): void {
        const tags = this.tags.get(namespace);
        if (!tags) {
            return;
        }
        if (tag === null) {
            delete tags[playlistId];
        } else {
            tags[playlistId] = tag;
        }
    }

    /** After a delete: one playlist's tags, without an id all of them. */
    forget(playlistId?: string): void {
        for (const [namespace, tags] of this.tags) {
            if (playlistId === undefined) {
                this.tags.set(namespace, {});
            } else {
                delete tags[playlistId];
            }
        }
    }
}
