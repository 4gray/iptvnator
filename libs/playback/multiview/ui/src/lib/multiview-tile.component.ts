import {
    ChangeDetectionStrategy,
    Component,
    computed,
    inject,
    input,
    output,
    signal,
} from '@angular/core';
import {
    MultiviewEntryService,
    type MultiviewTile,
    MultiviewSessionStore,
} from '@iptvnator/playback/multiview/data-access';
import { injectTranslationTick } from '@iptvnator/services';
import type { PlaybackDiagnostic } from '@iptvnator/playback/util';
import { WebPlayerViewComponent } from '@iptvnator/ui/playback';
import { TranslateService } from '@ngx-translate/core';
import { acceptChannelDrops } from './multiview-channel-drop';
import { MultiviewPausedOverlayComponent } from './multiview-paused-overlay.component';
import { MultiviewTileChromeComponent } from './multiview-tile-chrome.component';
import {
    cornerAfterArrow,
    nearestCorner,
    PIP_KEYBOARD_RESIZE_STEP,
    resizedWidth,
} from './pip-drag';
import {
    PIP_MAX_WIDTH,
    PIP_MIN_WIDTH,
    type StageSize,
    type TilePlacement,
} from './pip-geometry';
import { trackPointer } from './pip-pointer';

/**
 * One tile of the stage: the regular web player view in multiview tile
 * mode, absolutely placed, with the PiP chrome and the held-VOD overlay on
 * top. Its instance lives as long as the tile, so swap and audio changes
 * only move and reconfigure it.
 */
@Component({
    selector: 'app-multiview-tile',
    templateUrl: './multiview-tile.component.html',
    styleUrl: './multiview-tile.component.scss',
    imports: [
        WebPlayerViewComponent,
        MultiviewPausedOverlayComponent,
        MultiviewTileChromeComponent,
    ],
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
        class: 'multiview-tile',
        role: 'region',
        '[attr.aria-label]': 'label()',
        '[class.multiview-tile--pip]': 'placement().role === "pip"',
        '[class.multiview-tile--moving]': 'moving()',
        '[attr.data-tile-id]': 'tile().id',
        '[attr.data-tile-role]': 'placement().role',
        '[style.left.px]': 'placement().box.left',
        '[style.top.px]': 'placement().box.top',
        '[style.width.px]': 'placement().box.width',
        '[style.height.px]': 'placement().box.height',
        '[style.transform]': 'transform()',
    },
})
export class MultiviewTileComponent {
    readonly tile = input.required<MultiviewTile>();
    readonly placement = input.required<TilePlacement>();
    /** Size of the area the tiles are laid out in. */
    readonly stage = input<StageSize>({ width: 0, height: 0 });
    /** The player's diagnostic; the stage draws the error card (9.6). */
    readonly diagnosticChanged = output<PlaybackDiagnostic | null>();

    protected readonly store = inject(MultiviewSessionStore);
    private readonly entry = inject(MultiviewEntryService);
    private readonly translate = inject(TranslateService);
    private readonly languageTick = injectTranslationTick();
    private readonly dragOffset = signal<{ x: number; y: number } | null>(null);
    readonly moving = signal(false);
    private reportedSecond = -1;

