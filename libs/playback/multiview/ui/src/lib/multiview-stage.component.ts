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
    signal,
    untracked,
} from '@angular/core';
import {
    MULTIVIEW_CONNECTION_BUDGET,
    MultiviewAnchorRegistry,
    type MultiviewConnectionBudget,
    MultiviewSessionStore,
} from '@iptvnator/playback/multiview/data-access';
import { injectTranslationTick } from '@iptvnator/services';
import type { PlaybackDiagnostic } from '@iptvnator/playback/util';
import { PLAYER_MULTIVIEW_ACTION } from '@iptvnator/ui/playback';
import { TranslateService } from '@ngx-translate/core';
import { MultiviewErrorCardComponent } from './multiview-error-card.component';
import { stageMultiviewAction } from './multiview-stage-action';
import { MultiviewTileComponent } from './multiview-tile.component';
import {
    placeTiles,
    stableTileOrder,
    type StageSize,
    type TileBox,
    type TilePlacement,
} from './pip-geometry';
import {
    MULTIVIEW_BAR_HEIGHT,
    MultiviewBarComponent,
} from './multiview-bar.component';
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
    imports: [
        MultiviewTileComponent,
        MultiviewBarComponent,
        MultiviewErrorCardComponent,
    ],
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
    private readonly translate = inject(TranslateService);
    private readonly languageTick = injectTranslationTick();
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
    /** The tiles share the stage with the bar underneath (spec 9.3). */
    readonly tileArea = computed<StageSize>(() => ({
        width: this.stageBox().width,
        height: Math.max(0, this.stageBox().height - MULTIVIEW_BAR_HEIGHT),
    }));
    readonly placements = computed(() => {
        const state = this.store.state();
        return state
            ? placeTiles(this.tileArea(), state)
            : new Map<string, TilePlacement>();
    });
    private readonly diagnostics = signal<
        ReadonlyMap<string, PlaybackDiagnostic>
    >(new Map());
    /** The failed small tile, if any, with what its player reported (9.6). */
    readonly failedPip = computed(() => {
        for (const [id, placement] of this.placements()) {
            const tile = this.store.tile(id);
            const diagnostic = this.diagnostics().get(id) ?? null;
            if (
                tile &&
                placement.role === 'pip' &&
                (tile.status === 'error' || diagnostic)
            ) {
                return { tile, box: placement.box, diagnostic };
            }
        }
        return null;
    });
    /** The failed tile's playlist budget, asked for once per failure. */
    readonly failedBudget = signal<MultiviewConnectionBudget | null>(null);
    private readonly budgets = inject(MULTIVIEW_CONNECTION_BUDGET, {
        optional: true,
    });
    readonly pipCorner = computed(
        () => this.store.pipGeometry()?.corner ?? 'bottom-right'
    );
    /** Announced when another tile becomes the main one (spec 13). */
    readonly announcement = computed(() => {
        this.languageTick();
        const main = this.store.tiles()[0];
        return main
            ? this.translate.instant('PLAYER.MULTIVIEW.MAIN_ANNOUNCEMENT', {
                  title: main.title,
              })
            : '';
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
        this.loadBudgetOfFailedTile();
    }

    tileById(id: string) {
        return this.store.tile(id);
    }

    /** Spec 12: a full playlist is named on the card instead of a guess. */
    private loadBudgetOfFailedTile(): void {
        let requested: string | null = null;
        effect(() => {
            const tile = this.failedPip()?.tile;
            const key = tile ? `${tile.id}|${tile.playbackSessionKey}` : null;
            if (key === requested) return;
            requested = key;
            untracked(() => {
                this.failedBudget.set(null);
                if (!tile || !this.budgets) return;
                this.budgets
                    .budgetFor(tile.playlistId)
                    .then((budget) => {
                        if (requested === key) this.failedBudget.set(budget);
                    })
                    .catch(() => undefined);
            });
        });
    }

    onDiagnostic(id: string, diagnostic: PlaybackDiagnostic | null): void {
        this.diagnostics.update((current) => {
            const next = new Map(current);
            if (diagnostic) next.set(id, diagnostic);
            else next.delete(id);
            return next;
        });
    }
}
