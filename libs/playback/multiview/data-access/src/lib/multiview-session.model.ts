import type {
    ResolvedPortalPlayback,
    VideoPlayer,
} from '@iptvnator/shared/interfaces';

/** What a tile plays; decides whether it pauses without audio (R4). */
export type MultiviewTileKind = 'live' | 'vod' | 'episode';

/**
 * Engine-reported state of a tile. `paused` here means the viewer paused it;
 * a tile held paused by the session (R4) is reported by
 * `isTileHeldPaused`, not stored.
 */
export type MultiviewTileStatus =
    'loading' | 'playing' | 'paused' | 'stopped' | 'error';

/**
 * Every layout of the spec. Only those in `MULTIVIEW_AVAILABLE_LAYOUTS` can
 * be selected; the others arrive with phase 2.
 */
export type MultiviewLayout = 'pip' | 'split' | 'grid' | 'focus';

export type MultiviewPipCorner =
    'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

/** A source the user picked, before it becomes a tile. */
export interface MultiviewTileSource {
    readonly playback: ResolvedPortalPlayback;
    /** Identity of the content; two tiles never share one. */
    readonly playbackSessionKey: string;
    readonly kind: MultiviewTileKind;
    readonly playlistId: string;
    /** Provider id of the content, so a player view can select it again. */
    readonly contentId?: string;
    readonly title: string;
    /** Radio is audio-only and never becomes a tile (non-goal). */
    readonly radio?: boolean;
    /** VOD position to start from, in seconds. */
    readonly position?: number;
    /** The view player's volume, kept by tile 1 (0–1; default full). */
    readonly volume?: number;
    /**
     * Saves the tile's playback progress the way its single player would
     * (R9). Called on every time update of the tile.
     */
    readonly persistPosition?: (event: {
        readonly currentTime: number;
        readonly duration: number;
    }) => void;
    /**
     * Opens the source in its own view, for a survivor the anchor view
     * cannot show itself (D2). Sources picked from a list carry it.
     */
    readonly reopen?: () => void;
}

export interface MultiviewTile extends MultiviewTileSource {
    /** Stable for the tile's life; also its request-header owner. */
    readonly id: string;
    /** Tile 1 keeps the user's engine; added tiles use the HTML5 player. */
    readonly engine: VideoPlayer;
    readonly status: MultiviewTileStatus;
    /** Last reported VOD position in seconds; resume point (R4, R9). */
    readonly lastPosition: number;
}

export interface MultiviewPipGeometry {
    readonly corner: MultiviewPipCorner;
    /** Width in CSS pixels chosen by the user; null uses the default. */
    readonly width: number | null;
}

export interface MultiviewSessionState {
    /** Ordered tiles; the first one is the main tile. */
    readonly tiles: readonly MultiviewTile[];
    readonly layout: MultiviewLayout;
    /** Receives list clicks, shortcuts and the dock (R5, R13). */
    readonly activeTileId: string;
    /** The only unmuted tile (R2). */
    readonly audioTileId: string;
    /** Player view whose anchor the stage covers. */
    readonly anchorId: string;
    readonly pip: MultiviewPipGeometry;
}

export type MultiviewRejection =
    | 'no-session'
    | 'session-exists'
    | 'radio'
    | 'already-on-screen'
    | 'unknown-tile'
    | 'layout-unavailable'
    | 'not-swappable'
    | 'no-anchor'
    | 'unsupported-player';

/** Why a session ended; hosts decide what to do with the survivor. */
export type MultiviewEndReason =
    'last-tile' | 'exit' | 'withheld' | 'anchor-left' | 'player-unsupported';

export type MultiviewEffect =
    | { readonly type: 'rejected'; readonly reason: MultiviewRejection }
    | {
          readonly type: 'replaced';
          /** The tile as it was, for "Replaced tile N · Undo". */
          readonly previous: MultiviewTile;
          readonly tileNumber: number;
      }
    | {
          readonly type: 'ended';
          readonly reason: MultiviewEndReason;
          /** The tile that becomes the single player again, if any. */
          readonly survivor: MultiviewTile | null;
      };

export interface MultiviewReduction {
    readonly state: MultiviewSessionState | null;
    readonly effect: MultiviewEffect | null;
}
