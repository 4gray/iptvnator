import {
    Injectable,
    computed,
    effect,
    inject,
    signal,
    untracked,
} from '@angular/core';
import { SettingsStore } from '@iptvnator/services';
import { VideoPlayer } from '@iptvnator/shared/interfaces';
import type {
    MultiviewEffect,
    MultiviewEndReason,
    MultiviewLayout,
    MultiviewPipGeometry,
    MultiviewSessionState,
    MultiviewTile,
    MultiviewTileSource,
    MultiviewTileStatus,
} from './multiview-session.model';
import type { MultiviewCommand } from './multiview-session.commands';
import { reduceMultiviewSession } from './multiview-session.reducer';
import {
    findTile,
    isTileHeldPaused,
    isTileMuted,
    tileForSessionKey,
    tileNumberOf,
} from './multiview-session.selectors';

/** Players a multiview session cannot run on (spec 5.2). */
const UNSUPPORTED_PLAYERS: ReadonlySet<VideoPlayer> = new Set([
    VideoPlayer.MPV,
    VideoPlayer.VLC,
    VideoPlayer.EmbeddedMpv,
]);

/** The latest effect; `sequence` lets a toast react to repeats. */
export interface MultiviewNotice {
    readonly sequence: number;
    readonly effect: MultiviewEffect;
}

/** Badge data for a channel row that is on screen (spec 9.4). */
export interface MultiviewTileBadge {
    readonly tileNumber: number;
    readonly hasAudio: boolean;
}

/** Whether the selected player can host a session (spec 5.2). */
export function supportsMultiview(player: VideoPlayer | null | undefined) {
    return !player || !UNSUPPORTED_PLAYERS.has(player);
}

/**
 * The one multiview session of the app. State changes go through the pure
 * reducer; this store only owns ids, signals and the reaction to a player
 * change in Settings. Hosts react to `notice` (toasts, adopting the
 * surviving tile) and keep saving VOD positions themselves (R9).
 */
@Injectable({ providedIn: 'root' })
export class MultiviewSessionStore {
    private readonly settings = inject(SettingsStore, { optional: true });
    private readonly session = signal<MultiviewSessionState | null>(null);
    private readonly lastNotice = signal<MultiviewNotice | null>(null);
    private tileSequence = 0;
    private noticeSequence = 0;

    readonly state = this.session.asReadonly();
    readonly notice = this.lastNotice.asReadonly();
    readonly exists = computed(() => this.session() !== null);
    readonly tiles = computed(() => this.session()?.tiles ?? []);
    readonly layout = computed(() => this.session()?.layout ?? null);
    readonly anchorId = computed(() => this.session()?.anchorId ?? null);
    readonly activeTileId = computed(
        () => this.session()?.activeTileId ?? null
    );
    readonly audioTileId = computed(() => this.session()?.audioTileId ?? null);
    readonly pipGeometry = computed(() => this.session()?.pip ?? null);
    /** No tile advances to the next episode on its own during a session (D11). */
    readonly autoplayNextEpisodeAllowed = computed(() => !this.exists());

    constructor() {
        effect(() => {
            const player = this.settings?.player?.();
            if (!supportsMultiview(player) && untracked(this.exists)) {
                untracked(() => this.end('player-unsupported'));
            }
        });
    }

    start(
        anchorId: string,
        primary: MultiviewTileSource,
        primaryEngine: VideoPlayer,
        added: MultiviewTileSource
    ): MultiviewEffect | null {
        return this.dispatch({
            type: 'start',
            anchorId,
            primary,
            primaryTileId: this.nextTileId(),
            primaryEngine,
            added,
            addedTileId: this.nextTileId(),
        });
    }

    add(source: MultiviewTileSource): MultiviewEffect | null {
        return this.dispatch({
            type: 'add',
            source,
            tileId: this.nextTileId(),
        });
    }

    replace(tileId: string, source: MultiviewTileSource) {
        return this.dispatch({ type: 'replace', tileId, source });
    }

    undoReplace(previous: MultiviewTile) {
        return this.dispatch({ type: 'undo-replace', previous });
    }

    remove(tileId: string) {
        return this.dispatch({ type: 'remove', tileId });
    }

    swap() {
        return this.dispatch({ type: 'swap' });
    }

    setAudio(tileId: string) {
        return this.dispatch({ type: 'set-audio', tileId });
    }

    setActive(tileId: string) {
        return this.dispatch({ type: 'set-active', tileId });
    }

    setLayout(layout: MultiviewLayout) {
        return this.dispatch({ type: 'set-layout', layout });
    }

    setPipGeometry(geometry: MultiviewPipGeometry) {
        return this.dispatch({ type: 'set-pip-geometry', geometry });
    }

    reportStatus(tileId: string, status: MultiviewTileStatus) {
        return this.dispatch({ type: 'tile-status', tileId, status });
    }

    reportPosition(tileId: string, seconds: number) {
        return this.dispatch({ type: 'tile-position', tileId, seconds });
    }

    /** Parental relock: drop tiles whose source is now withheld. */
    withhold(tileIds: readonly string[]) {
        return this.dispatch({ type: 'withhold', tileIds });
    }

    exit() {
        return this.dispatch({ type: 'exit' });
    }

    end(
        reason: Extract<
            MultiviewEndReason,
            'anchor-left' | 'player-unsupported'
        >
    ) {
        return this.dispatch({ type: 'end', reason });
    }

    tile(tileId: string): MultiviewTile | null {
        const state = this.session();
        return (state && findTile(state, tileId)) ?? null;
    }

    isMuted(tileId: string): boolean {
        const state = this.session();
        return state ? isTileMuted(state, tileId) : false;
    }

    isHeldPaused(tileId: string): boolean {
        const state = this.session();
        return state ? isTileHeldPaused(state, tileId) : false;
    }

    tileNumber(tileId: string): number | null {
        const state = this.session();
        return state ? tileNumberOf(state, tileId) : null;
    }

    /** Badge for a content identity on screen, or null (spec 9.4). */
    badgeFor(playbackSessionKey: string): MultiviewTileBadge | null {
        const state = this.session();
        const tile = state && tileForSessionKey(state, playbackSessionKey);
        if (!state || !tile) return null;
        return {
            tileNumber: tileNumberOf(state, tile.id) ?? 0,
            hasAudio: state.audioTileId === tile.id,
        };
    }

    private dispatch(command: MultiviewCommand): MultiviewEffect | null {
        const { state, effect } = reduceMultiviewSession(
            this.session(),
            command
        );
        this.session.set(state);
        if (effect) {
            this.lastNotice.set({ sequence: ++this.noticeSequence, effect });
        }
        return effect;
    }

    private nextTileId(): string {
        return `multiview-tile-${++this.tileSequence}`;
    }
}
