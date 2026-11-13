import {
    ChangeDetectionStrategy,
    Component,
    DestroyRef,
    ElementRef,
    computed,
    effect,
    inject,
    input,
    linkedSignal,
    untracked,
} from '@angular/core';
import {
    MultiviewAnchorRegistry,
    MultiviewSessionStore,
} from '@iptvnator/playback/multiview/data-access';
import { PLAYER_MULTIVIEW_ACTION } from '@iptvnator/ui/playback';
import { stageMultiviewAction } from './multiview-stage-action';
import { MultiviewTileComponent } from './multiview-tile.component';
import { placeTiles, stableTileOrder, type TileBox } from './pip-geometry';
import { StageRectTracker } from './stage-rect-tracker';

const NO_BOX: TileBox = { left: 0, top: 0, width: 0, height: 0 };

/**
 * The multiview stage (spec 11.1.2). The workspace shell creates it once,
 * inside the content frame, the first time a session starts. While a
 * session runs it lies exactly over the anchor placeholder of the player
 * view that owns the session and renders one tile per session tile.
 */
@Component({
    selector: 'app-multiview-stage',
    templateUrl: './multiview-stage.component.html',
    styleUrl: './multiview-stage.component.scss',
    imports: [MultiviewTileComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    providers: [
        { provide: PLAYER_MULTIVIEW_ACTION, useFactory: stageMultiviewAction },
    ],
    host: {
        class: 'multiview-stage',
        '[attr.inert]': 'inert() ? "" : null',
        '[style.visibility]': 'rects() ? null : "hidden"',
        '[style.left.px]': 'rects()?.clip?.left',
        '[style.top.px]': 'rects()?.clip?.top',
        '[style.width.px]': 'rects()?.clip?.width',
        '[style.height.px]': 'rects()?.clip?.height',
    },
})
export class MultiviewStageComponent {
    /** The scroller whose visible area clips the stage. */
    readonly clipTo = input<HTMLElement | null>(null);
    /** Mirrors the content area becoming inert behind a drawer. */
    readonly inert = input(false);

    protected readonly store = inject(MultiviewSessionStore);
    private readonly anchors = inject(MultiviewAnchorRegistry);
    private readonly tracker = new StageRectTracker();
    readonly rects = this.tracker.rects;

    private readonly anchorElement = computed(() =>
        this.anchors.elementFor(this.store.anchorId())
    );
    readonly order = linkedSignal<readonly string[], readonly string[]>({
        source: () => this.store.tiles().map((tile) => tile.id),
        computation: (ids, previous) =>
            stableTileOrder(previous?.value ?? [], ids),
    });
    /**
     * Last known anchor box. A placeholder that is briefly re-created keeps
     * the tiles where they were instead of unmounting playing players.
     */
    readonly stageBox = linkedSignal<TileBox | null, TileBox>({
        source: () => this.rects()?.anchor ?? null,
        computation: (box, previous) => box ?? previous?.value ?? NO_BOX,
    });
    readonly placements = computed(() => {
        const state = this.store.state();
        return state ? placeTiles(this.stageBox(), state) : new Map();
    });

    constructor() {
        const host: HTMLElement = inject(ElementRef).nativeElement;
        effect(() => {
            const anchor = this.anchorElement();
            const clip = this.clipTo();
            untracked(() =>
                this.tracker.observe(anchor, clip, host.parentElement)
            );
        });
        inject(DestroyRef).onDestroy(() => this.tracker.disconnect());
    }

    tileById(id: string) {
        return this.store.tile(id);
    }
}
