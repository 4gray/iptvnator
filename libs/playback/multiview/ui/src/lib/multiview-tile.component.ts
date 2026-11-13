import {
    ChangeDetectionStrategy,
    Component,
    computed,
    inject,
    input,
} from '@angular/core';
import {
    type MultiviewTile,
    MultiviewSessionStore,
} from '@iptvnator/playback/multiview/data-access';
import { WebPlayerViewComponent } from '@iptvnator/ui/playback';
import type { TilePlacement } from './pip-geometry';

/**
 * One tile of the stage: the regular web player view in multiview tile
 * mode, absolutely placed. Its instance lives as long as the tile, so swap
 * and audio changes only move and reconfigure it.
 */
@Component({
    selector: 'app-multiview-tile',
    templateUrl: './multiview-tile.component.html',
    styleUrl: './multiview-tile.component.scss',
    imports: [WebPlayerViewComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
        class: 'multiview-tile',
        '[class.multiview-tile--pip]': 'placement().role === "pip"',
        '[attr.data-tile-id]': 'tile().id',
        '[attr.data-tile-role]': 'placement().role',
        '[style.left.px]': 'placement().box.left',
        '[style.top.px]': 'placement().box.top',
        '[style.width.px]': 'placement().box.width',
        '[style.height.px]': 'placement().box.height',
    },
})
export class MultiviewTileComponent {
    readonly tile = input.required<MultiviewTile>();
    readonly placement = input.required<TilePlacement>();

    protected readonly store = inject(MultiviewSessionStore);
    readonly controlsMode = computed(() =>
        this.placement().role === 'main' ? 'full' : 'minimal'
    );
    readonly muted = computed(() => this.store.isMuted(this.tile().id));
    readonly paused = computed(() => this.store.isHeldPaused(this.tile().id));
    /** Starts where the source was taken over; later positions do not remount. */
    readonly startTime = computed(() => this.tile().position ?? 0);
    private reportedSecond = -1;

    onTimeUpdate(event: { currentTime: number }): void {
        const tile = this.tile();
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
}
