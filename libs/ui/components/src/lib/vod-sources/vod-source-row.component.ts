import {
    ChangeDetectionStrategy,
    Component,
    computed,
    input,
    output,
} from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import { VodSourceDescriptor } from '@iptvnator/shared/interfaces';
import {
    buildVodSourceTags,
    sourceMonogram,
    sourceNeedsCheck,
} from './vod-source-tags';
import { playlistDisplayLabel } from '@iptvnator/shared/interfaces';

/**
 * One alternative source for the movie being viewed.
 *
 * Shared by the sources popover (details + player) and the playback error
 * screen. It renders only what the descriptor can prove: unknown metadata
 * produces no tag, just the actionable check chip.
 */
@Component({
    selector: 'app-vod-source-row',
    templateUrl: './vod-source-row.component.html',
    styleUrls: ['./vod-source-row.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [MatIcon, MatTooltip, TranslatePipe],
})
export class VodSourceRowComponent {
    readonly source = input.required<VodSourceDescriptor>();
    /** The error screen lists alternatives without offering the pin action. */
    readonly showPin = input(true);
    /**
     * Whether a stream is on screen right now. The active row is the one a
     * switch or Play would use, which is true from the moment the page opens —
     * so without this the badge claims "Playing" before anything has started
     * and again after the player is closed.
     */
    readonly playbackLive = input(false);

    readonly playRequested = output<string>();
    readonly pinRequested = output<string>();
    readonly checkRequested = output<string>();

    /**
     * Short, credential-safe label. Playlist names are routinely the pasted
     * URL, which carries `username=`/`password=` — never render that raw.
     */
    readonly displayLabel = computed(() =>
        playlistDisplayLabel(
            this.source().playlistName,
            this.source().playlistId
        )
    );

    // From the display label, not the raw name: every URL-named playlist would
    // otherwise monogram to "HT" (from "http://") and be indistinguishable.
    readonly monogram = computed(() => sourceMonogram(this.displayLabel()));
    readonly tags = computed(() => buildVodSourceTags(this.source()));
    readonly showCheckChip = computed(() => sourceNeedsCheck(this.source()));
    readonly pinLabelKey = computed(() =>
        this.source().isPinned
            ? 'PORTALS.MULTI_SOURCE.UNPIN_SOURCE'
            : 'PORTALS.MULTI_SOURCE.PIN_SOURCE'
    );

    onPlay(event: Event): void {
        event.stopPropagation();
        this.playRequested.emit(this.source().id);
    }

    onPin(event: Event): void {
        event.stopPropagation();
        this.pinRequested.emit(this.source().id);
    }

    onCheck(event: Event): void {
        event.stopPropagation();
        this.checkRequested.emit(this.source().id);
    }
}
