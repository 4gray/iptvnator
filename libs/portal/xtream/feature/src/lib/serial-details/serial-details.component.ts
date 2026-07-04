import { Location, SlicePipe } from '@angular/common';
import {
    Component,
    computed,
    effect,
    inject,
    OnDestroy,
    OnInit,
    signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatIcon } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
    DetailActionsTemplateDirective,
    DetailMetaTemplateDirective,
    DetailTagsTemplateDirective,
    PortalDetailShellComponent,
    SeasonContainerComponent,
    SeasonContainerPlaybackToggleRequest,
    SeasonContainerXtreamDownloadContext,
} from '@iptvnator/ui/components';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';
import {
    type PlaybackFallbackRequest,
    PortalInlinePlayerComponent,
} from '@iptvnator/ui/playback';
import {
    TmdbEnrichedCastMember,
    XtreamSerieInfo,
    XtreamSerieEpisode,
    XtreamSerieDetails,
} from '@iptvnator/shared/interfaces';
import {
    SerialDetailsPlaybackService,
    type XtreamSerieDetailsView,
} from './serial-details-playback.service';
import {
    SimilarCatalogItem,
    matchRecommendationsToCatalog,
} from '../tmdb-similar.util';

@Component({
    selector: 'app-serial-details',
    templateUrl: './serial-details.component.html',
    styleUrls: [
        '../../../../../../ui/components/src/lib/styles/detail-view.scss',
    ],
    styles: [
        `
            :host {
                display: block;
                width: 100%;
                height: 100%;
                min-height: 0;
            }
        `,
    ],
    providers: [SerialDetailsPlaybackService],
    imports: [
        DetailActionsTemplateDirective,
        DetailMetaTemplateDirective,
        DetailTagsTemplateDirective,
        MatIcon,
        PortalDetailShellComponent,
        PortalInlinePlayerComponent,
        SeasonContainerComponent,
        SlicePipe,
        TranslatePipe,
    ],
})
export class SerialDetailsComponent implements OnInit, OnDestroy {
    private readonly location = inject(Location);
    private readonly route = inject(ActivatedRoute);
    private readonly router = inject(Router);
    private readonly xtreamStore = inject(XtreamStore);
    private readonly playback = inject(SerialDetailsPlaybackService);
    private readonly snackBar = inject(MatSnackBar);
    private readonly translateService = inject(TranslateService);

    readonly selectedItem = signal<XtreamSerieDetailsView | null>(null);
    readonly selectedContentType = this.xtreamStore.selectedContentType;
    readonly isFavorite = this.xtreamStore.isFavorite;
    readonly isLoadingDetails = this.xtreamStore.isLoadingDetails;
    readonly detailsError = this.xtreamStore.detailsError;
    readonly currentPlaylistId = signal('');
    readonly xtreamDownloadContext =
        signal<SeasonContainerXtreamDownloadContext | null>(null);
    /** `playlistId:categoryId:serialId` of the last initialized view */
    private readonly lastInitKey = signal<string | null>(null);
    private readonly backdropBackfillKey = signal<string | null>(null);

    /**
     * Reactive route params: the component is reused when navigating
     * between two series details (e.g. via the Similar rail).
     */
    private readonly routeParams = toSignal(this.route.params, {
        initialValue: this.route.snapshot.params,
    });

    // Episode playback state, re-exposed for the template.
    readonly inlinePlayback = this.playback.inlinePlayback;
    readonly episodePlaybackPositions = this.playback.episodePlaybackPositions;
    readonly openingEpisodeId = this.playback.openingEpisodeId;
    readonly activeEpisodeId = this.playback.activeEpisodeId;
    readonly quickStartAction = this.playback.quickStartAction;
    readonly inlineEpisodeMetadata = this.playback.inlineEpisodeMetadata;
    readonly inlineSeriesNavigation = this.playback.inlineSeriesNavigation;

    /** Season overviews from get_series_info, keyed by season key. */
    readonly seasonDescriptions = computed<Record<string, string>>(() => {
        const descriptions: Record<string, string> = {};
        for (const season of this.selectedItem()?.seasons ?? []) {
            if (season?.overview && season.season_number !== undefined) {
                descriptions[String(season.season_number)] = season.overview;
            }
        }
        return descriptions;
    });

    /** TMDB recommendations matched against the loaded series catalog */
    readonly similarItems = computed<SimilarCatalogItem[]>(() => {
        const item = this.selectedItem();
        const recommendations = item?.info?.tmdb_recommendations;
        if (!recommendations?.length) {
            return [];
        }
        return matchRecommendationsToCatalog(
            recommendations,
            this.xtreamStore.serialStreams(),
            { excludeId: Number(item?.series_id) }
        );
    });