    readonly controlsMode = computed(() =>
        this.placement().role === 'main' ? 'full' : 'minimal'
    );
    readonly muted = computed(() => this.store.isMuted(this.tile().id));
    readonly paused = computed(() => this.store.isHeldPaused(this.tile().id));
    readonly hasAudio = computed(() => !this.muted());
    readonly tileNumber = computed(
        () => this.store.tileNumber(this.tile().id) ?? 0
    );
    /** Starts where the source was taken over; later positions do not remount. */
    readonly startTime = computed(() => this.tile().position ?? 0);
    readonly corner = computed(
        () => this.store.pipGeometry()?.corner ?? 'bottom-right'
    );
    readonly transform = computed(() => {
        const offset = this.dragOffset();
        return offset ? `translate(${offset.x}px, ${offset.y}px)` : null;
    });
    /** "Tile 2: Sport, muted" — the tile region's accessible name (spec 13). */
    readonly label = computed(() => {
        this.languageTick();
        const state =
            this.tile().status === 'error'
                ? 'PLAYER.MULTIVIEW.STATE_ERROR'
                : this.paused()
                  ? 'PLAYER.MULTIVIEW.STATE_PAUSED'
                  : this.hasAudio()
                    ? 'PLAYER.MULTIVIEW.STATE_SOUND'
                    : 'PLAYER.MULTIVIEW.STATE_MUTED';
        return `${this.translate.instant('PLAYER.MULTIVIEW.TILE_LABEL', {
            number: this.tileNumber(),
            title: this.tile().title,
        })}, ${this.translate.instant(state)}`;
    });

    constructor() {
        // R5: a channel dropped on a tile replaces that tile.
        acceptChannelDrops(
            (item) => void this.entry.replaceWithChannel(this.tile().id, item)
        );
    }

    onTimeUpdate(event: { currentTime: number; duration: number }): void {
        const tile = this.tile();
        // R9: progress is saved exactly as the source's own player saves it.
        tile.persistPosition?.(event);
        const second = Math.floor(event.currentTime);
        if (tile.kind === 'live' || second === this.reportedSecond) return;
        this.reportedSecond = second;
        this.store.reportPosition(tile.id, event.currentTime);
    }

    onAudioRequested(): void {
        this.store.setAudio(this.tile().id);
    }

    onPlaybackFailed(): void {
        this.store.reportStatus(this.tile().id, 'error');
    }

    onSwap(): void {
        this.store.swap();
    }

    onClose(): void {
        this.store.remove(this.tile().id);
    }

    /** L1: drag by the whole tile, then snap to the nearest corner. */
    onDragStart(event: PointerEvent): void {
        trackPointer(event, {
            move: (x, y) => {
                this.moving.set(true);
                this.dragOffset.set({ x, y });
            },
            end: (x, y, moved) => {
                this.moving.set(false);
                this.dragOffset.set(null);
                if (!moved) return;
                const box = this.placement().box;
                this.setGeometry(
                    nearestCorner(this.stage(), {
                        ...box,
                        left: box.left + x,
                        top: box.top + y,
                    }),
                    box.width
                );
            },
        });
    }

    /** L1: resize from the corner facing the stage centre. */
    onResizeStart(event: PointerEvent): void {
        const startWidth = this.placement().box.width;
        const corner = this.corner();
        trackPointer(event, {
            move: (x, y) => {
                this.moving.set(true);
                this.setGeometry(
                    corner,
                    resizedWidth(corner, startWidth, x, y)
                );
            },
            end: () => this.moving.set(false),
        });
    }

    /** Arrows move between corners, + and − resize, Enter swaps. */
    onKey(event: KeyboardEvent): void {
        if (event.target !== event.currentTarget) return;
        const width = this.placement().box.width;
        const corner = cornerAfterArrow(this.corner(), event.key);
        if (corner) {
            this.setGeometry(corner, width);
        } else if (event.key === '+' || event.key === '=') {
            this.setGeometry(this.corner(), width + PIP_KEYBOARD_RESIZE_STEP);
        } else if (event.key === '-') {
            this.setGeometry(this.corner(), width - PIP_KEYBOARD_RESIZE_STEP);
        } else if (event.key === 'Enter') {
            this.onSwap();
        } else {
            return;
        }
        event.preventDefault();
    }

    private setGeometry(
        corner: ReturnType<typeof nearestCorner>,
        width: number
    ): void {
        this.store.setPipGeometry({
            corner,
            width: Math.min(PIP_MAX_WIDTH, Math.max(PIP_MIN_WIDTH, width)),
        });
    }
}
