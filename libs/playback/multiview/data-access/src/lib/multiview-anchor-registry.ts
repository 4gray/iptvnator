import { Injectable, computed, signal, type Signal } from '@angular/core';
import type { VideoPlayer } from '@iptvnator/shared/interfaces';
import type {
    MultiviewTile,
    MultiviewTileSource,
} from './multiview-session.model';

/**
 * What a player view tells multiview about the stream it plays. Each of the
 * player views that host an anchor implements one (spec 11.2.4).
 */
export interface MultiviewAnchorHost {
    /** Stable per player view, e.g. `xtream-live`. */
    readonly anchorId: string;
    /** The playing source, with its VOD position; null while nothing plays. */
    readonly source: Signal<MultiviewTileSource | null>;
    /** Engine the view plays it with; tile 1 keeps it (R1). */
    readonly engine: Signal<VideoPlayer>;
    /**
     * Makes the tile that survives a session the view's own selection again
     * (R7, R8, D2). Returns false when the view cannot show it; the survivor
     * then reopens in its own view.
     */
    adopt?(tile: MultiviewTile): boolean;
}

export interface MultiviewAnchorRegistration {
    readonly host: MultiviewAnchorHost;
    /** Placeholder the stage covers; null while the view shows its player. */
    readonly element: Signal<HTMLElement | null>;
    /** Last playback position of the view's own player, in seconds. */
    readonly position?: () => number | null;
}

/**
 * Player views currently on screen that can take part in multiview. The
 * most recently mounted one is where a new session starts; the stage covers
 * the element of the anchor that owns the session.
 */
@Injectable({ providedIn: 'root' })
export class MultiviewAnchorRegistry {
    private readonly registrations = signal<
        readonly MultiviewAnchorRegistration[]
    >([]);

    readonly current = computed(() => {
        const list = this.registrations();
        return list[list.length - 1] ?? null;
    });

    register(registration: MultiviewAnchorRegistration): () => void {
        this.registrations.update((list) => [...list, registration]);
        return () =>
            this.registrations.update((list) =>
                list.filter((entry) => entry !== registration)
            );
    }

    find(anchorId: string | null): MultiviewAnchorRegistration | null {
        if (anchorId === null) return null;
        const list = this.registrations();
        for (let index = list.length - 1; index >= 0; index -= 1) {
            if (list[index].host.anchorId === anchorId) return list[index];
        }
        return null;
    }

    elementFor(anchorId: string | null): HTMLElement | null {
        return this.find(anchorId)?.element() ?? null;
    }
}
