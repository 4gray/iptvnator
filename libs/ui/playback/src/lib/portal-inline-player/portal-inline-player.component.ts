import { ClipboardModule } from '@angular/cdk/clipboard';
import {
    ChangeDetectionStrategy,
    Component,
    computed,
    effect,
    ElementRef,
    inject,
    input,
    output,
    signal,
    viewChild,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslateModule } from '@ngx-translate/core';
import {
    PlayerContentInfo,
    ResolvedPortalPlayback,
    VideoPlayer,
} from '@iptvnator/shared/interfaces';
import type { PlaybackFallbackRequest } from '../playback-diagnostics/playback-diagnostics.util';
import { SettingsStore } from '@iptvnator/services';
import { applyChannelNameStrip } from '@iptvnator/shared/m3u-utils';
import type { PlayerMediaTitle } from '../player-controls';
import { WebPlayerViewComponent } from '../web-player-view/web-player-view.component';
import type {
    SeriesEpisodeMetadata,
    SeriesPlaybackNavigation,
} from './series-playback-navigation';
import { UpNextRailComponent } from './up-next-rail.component';
import type { UpNextRailItem } from './up-next-rail.util';

/**
 * Minimum leftover stage width (px) beyond the 16:9 player box before the
 * "Up Next" rail docks in; includes the flex gap between player and rail.
 */
const UP_NEXT_RAIL_MIN_WIDTH = 320;