    constructor() {
        this.playback.bind({ selectedItem: this.selectedItem });

        effect(() => {
            const item = this.xtreamStore.selectedItem() as unknown as
                | (XtreamSerieDetails & {
                      readonly series_id?: string | number;
                  })
                | null;
            this.selectedItem.set(
                item
                    ? {
                          ...item,
                          series_id: Number(item.series_id),
                      }
                    : null
            );
        });

        effect(() => {
            const playlist = this.xtreamStore.currentPlaylist();
            this.currentPlaylistId.set(playlist?.id ?? '');
            this.xtreamDownloadContext.set(
                playlist
                    ? {
                          serverUrl: playlist.serverUrl,
                          username: playlist.username,
                          password: playlist.password,
                      }
                    : null
            );
        });

        // Initializes on first render and RE-initializes when the route
        // params change while the component is reused (Similar rail).
        effect(() => {
            const playlistId = this.xtreamStore.currentPlaylist()?.id;
            const { categoryId, serialId } = this.routeParams();
            if (!playlistId || !serialId) {
                return;
            }

            const initKey = `${playlistId}:${categoryId}:${serialId}`;
            if (this.lastInitKey() === initKey) {
                return;
            }
            this.lastInitKey.set(initKey);

            this.playback.resetForNewSeries();
            this.initializeSerialDetails(playlistId, categoryId, serialId);
        });

        effect(() => {
            const playlistId = this.currentPlaylistId();
            const selectedItem = this.selectedItem();
            const xtreamId = Number(selectedItem?.series_id ?? 0);
            const backdropUrl = selectedItem?.info?.backdrop_path?.[0]?.trim();

            if (
                !playlistId ||
                !Number.isFinite(xtreamId) ||
                xtreamId <= 0 ||
                !backdropUrl
            ) {
                return;
            }

            const backfillKey = `${playlistId}:${xtreamId}:${backdropUrl}`;
            if (this.backdropBackfillKey() === backfillKey) {
                return;
            }

            this.backdropBackfillKey.set(backfillKey);
            void this.xtreamStore.backfillContentBackdrop({
                xtreamId,
                contentType: 'series',
                playlist: this.xtreamStore.currentPlaylist,
                backdropUrl,
            });
        });
    }

    ngOnInit(): void {
        // Initialization is handled by the params-driven effect in the
        // constructor; the hook remains for interface compatibility.
    }

    ngOnDestroy(): void {
        this.playback.closeInlinePlayer();
        this.xtreamStore.setSelectedItem(null);
    }

    openSimilar(item: SimilarCatalogItem): void {
        void this.router.navigate(['../..', item.categoryId, item.id], {
            relativeTo: this.route,
        });
    }

    openActor(member: TmdbEnrichedCastMember): void {
        const playlistId = this.xtreamStore.currentPlaylist()?.id;
        if (!playlistId || !member.tmdbPersonId) {
            return;
        }
        void this.router.navigate([
            '/workspace/xtreams',
            playlistId,
            'actor',
            member.tmdbPersonId,
        ]);
    }

    onSeasonSelected(seasonKey: string): void {
        this.xtreamStore.enrichSelectedSerialSeason(seasonKey);
    }

    playEpisode(episode: XtreamSerieEpisode): void {
        this.playback.playEpisode(episode);
    }

    playQuickStartEpisode(): void {
        this.playback.playQuickStartEpisode();
    }

    playPreviousEpisode(): void {
        this.playback.playPreviousEpisode();
    }

    playNextEpisode(): void {
        this.playback.playNextEpisode();
    }

    handleInlinePlaybackEnded(): void {
        this.playback.handleInlinePlaybackEnded();
    }

    closeInlinePlayer(): void {
        this.playback.closeInlinePlayer();
    }

    handleInlineTimeUpdate(event: {
        currentTime: number;
        duration: number;
    }): void {
        this.playback.handleInlineTimeUpdate(event);
    }

    handleExternalFallbackRequest(request: PlaybackFallbackRequest): void {
        this.playback.handleExternalFallbackRequest(request);
    }

    handlePlaybackToggleRequested(
        request: SeasonContainerPlaybackToggleRequest
    ): Promise<void> {
        return this.playback.handlePlaybackToggleRequested(request);
    }

    toggleFavorite(): void {
        const playlist = this.xtreamStore.currentPlaylist();
        if (!playlist) {
            return;
        }

        this.xtreamStore.toggleFavorite(
            this.route.snapshot.params.serialId,
            playlist.id,
            'series',
            this.selectedItem()?.info?.backdrop_path?.[0]
        );
    }

    getBackdropUrl(info: XtreamSerieInfo): string | undefined {
        return info.backdrop_path?.[0];
    }

    goBack(): void {
        this.playback.closeInlinePlayer();
        this.location.back();
    }

    showCopyNotification(): void {
        this.snackBar.open(
            this.translateService.instant('PORTALS.STREAM_URL_COPIED'),
            undefined,
            {
                duration: 2000,
            }
        );
    }

    private initializeSerialDetails(
        playlistId: string,
        categoryId: string | number,
        serialId: string
    ): void {
        this.xtreamStore.fetchSerialDetailsWithMetadata({
            serialId,
            categoryId: Number(categoryId),
        });
        const serialXtreamId = Number(serialId);
        this.xtreamStore.checkFavoriteStatus(
            serialXtreamId,
            playlistId,
            'series'
        );
        void this.playback.loadSeriesPlaybackPositions(
            playlistId,
            serialXtreamId
        );
    }
}
