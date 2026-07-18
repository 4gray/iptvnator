import { ClipboardModule } from '@angular/cdk/clipboard';
import {
    ChangeDetectionStrategy,
    Component,
    computed,
    inject,
    input,
    output,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslateModule } from '@ngx-translate/core';
import {
    PlayerContentInfo,
    ResolvedPortalPlayback,
} from '@iptvnator/shared/interfaces';
import type { PlaybackFallbackRequest } from '../playback-diagnostics/playback-diagnostics.util';
import { SettingsStore } from '@iptvnator/services';
import { applyChannelNameStrip } from '@iptvnator/shared/m3u-utils';
import { WebPlayerViewComponent } from '../web-player-view/web-player-view.component';
import type {
    SeriesEpisodeMetadata,
    SeriesPlaybackNavigation,
} from './series-playback-navigation';

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
}
