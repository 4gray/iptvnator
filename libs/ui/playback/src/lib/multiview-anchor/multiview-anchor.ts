import {
    DestroyRef,
    InjectionToken,
    type Provider,
    computed,
    effect,
    inject,
    signal,
    untracked,
} from '@angular/core';
import {
    MultiviewAnchorRegistry,
    type MultiviewAnchorHost,
    MultiviewEntryService,
    MultiviewSessionStore,
    supportsMultiview,
} from '@iptvnator/playback/multiview/data-access';
import type { PlayerMultiviewAction } from '../player-controls/player-multiview-action';

/**
 * A player view's part in multiview (spec 11.1.3, 11.3). The view creates
 * one with {@link injectMultiviewAnchor} and renders, in its player slot,
 *
 * ```html
 * @if (anchor.ownsSession()) {
 *     <app-multiview-anchor-placeholder [anchor]="anchor" />
 * } @else {
 *     <app-web-player-view appMultiviewPlayer … />
 * }
 * ```
 *
 * so without a session the slot renders exactly as before. While a session
 * belongs to the view, the multiview stage covers the placeholder and tile 1
 * plays the view's source (R1). A new selection in the view replaces the
 * active tile (R5). Leaving the view, or removing the placeholder, ends the
 * session (phase 1); when a session ends, the view adopts the surviving tile
 * (R7, R8, D2) before its player returns.
 */
export class MultiviewAnchor {
    private readonly store = inject(MultiviewSessionStore);
    private readonly entry = inject(MultiviewEntryService);
    private readonly element = signal<HTMLElement | null>(null);
    private playerElement: HTMLElement | null = null;
    /** Whether the running (or just ended) session belonged to this view. */
    private ownedSession = false;
    /** Position of the view's own player in its current source. */
    private position: { key: string; seconds: number } | null = null;
    /** Where the tile playing the view's own source last was. */
    private ownTile: { key: string; seconds: number } | null = null;
    private readonly resume = signal<{
        key: string;
        seconds: number;
        /** The view's playback when the session ended. */
        playback: unknown;
    } | null>(null);

    /**
     * R7: when the session ends and the view plays its own VOD source again,
     * the position its tile reached; null otherwise. Views pass it as their
     * player's start time.
     */
    readonly resumePosition = computed(() => {
        const resume = this.resume();
        const source = this.host.source();
        // A new start of the same title (Start over) replaces the playback
        // and is not a handback.
        return resume &&
            resume.key === source?.playbackSessionKey &&
            resume.playback === source.playback
            ? resume.seconds
            : null;
    });

    readonly ownsSession = computed(
        () =>
            this.store.exists() && this.store.anchorId() === this.host.anchorId
    );

    /** The dock's multiview action; null while no source picker exists. */
    readonly action: PlayerMultiviewAction | null = this.entry.hasPicker
        ? {
              enabled: computed(() => supportsMultiview(this.host.engine())),
              disabledReasonKey: 'PLAYER.MULTIVIEW.UNAVAILABLE_PLAYER',
              run: () => void this.entry.pick(),
          }
        : null;

    constructor(readonly host: MultiviewAnchorHost) {
        const unregister = inject(MultiviewAnchorRegistry).register({
            host,
            element: this.element.asReadonly(),
            position: () => this.currentPosition(),
            player: () => this.playerElement,
        });
        effect(() => {
            if (this.ownsSession()) this.ownedSession = true;
        });
        effect(() => this.trackOwnTile());
        effect(() => this.adoptSurvivor());
        effect(() => this.followSelection());
        inject(DestroyRef).onDestroy(() => {
            unregister();
            if (untracked(this.ownsSession)) this.store.end('anchor-left');
        });
    }

    /** Called by `appMultiviewPlayer` as the view's player advances. */
    notePosition(seconds: number): void {
        const key = untracked(this.host.source)?.playbackSessionKey;
        if (key && Number.isFinite(seconds)) this.position = { key, seconds };
    }

    /** The position, if it still belongs to the source the view plays. */
    private currentPosition(): number | null {
        const key = untracked(this.host.source)?.playbackSessionKey;
        return this.position && this.position.key === key
            ? this.position.seconds
            : null;
    }

    /** Called by `appMultiviewPlayer` for the player it marks. */
    attachPlayer(element: HTMLElement | null): void {
        this.playerElement = element;
    }

    /** Called by the placeholder once it is in the DOM. */
    attach(element: HTMLElement): void {
        this.element.set(element);
    }

    /** The placeholder left: without it the stage has nothing to cover. */
    detach(element: HTMLElement): void {
        if (this.element() !== element) return;
        this.element.set(null);
        if (untracked(this.ownsSession)) this.store.end('anchor-left');
    }

    /** Remembers the progress of the tile that plays the view's source. */
    private trackOwnTile(): void {
        const tiles = this.store.tiles();
        untracked(() => {
            if (!this.ownsSession()) return;
            const key = this.host.source()?.playbackSessionKey;
            const own = tiles.find((tile) => tile.playbackSessionKey === key);
            this.ownTile =
                own && key && own.kind !== 'live'
                    ? { key, seconds: own.lastPosition }
                    : null;
        });
    }

    /** R5: picking another source in the view replaces the active tile. */
    private followSelection(): void {
        const source = this.host.source();
        untracked(() => {
            const activeTileId = this.store.activeTileId();
            if (!source || !this.ownsSession() || !activeTileId) return;
            const active = this.store.tile(activeTileId);
            if (active?.playbackSessionKey !== source.playbackSessionKey) {
                this.store.replace(activeTileId, source);
            }
        });
    }

    /** R7/R8, D2: the surviving tile becomes the view's selection. */
    private adoptSurvivor(): void {
        const notice = this.store.notice();
        untracked(() => {
            if (!this.ownedSession || notice?.effect.type !== 'ended') return;
            this.ownedSession = false;
            this.resume.set(
                this.ownTile && {
                    ...this.ownTile,
                    playback: this.host.source()?.playback,
                }
            );
            this.ownTile = null;
            const survivor = notice.effect.survivor;
            if (
                survivor &&
                survivor.playbackSessionKey !==
                    this.host.source()?.playbackSessionKey &&
                this.host.adopt?.(survivor) !== true
            ) {
                // D2: the view cannot show it, so it opens in its own view.
                survivor.reopen?.();
            }
        });
    }
}

/**
 * Creates the view's multiview anchor. Call it in the view's constructor
 * or a field initializer: its effects run before the view's template is
 * checked, so a survivor is adopted before the player returns.
 */
export function injectMultiviewAnchor(
    host: MultiviewAnchorHost
): MultiviewAnchor {
    return new MultiviewAnchor(host);
}

/** The anchor of the enclosing player view, for `appMultiviewPlayer`. */
export const MULTIVIEW_ANCHOR = new InjectionToken<MultiviewAnchor>(
    'MULTIVIEW_ANCHOR'
);

/** Provides the view's anchor to the player's dock: `providers: [...]`. */
export function provideMultiviewAnchor(
    resolve: () => MultiviewAnchor
): Provider {
    return { provide: MULTIVIEW_ANCHOR, useFactory: resolve };
}
