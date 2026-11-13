import {
    type ComponentRef,
    DestroyRef,
    Directive,
    type OnInit,
    type EmbeddedViewRef,
    TemplateRef,
    ViewContainerRef,
    computed,
    effect,
    inject,
    input,
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
import {
    PLAYER_MULTIVIEW_ACTION,
    type PlayerMultiviewAction,
} from '../player-controls/player-multiview-action';
import { MultiviewAnchorPlaceholderComponent } from './multiview-anchor-placeholder.component';

/**
 * Marks the player slot of a player view as a multiview anchor
 * (spec 11.1.3): `<app-web-player-view *appMultiviewAnchor="host" … />`.
 *
 * Without a session owned by this view it renders its template unchanged.
 * Once a session starts here, the view's own player is replaced by a black
 * placeholder that the multiview stage covers with the tiles; tile 1 takes
 * over the same playback (R1, 11.3). A new selection in the view replaces
 * the active tile (R5). Leaving the view ends the session (phase 1); when a
 * session ends, the view's player returns and adopts the surviving tile.
 *
 * It also offers the dock's multiview action to the player it wraps.
 */
@Directive({
    selector: '[appMultiviewAnchor]',
    providers: [
        {
            provide: PLAYER_MULTIVIEW_ACTION,
            useFactory: () => inject(MultiviewAnchorDirective).action,
        },
    ],
})
export class MultiviewAnchorDirective implements OnInit {
    readonly host = input.required<MultiviewAnchorHost>({
        alias: 'appMultiviewAnchor',
    });

    private readonly store = inject(MultiviewSessionStore);
    private readonly entry = inject(MultiviewEntryService);
    private readonly template = inject(TemplateRef<unknown>);
    private readonly container = inject(ViewContainerRef);
    private readonly placeholder = signal<HTMLElement | null>(null);
    private playerView: EmbeddedViewRef<unknown> | null = null;
    private placeholderRef: ComponentRef<unknown> | null = null;
    /** Whether the running (or just ended) session belonged to this view. */
    private ownedSession = false;

    /** Whether the running session covers this view. */
    readonly ownsSession = computed(
        () =>
            this.store.exists() &&
            this.store.anchorId() === this.host().anchorId
    );

    readonly action: PlayerMultiviewAction | null = this.entry.hasPicker
        ? {
              enabled: computed(() => supportsMultiview(this.host().engine())),
              disabledReasonKey: 'PLAYER.MULTIVIEW.UNAVAILABLE_PLAYER',
              run: () => void this.entry.pick(),
          }
        : null;

    constructor() {
        const anchors = inject(MultiviewAnchorRegistry);
        effect((onCleanup) => {
            const host = this.host();
            onCleanup(
                untracked(() =>
                    anchors.register({ host, element: this.placeholder })
                )
            );
        });
        // Adopt before the player returns, so it does not flash the old source.
        effect(() => this.adoptSurvivor());
        effect(() => {
            const owns = this.ownsSession();
            untracked(() => this.render(owns));
        });
        effect(() => this.followSelection());
        inject(DestroyRef).onDestroy(() => {
            if (untracked(this.ownsSession)) this.store.end('anchor-left');
        });
    }

    /** Renders like `@if` does, in the same check, so nothing waits a tick. */
    ngOnInit(): void {
        this.render(this.ownsSession());
    }

    private render(ownsSession: boolean): void {
        if (ownsSession) this.showPlaceholder();
        else this.showPlayer();
    }

    /** R5: picking another source in this view replaces the active tile. */
    private followSelection(): void {
        const source = this.host().source();
        untracked(() => {
            const activeTileId = this.store.activeTileId();
            if (!source || !this.ownsSession() || !activeTileId) return;
            const active = this.store.tile(activeTileId);
            if (active?.playbackSessionKey !== source.playbackSessionKey) {
                this.store.replace(activeTileId, source);
            }
        });
    }

    /** R7/R8: the surviving tile becomes the view's selection (D2). */
    private adoptSurvivor(): void {
        const notice = this.store.notice();
        untracked(() => {
            if (!this.ownedSession || notice?.effect.type !== 'ended') return;
            this.ownedSession = false;
            const survivor = notice.effect.survivor;
            const host = this.host();
            if (
                survivor &&
                survivor.playbackSessionKey !==
                    host.source()?.playbackSessionKey
            ) {
                host.adopt?.(survivor);
            }
        });
    }

    private showPlaceholder(): void {
        this.ownedSession = true;
        if (this.placeholderRef) return;
        this.container.clear();
        this.playerView = null;
        this.placeholderRef = this.container.createComponent(
            MultiviewAnchorPlaceholderComponent
        );
        this.placeholder.set(this.placeholderRef.location.nativeElement);
    }

    private showPlayer(): void {
        if (this.playerView) return;
        this.container.clear();
        this.placeholderRef = null;
        this.placeholder.set(null);
        this.playerView = this.container.createEmbeddedView(this.template);
    }
}
