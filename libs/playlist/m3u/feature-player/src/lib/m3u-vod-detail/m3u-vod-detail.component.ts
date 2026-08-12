import {
    Component,
    computed,
    effect,
    inject,
    input,
    output,
    signal,
    untracked,
} from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import type { PlaybackFallbackRequest } from '@iptvnator/playback/util';
import {
    enrichedCast,
    tmdbBackdropUrl,
    tmdbPosterUrl,
    topCast,
} from '@iptvnator/services';
import { Channel, ResolvedPortalPlayback } from '@iptvnator/shared/interfaces';
import {
    DetailActionsTemplateDirective,
    DetailMetaTemplateDirective,
    DetailTagsTemplateDirective,
    PortalDetailShellComponent,
} from '@iptvnator/ui/components';
import { PortalInlinePlayerComponent } from '@iptvnator/ui/playback';
import { M3uVodMetadataService } from './m3u-vod-metadata.service';

/**
 * VOD detail experience for an M3U entry recognized as a movie: the same
 * two-state shell the portals use, fed by TMDB metadata instead of a portal
 * payload. Watch-first — the parent activates a channel and playback starts
 * immediately (M3U zapping semantics), with the About block below where the
 * EPG zone would be; Escape/close reveals the Browse hero.
 *
 * The shell renders provider facts (entry name, logo) instantly; the TMDB
 * lookup patches the same view asynchronously, so a missing or failed match
 * simply leaves the thin provider presentation in place — no layout jump.
 *
 * External MPV/VLC users keep the Browse layout: the m3u-state effects
 * already launched the player on activation, so `inlinePlayerAvailable` is
 * false and this component never mounts an inline player for them.
 */
@Component({
    selector: 'app-m3u-vod-detail',
    providers: [M3uVodMetadataService],
    imports: [
        DetailActionsTemplateDirective,
        DetailMetaTemplateDirective,
        DetailTagsTemplateDirective,
        MatIcon,
        PortalDetailShellComponent,
        PortalInlinePlayerComponent,
        TranslatePipe,
    ],
    templateUrl: './m3u-vod-detail.component.html',
    styleUrls: ['./m3u-vod-detail.component.scss'],
})
export class M3uVodDetailComponent {
    private readonly metadata = inject(M3uVodMetadataService);

    readonly channel = input.required<Channel>();
    /** Parent-owned playback payload (headers/DRM already resolved). */
    readonly playback = input<ResolvedPortalPlayback | null>(null);
    readonly playbackSessionKey = input.required<string>();
    /** Parent's `shouldShowInlinePlayer` verdict — false for MPV/VLC users. */
    readonly inlinePlayerAvailable = input(true);
    /** M3U's shared persisted volume (localStorage `volume`). */
    readonly volume = input(1);

    readonly externalFallbackRequested = output<PlaybackFallbackRequest>();

    /** Player closed by the user — Browse until Play or the next channel. */
    private readonly playerDismissed = signal(false);

    constructor() {
        effect(() => {
            const channel = this.channel();
            untracked(() => {
                this.playerDismissed.set(false);
                this.metadata.load(channel);
            });
        });
    }

    readonly tmdb = computed(() => this.metadata.state().details);

    readonly title = computed(
        () => this.tmdb()?.title?.trim() || this.channel().name
    );
    readonly overview = computed(() => this.tmdb()?.overview?.trim() ?? '');
    readonly posterUrl = computed(
        () =>
            tmdbPosterUrl(this.tmdb()?.poster_path) ??
            this.channel().tvg?.logo?.trim() ??
            undefined
    );
    readonly backdropUrl = computed(
        () => tmdbBackdropUrl(this.tmdb()?.backdrop_path) ?? undefined
    );
    readonly year = computed(() => {
        const releaseDate = this.tmdb()?.release_date ?? '';
        return /^\d{4}/.test(releaseDate) ? releaseDate.slice(0, 4) : '';
    });
    readonly genres = computed(() =>
        (this.tmdb()?.genres ?? [])
            .map((genre) => genre.name)
            .filter(Boolean)
            .join(', ')
    );
    readonly runtimeLabel = computed(() => {
        const runtime = this.tmdb()?.runtime;
        if (!runtime || runtime <= 0) {
            return '';
        }
        const hours = Math.floor(runtime / 60);
        const minutes = runtime % 60;
        return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
    });
    readonly rating = computed(() => {
        const details = this.tmdb();
        const average = details?.vote_average ?? 0;
        const count = details?.vote_count ?? 0;
        return average > 0 && count > 0
            ? (Math.round(average * 10) / 10).toFixed(1)
            : '';
    });
    readonly cast = computed(() => {
        const credits = this.tmdb()?.credits;
        return credits ? enrichedCast(topCast(credits)) : [];
    });
    readonly directors = computed(() =>
        (this.tmdb()?.credits?.crew ?? [])
            .filter((member) => member.job === 'Director')
            .map((member) => member.name)
            .join(', ')
    );

    /**
     * The playback payload handed to the player. Its OBJECT IDENTITY is the
     * source-application key downstream (`createWebPlayerApplicationState`
     * mints a new source revision for any new payload, which recreates the
     * player and re-applies the source), so it must depend on the parent's
     * payload alone. Reading TMDB signals here would restart the movie a
     * couple of seconds in, the moment enrichment resolves — metadata belongs
     * in the About/hero presentation, never in the source identity.
     *
     * The parent built the payload for a LIVE channel; the recognized movie
     * only flips to VOD semantics (seek bar, duration).
     */
    readonly inlinePlayback = computed<ResolvedPortalPlayback | null>(() => {
        if (!this.inlinePlayerAvailable() || this.playerDismissed()) {
            return null;
        }
        const playback = this.playback();
        return playback ? { ...playback, isLive: false } : null;
    });
    readonly playbackActive = computed(() => this.inlinePlayback() !== null);
    readonly canPlayInline = computed(
        () => this.inlinePlayerAvailable() && this.playback() !== null
    );

    closeInlinePlayback(): void {
        this.playerDismissed.set(true);
    }

    startPlayback(): void {
        this.playerDismissed.set(false);
    }
}
