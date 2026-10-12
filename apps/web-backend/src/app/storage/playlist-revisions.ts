import { randomUUID } from 'node:crypto';

/**
 * ETags for playlist documents. The server is the only writer of its
 * database, so an in-memory counter per playlist is exact. The boot id
 * invalidates every client cache after a restart; the generation does so
 * after "delete all".
 */
export class PlaylistRevisions {
    private readonly revisions = new Map<string, number>();
    private generation = 0;

    constructor(private readonly bootId = randomUUID().slice(0, 8)) {}

    etag(playlistId: string): string {
        const revision = this.revisions.get(playlistId) ?? 0;
        return `"${this.bootId}.${this.generation}.${revision}"`;
    }

    bump(playlistId: string): string {
        this.revisions.set(
            playlistId,
            (this.revisions.get(playlistId) ?? 0) + 1
        );
        return this.etag(playlistId);
    }

    reset(): void {
        this.revisions.clear();
        this.generation += 1;
    }
}