@Component({
    selector: 'app-portal-inline-player',
    templateUrl: './portal-inline-player.component.html',
    styleUrl: './portal-inline-player.component.scss',
    imports: [
        ClipboardModule,
        MatButtonModule,
        MatIconModule,
        MatTooltipModule,
        TranslateModule,
        UpNextRailComponent,
        WebPlayerViewComponent,
    ],
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
        class: 'portal-inline-player',
        '[attr.data-has-player]': 'hasPlayback()',
    },
})
export class PortalInlinePlayerComponent {
    readonly playback = input<ResolvedPortalPlayback | null>(null);
    readonly episodeMetadata = input<SeriesEpisodeMetadata | null>(null);
    readonly seriesNavigation = input<SeriesPlaybackNavigation | null>(null);
    /** Series name for the fullscreen title overlay. Xtream episode playback
     * carries the episode title, so the series name must come from the host. */
    readonly seriesTitle = input<string | null>(null);
    /** "Up Next" entries built by the series host; null for movies/live. */
    readonly upNextEpisodes = input<UpNextRailItem[] | null>(null);
    private readonly settingsStore = inject(SettingsStore);
    // Strip only live-channel titles — VOD/series titles ("Mission:
    // Impossible - Fallout") must never lose their leading segment.
    readonly title = computed(() =>
        applyChannelNameStrip(
            this.playback()?.title,
            this.playback()?.isLive &&
                this.settingsStore.stripCountryPrefix?.()
        )
    );
    readonly streamUrl = computed(() => this.playback()?.streamUrl ?? '');
    readonly startTime = computed(() => this.playback()?.startTime ?? 0);
    /**
     * Poster used for the "Ambient mode" fill behind the player. Live channels
     * carry logos rather than posters, so they are excluded.
     */
    private readonly ambientImageUrl = computed<string | null>(() => {
        const playback = this.playback();
        if (!playback || playback.isLive) {
            return null;
        }

        return playback.thumbnail ?? null;
    });
    /** Safe `url(...)` value, or null when the poster URL is not a plain http/data URL. */
    readonly ambientImageStyle = computed<string | null>(() => {
        const url = this.ambientImageUrl();
        if (!url || !/^(https?:|data:)/i.test(url)) {
            return null;
        }

        const safe = url.replace(/"/g, '%22').replace(/\\/g, '%5C');
        return `url("${safe}")`;
    });
    // Web players only — mirrors the settings UI, which offers the ambient
    // and Up Next toggles for HTML5, Video.js, and ArtPlayer. Embedded MPV
    // composites a native video layer, so extra DOM stays out of the mix.
    private readonly isWebPlayerEngine = computed<boolean>(() => {
        const player = this.settingsStore.player?.();
        return (
            player === VideoPlayer.VideoJs ||
            player === VideoPlayer.Html5Player ||
            player === VideoPlayer.ArtPlayer
        );
    });
    readonly ambientEnabled = computed<boolean>(() => {
        return (
            this.isWebPlayerEngine() &&
            this.settingsStore.playerAmbientMode?.() === true &&
            !!this.ambientImageStyle()
        );
    });
    readonly contentInfo = computed<PlayerContentInfo | undefined>(
        () => this.playback()?.contentInfo
    );
    readonly hasPlayback = computed(() => !!this.playback()?.streamUrl);
    readonly episodeMetadataText = computed(() => {
        const metadata = this.episodeMetadata();
        if (!metadata) {
            return '';
        }

        return metadata.title
            ? `${metadata.label} - ${metadata.title}`
            : metadata.label;
    });
    readonly playerMediaTitle = computed<PlayerMediaTitle | null>(() => {
        const metadata = this.episodeMetadata();
        const primary = (
            (metadata ? this.seriesTitle() : null) || this.title()
        )?.trim();
        if (!primary) {
            return null;
        }

        return { primary, secondary: metadata?.label ?? null };
    });

    private readonly stageViewport = viewChild<ElementRef<HTMLElement>>(
        'stageViewport'
    );
    /** Rendered size of the theater stage; written by a ResizeObserver. */
    readonly stageSize = signal<{ width: number; height: number } | null>(
        null
    );
    /** Leftover stage width beside the largest 16:9 box fitting its height. */
    private readonly stageLeftoverWidth = computed<number>(() => {
        const size = this.stageSize();
        if (!size || size.height <= 0) {
            return 0;
        }
        return size.width - (size.height * 16) / 9;
    });
    /**
     * The rail docks in only for inline series playback on web engines, when
     * the setting (default on) is enabled and the stage is wide enough; on
     * near-16:9 or taller windows the theater/ambient centering remains.
     */
    readonly upNextRailVisible = computed<boolean>(() => {
        const playback = this.playback();
        return (
            this.settingsStore.playerUpNextRail?.() !== false &&
            this.isWebPlayerEngine() &&
            !!this.upNextEpisodes()?.length &&
            !playback?.isLive &&
            playback?.contentInfo?.contentType === 'episode' &&
            this.stageLeftoverWidth() >= UP_NEXT_RAIL_MIN_WIDTH
        );
    });
    readonly upNextRailItems = computed<UpNextRailItem[]>(
        () => this.upNextEpisodes() ?? []
    );

    readonly closed = output<void>();
    /** Back arrow in the now-playing bar: route-level back, not just close. */
    readonly backClicked = output<void>();
    readonly timeUpdate = output<{
        currentTime: number;
        duration: number;
    }>();
    readonly streamUrlCopied = output<void>();
    readonly externalFallbackRequested = output<PlaybackFallbackRequest>();
    readonly playbackEnded = output<void>();
    readonly previousEpisodeRequested = output<void>();
    readonly nextEpisodeRequested = output<void>();
    readonly upNextEpisodeSelected = output<UpNextRailItem>();

    constructor() {
        effect((onCleanup) => {
            const element = this.stageViewport()?.nativeElement;
            if (!element || typeof ResizeObserver === 'undefined') {
                this.stageSize.set(null);
                return;
            }

            const observer = new ResizeObserver((entries) => {
                const rect = entries[0]?.contentRect;
                if (rect) {
                    this.stageSize.set({
                        width: rect.width,
                        height: rect.height,
                    });
                }
            });
            observer.observe(element);
            onCleanup(() => observer.disconnect());
        });
    }

    onClose(): void {
        this.closed.emit();
    }

    onBack(): void {
        this.backClicked.emit();
    }

    onTimeUpdate(event: { currentTime: number; duration: number }): void {
        this.timeUpdate.emit(event);
    }

    onCopied(): void {
        this.streamUrlCopied.emit();
    }

    onExternalFallbackRequested(request: PlaybackFallbackRequest): void {
        this.externalFallbackRequested.emit(request);
    }

    onPlaybackEnded(): void {
        this.playbackEnded.emit();
    }

    onPreviousEpisodeRequested(): void {
        this.previousEpisodeRequested.emit();
    }

    onNextEpisodeRequested(): void {
        this.nextEpisodeRequested.emit();
    }

    onUpNextEpisodeSelected(item: UpNextRailItem): void {
        this.upNextEpisodeSelected.emit(item);
    }
}
