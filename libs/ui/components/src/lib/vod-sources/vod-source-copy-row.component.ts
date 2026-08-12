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
import { vodSourceLanguage } from './vod-source-filtering.util';
import { VodSourceTagListComponent } from './vod-source-tag-list.component';
import { buildVodSourceCopyTags } from './vod-source-tags';

/**
 * One copy inside an expanded "N copies in this playlist" group.
 *
 * Deliberately NOT the full source row: the parent row already names the
 * playlist, so repeating its monogram and label here would drown the only
 * thing that distinguishes copies — the provider's own stream title. The
 * title is the primary text, a parsed language prefix becomes a chip before
 * it, and the tag row carries only what DIFFERS from the parent's copy.
 */
@Component({
    selector: 'app-vod-source-copy-row',
    templateUrl: './vod-source-copy-row.component.html',
    styleUrls: ['./vod-source-copy-row.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [MatIcon, MatTooltip, TranslatePipe, VodSourceTagListComponent],
})
export class VodSourceCopyRowComponent {
    readonly source = input.required<VodSourceDescriptor>();
    /** The copy shown on the parent row — the baseline every diff is against. */
    readonly primary = input.required<VodSourceDescriptor>();
    /** See `VodSourceRowComponent.playbackLive`. */
    readonly playbackLive = input(false);

    readonly playRequested = output<string>();
    readonly checkRequested = output<string>();

    readonly language = computed(() => vodSourceLanguage(this.source()));

    readonly title = computed(
        () => this.source().rawTitle || `#${this.source().contentId}`
    );

    /**
     * The parent's own copy appears in the expanded list too, so the group
     * reads complete — but its tags would all be "no difference", which is
     * exactly what the muted "same as above" note says in two words.
     */
    readonly isPrimaryCopy = computed(
        () => this.source().id === this.primary().id
    );

    readonly tags = computed(() =>
        this.isPrimaryCopy()
            ? buildVodSourceCopyTags(this.source(), this.source()).filter(
                  (tag) => tag.id === 'probe'
              )
            : buildVodSourceCopyTags(this.source(), this.primary())
    );

    onPlay(event: Event): void {
        event.stopPropagation();
        this.playRequested.emit(this.source().id);
    }

    onCheck(event: Event): void {
        event.stopPropagation();
        this.checkRequested.emit(this.source().id);
    }
}
