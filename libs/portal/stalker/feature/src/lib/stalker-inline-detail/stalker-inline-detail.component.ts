import {
    ChangeDetectionStrategy,
    Component,
    Injector,
    inject,
    input,
    output,
} from '@angular/core';
import {
    StalkerSelectedVodItem,
    StalkerStore,
} from '@iptvnator/portal/stalker/data-access';
import type { StalkerSimilarOrigin } from '@iptvnator/portal/shared/util';
import {
    type PlaybackFallbackRequest,
    VodDetailsComponent,
} from '@iptvnator/ui/playback';
import {
    ExternalPlayerName,
    ExternalPlayerSession,
    ResolvedPortalPlayback,
    VodDetailsItem,
} from '@iptvnator/shared/interfaces';
import { StalkerSeriesViewComponent } from '../stalker-series-view/stalker-series-view.component';
import {
    STALKER_DETAIL_SIMILAR_PROVIDERS,
    StalkerDetailSimilar,
} from '../stalker-detail-similar';

@Component({
    selector: 'app-stalker-inline-detail',
    imports: [StalkerSeriesViewComponent, VodDetailsComponent],
    providers: STALKER_DETAIL_SIMILAR_PROVIDERS,
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
    readonly playbackSessionKey = input.required<string>();
    readonly categoryId = input<'vod' | 'series' | null>(null);
    readonly seriesItem = input<StalkerSelectedVodItem | null>(null);
    readonly isSeries = input<boolean>(false);
    readonly vodDetailsItem = input<VodDetailsItem | null>(null);
    readonly isFavorite = input<boolean>(false);
    readonly playbackPosition = input<number | null>(null);
    readonly playbackDurationSeconds = input<number | null>(null);
    readonly sourceLabel = input<string | null>(null);
    readonly inlinePlayback = input<ResolvedPortalPlayback | null>(null);
    readonly externalPlayback = input<ExternalPlayerSession | null>(null);
    readonly providerOnly = input(false);
    readonly isWatched = input(false);
    readonly watchedToggleBusy = input(false);
    readonly watchedToggleReady = input(true);
    readonly playbackStartPending = input(false);
    readonly similarSearchReturn = input<
        (() => StalkerSimilarOrigin['search']) | null
    >(null);

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
    readonly watchedToggled = output<{
        item: VodDetailsItem;
        watched: boolean;
    }>();
    readonly inlineTimeUpdated = output<{
        currentTime: number;
        duration: number;
    }>();
    readonly inlinePlaybackClosed = output<void>();
    readonly streamUrlCopied = output<void>();
    readonly inlineExternalFallbackRequested =
        output<PlaybackFallbackRequest>();
    readonly externalPlayRequested = output<{
        item: VodDetailsItem;
        player: ExternalPlayerName;
        positionSeconds: number | null;
    }>();
    readonly resetProgressRequested = output<VodDetailsItem>();

    constructor() {
        const injector = inject(Injector);
        inject(StalkerDetailSimilar).bind({
            item: () => {
                const vod = this.vodDetailsItem();
                return (
                    this.seriesItem() ??
                    (vod?.type === 'stalker' ? vod.data : null)
                );
            },
            catalog: this.categoryId,
            playlistId: () =>
                this.vodDetailsItem()?.playlistId ??
                injector.get(StalkerStore).currentPlaylist()?._id,
            enabled: () => !this.providerOnly(),
            origin: (item) => {
                const search = this.similarSearchReturn()?.();
                return search ? { ...item, search } : null;
            },
        });
    }

    onBackClicked() {
        this.backClicked.emit();
    }

    onPlayClicked(item: VodDetailsItem) {
        this.playClicked.emit(item);
    }

    onResumeClicked(event: { item: VodDetailsItem; positionSeconds: number }) {
        this.resumeClicked.emit(event);
    }

    onFavoriteToggled(event: { item: VodDetailsItem; isFavorite: boolean }) {
        this.favoriteToggled.emit(event);
    }

    onWatchedToggled(event: { item: VodDetailsItem; watched: boolean }) {
        this.watchedToggled.emit(event);
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
