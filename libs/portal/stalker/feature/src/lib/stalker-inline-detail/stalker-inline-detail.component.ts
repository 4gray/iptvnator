import {
    ChangeDetectionStrategy,
    Component,
    input,
    output,
} from '@angular/core';
import { StalkerSelectedVodItem } from '@iptvnator/portal/stalker/data-access';
import {
    type PlaybackFallbackRequest,
    VodDetailsComponent,
} from '@iptvnator/ui/playback';
import {
    ExternalPlayerSession,
    ResolvedPortalPlayback,
    VodDetailsItem,
} from '@iptvnator/shared/interfaces';
import { StalkerSeriesViewComponent } from '../stalker-series-view/stalker-series-view.component';

@Component({
    selector: 'app-stalker-inline-detail',
    imports: [StalkerSeriesViewComponent, VodDetailsComponent],
    templateUrl: './stalker-inline-detail.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
    styles: [
        `
            :host {
                display: block;
                height: 100%;
                width: 100%;
            }
        `,
    ],
})
export class StalkerInlineDetailComponent {
    readonly categoryId = input<'vod' | 'series' | null>(null);
    readonly seriesItem = input<StalkerSelectedVodItem | null>(null);
    readonly isSeries = input<boolean>(false);
    readonly vodDetailsItem = input<VodDetailsItem | null>(null);
    readonly isFavorite = input<boolean>(false);
    readonly playbackPosition = input<number | null>(null);
    readonly inlinePlayback = input<ResolvedPortalPlayback | null>(null);
    readonly externalPlayback = input<ExternalPlayerSession | null>(null);

    readonly backClicked = output<void>();
    readonly playClicked = output<VodDetailsItem>();
    readonly resumeClicked = output<{
        item: VodDetailsItem;
        positionSeconds: number;
    }>();
    readonly favoriteToggled = output<{
        item: VodDetailsItem;
        isFavorite: boolean;
    }>();
    readonly inlineTimeUpdated = output<{
        currentTime: number;
        duration: number;
    }>();
    readonly inlinePlaybackClosed = output<void>();
    readonly streamUrlCopied = output<void>();
    readonly inlineExternalFallbackRequested =
        output<PlaybackFallbackRequest>();

    onBackClicked() {
        this.backClicked.emit();
    }

    onPlayClicked(item: VodDetailsItem) {
        this.playClicked.emit(item);
    }

    onResumeClicked(event: {
        item: VodDetailsItem;
        positionSeconds: number;
    }) {
        this.resumeClicked.emit(event);
    }

    onFavoriteToggled(event: { item: VodDetailsItem; isFavorite: boolean }) {
        this.favoriteToggled.emit(event);
    }

    onInlineTimeUpdated(event: { currentTime: number; duration: number }) {
        this.inlineTimeUpdated.emit(event);
    }

    onInlinePlaybackClosed() {
        this.inlinePlaybackClosed.emit();
    }

    onStreamUrlCopied() {
        this.streamUrlCopied.emit();
    }

    onInlineExternalFallbackRequested(request: PlaybackFallbackRequest) {
        this.inlineExternalFallbackRequested.emit(request);
    }
}
