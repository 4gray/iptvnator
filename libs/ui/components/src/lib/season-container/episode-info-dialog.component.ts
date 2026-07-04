import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import {
    MAT_DIALOG_DATA,
    MatDialogModule,
    MatDialogRef,
} from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { TranslateModule } from '@ngx-translate/core';
import { XtreamSerieEpisode } from '@iptvnator/shared/interfaces';

export interface EpisodeInfoDialogData {
    /** e.g. "S01E05" */
    episodeLabel: string;
    title: string;
    plot?: string;
    duration?: string;
    airDate?: string;
    thumbnailUrl?: string;
    rating?: string | number;
}

export function buildEpisodeInfoDialogData(
    episode: XtreamSerieEpisode,
    fallbackSeasonKey: string | undefined
): EpisodeInfoDialogData {
    const info =
        !episode.info || Array.isArray(episode.info)
            ? undefined
            : episode.info;
    const seasonNumber = Number(episode.season || fallbackSeasonKey || 1);
    const episodeNumber = Number(episode.episode_num || 1);
    return {
        episodeLabel: `S${String(seasonNumber).padStart(2, '0')}E${String(
            episodeNumber
        ).padStart(2, '0')}`,
        title: episode.title,
        plot: info?.plot || undefined,
        duration: info?.duration || undefined,
        airDate: info?.releasedate || undefined,
        thumbnailUrl: info?.movie_image || undefined,
        rating: info?.rating || undefined,
    };
}

/** Result returned when the user chooses to play from the dialog. */
export const EPISODE_INFO_PLAY = 'play' as const;

/**
 * Lightweight episode details dialog. Cards and list rows clamp the plot to
 * keep fixed heights; the ℹ button opens this dialog with the full text.
 */
@Component({
    selector: 'app-episode-info-dialog',
    standalone: true,
    imports: [MatButtonModule, MatDialogModule, MatIconModule, TranslateModule],
    template: `
        <div class="episode-info">
            @if (data.thumbnailUrl) {
                <img
                    class="episode-info__thumb"
                    [src]="data.thumbnailUrl"
                    [alt]="data.title"
                    (error)="thumbError = true"
                    [style.display]="thumbError ? 'none' : ''"
                />
            }
            <div class="episode-info__body">
                <div class="episode-info__eyebrow">
                    {{ data.episodeLabel }}
                    @if (data.duration) {
                        <span class="episode-info__chip">{{
                            data.duration
                        }}</span>
                    }
                    @if (data.airDate) {
                        <span class="episode-info__chip">{{
                            data.airDate
                        }}</span>
                    }
                    @if (data.rating) {
                        <span class="episode-info__chip"
                            >⭐ {{ data.rating }}</span
                        >
                    }
                </div>
                <h2 mat-dialog-title class="episode-info__title">
                    {{ data.title }}
                </h2>
                @if (data.plot) {
                    <p class="episode-info__plot">{{ data.plot }}</p>
                }
            </div>
        </div>
        <div mat-dialog-actions align="end">
            <button mat-button mat-dialog-close type="button">
                {{ 'CLOSE' | translate }}
            </button>
            <button
                mat-flat-button
                type="button"
                data-testid="episode-info-play"
                (click)="play()"
            >
                <mat-icon>play_arrow</mat-icon>
                {{ 'XTREAM.PLAY' | translate }}
            </button>
        </div>
    `,
    styles: [
        `
            :host {
                display: block;
                max-width: 560px;
            }

            .episode-info__thumb {
                width: 100%;
                aspect-ratio: 16 / 9;
                object-fit: cover;
                border-radius: 12px 12px 0 0;
                display: block;
            }

            .episode-info__body {
                padding: 16px 24px 0;
            }

            .episode-info__eyebrow {
                display: flex;
                align-items: center;
                flex-wrap: wrap;
                gap: 8px;
                font-size: 0.75rem;
                font-weight: 700;
                letter-spacing: 0.12em;
                text-transform: uppercase;
                opacity: 0.7;
            }

            .episode-info__chip {
                font-weight: 500;
                letter-spacing: normal;
                text-transform: none;
            }

            .episode-info__title {
                margin: 6px 0 0;
                padding: 0;
                font-size: 1.25rem;
                line-height: 1.3;
                overflow-wrap: anywhere;

                &::before {
                    display: none;
                }
            }

            .episode-info__plot {
                margin: 10px 0 0;
                font-size: 0.9375rem;
                line-height: 1.6;
                opacity: 0.85;
                max-height: 50vh;
                overflow-y: auto;
            }
        `,
    ],
})
export class EpisodeInfoDialogComponent {
    readonly data: EpisodeInfoDialogData = inject(MAT_DIALOG_DATA);
    private readonly dialogRef = inject(
        MatDialogRef<EpisodeInfoDialogComponent>
    );
    thumbError = false;

    play(): void {
        this.dialogRef.close(EPISODE_INFO_PLAY);
    }
}
