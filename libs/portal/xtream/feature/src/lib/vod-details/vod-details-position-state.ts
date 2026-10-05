import { computed, signal } from '@angular/core';
import type {
    PlaybackPositionData,
    PlayerContentInfo,
} from '@iptvnator/shared/interfaces';
import { ownsContent } from './vod-details-external-session';
import { isResumablePosition } from './vod-primary-action-position';

/** The copies the page's position state belongs to. */
export interface VodDetailsPositionRoute {
    readonly playlistId: () => string | undefined;
    readonly contentId: () => number | undefined;
    /** The alternative currently in use, if it is not the route's own. */
    readonly alternative: () => PlayerContentInfo | null;
}

/**
 * Stored playback positions of the VOD details page: the last one seen, the
 * route copy's own row, and the guarded read that fills both.
 */
export class VodDetailsPositionState {
    private loadGeneration = 0;
    private destroyed = false;

    /**
     * The LAST position seen, whichever copy produced it.
     *
     * Multi-source can put playback on a copy in another playlist, and this
     * follows it — the progress bar and the switch feed both want the stream
     * on screen, not the one the route happens to address.
     */
    readonly last = signal<PlaybackPositionData | null>(null);

    /**
     * The ROUTE copy's own row.
     *
     * Everything that acts on the route's stream — Resume, its label, its
     * timecode — has to read this instead. Positions are keyed by (playlist,
     * stream), so once an alternative has played, `last` names a different
     * film's row entirely and resuming from it would jump the route copy to
     * a timecode nobody reached in it.
     */
    readonly route = signal<PlaybackPositionData | null>(null);

    /** Whether the ROUTE copy has somewhere to resume from. */
    readonly hasResumable = computed(() => isResumablePosition(this.route()));

    /** The route copy's row is in hand; fails closed while a read is in flight. */
    readonly loaded = signal(false);

    constructor(private readonly routeCopy: VodDetailsPositionRoute) {}

    /** Mirrors an incoming position into the route's row when it owns it. */
    track(position: PlaybackPositionData | null): void {
        this.last.set(position);
        if (this.isRouteContent(position)) {
            this.route.set(position);
        }
    }

    /**
     * Takes a streamed position when the page owns its content. An external
     * player on an ALTERNATIVE reports under that playlist's ids; dropping
     * those rewinds a switch.
     */
    trackOwned(position: PlaybackPositionData): void {
        const owned = {
            routePlaylistId: this.routeCopy.playlistId(),
            routeContentId: this.routeCopy.contentId(),
            alternative: this.routeCopy.alternative(),
        };
        if (ownsContent(position, owned)) {
            this.track(position);
        }
    }

    /**
     * Retires every stored-position read still in flight. A row written
     * since (the manual watched toggle) must not be overwritten by the older
     * answer that read started from.
     */
    discardPendingLoads(): void {
        this.loadGeneration++;
    }

    /** The page is gone: no read still in flight may land. */
    destroy(): void {
        this.destroyed = true;
        this.loadGeneration++;
    }

    async load(
        playlistId: string,
        vodId: number,
        read: () => Promise<PlaybackPositionData | null>
    ): Promise<void> {
        const generation = ++this.loadGeneration;
        this.loaded.set(false);
        const position = await read();
        if (
            this.destroyed ||
            generation !== this.loadGeneration ||
            this.routeCopy.playlistId() !== playlistId ||
            this.routeCopy.contentId() !== vodId
        ) {
            return;
        }

        this.last.set(position);
        this.route.set(position);
        this.loaded.set(true);
    }

    private isRouteContent(position: PlaybackPositionData | null): boolean {
        return (
            !!position &&
            position.playlistId === this.routeCopy.playlistId() &&
            position.contentXtreamId === this.routeCopy.contentId()
        );
    }
}
