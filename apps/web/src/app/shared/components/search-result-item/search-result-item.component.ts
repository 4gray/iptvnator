import { Component, EventEmitter, Input, Output } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';

@Component({
    selector: 'app-search-result-item',
    imports: [MatCardModule, MatIconModule],
    template: `
        <mat-card (click)="itemClick.emit()">
            @if (posterUrl) {
                <img
                    [src]="posterUrl"
                    [alt]="title"
                    (error)="
                        $event.target.src = './assets/images/default-poster.png'
                    "
                    class="poster"
                />
            } @else {
                <div class="poster-placeholder">
                    <mat-icon>movie</mat-icon>
                </div>
            }
            <h4>{{ title }}</h4>
            @if (description) {
                <p>{{ description }}</p>
            }
            @if (showPlaylistInfo && playlistName) {
                <div class="playlist-badge">
                    <mat-icon>playlist_play</mat-icon>
                    <span>{{ playlistName }}</span>
                </div>
            }
        </mat-card>
    `,
    styles: [
        `
            :host {
                display: block;
                height: 100%;
            }

            mat-card {
                cursor: pointer;
                height: 100%;
                display: flex;
                flex-direction: column;
                position: relative;
                overflow: hidden;
                background: transparent !important;
                box-shadow: none !important;
                border: none !important;
                padding: 0 !important;
            }

            .poster {
                width: 100%;
                aspect-ratio: 2/3;
                object-fit: cover;
                display: block;
                border-radius: 8px;
            }

            .poster-placeholder {
                width: 100%;
                aspect-ratio: 2/3;
                display: flex;
                align-items: center;
                justify-content: center;
                background: rgba(0, 0, 0, 0.05);
                border-radius: 8px;

                mat-icon {
                    font-size: 48px;
                    width: 48px;
                    height: 48px;
                    opacity: 0.3;
                }
            }

            h4 {
                margin: 0;
                padding: 10px 0 2px 0;
                font-size: 0.9rem;
                font-weight: 500;
                line-height: 1.3em;
                height: 2.6em; /* Fixed height for 2 lines */
                color: var(--text-color, #fff);

                display: -webkit-box;
                -webkit-line-clamp: 2;
                -webkit-box-orient: vertical;
                overflow: hidden;
                text-overflow: ellipsis;
            }

            p {
                margin: 0;
                padding: 0 0 10px 0;
                font-size: 0.75rem;
                line-height: 1.2em;
                height: 1.2em; /* Fixed height for 1 line */
                color: var(--text-color-secondary, rgba(255, 255, 255, 0.7));
                opacity: 0.9; /* Improved readability */

                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }

            .playlist-badge {
                display: flex;
                align-items: center;
                gap: 4px;
                margin-top: auto;
                padding: 0 0 10px 0;
                font-size: 11px;
                opacity: 0.8;
                color: var(--text-color-secondary, inherit);

                mat-icon {
                    font-size: 14px;
                    width: 14px;
                    height: 14px;
                }
            }
        `,
    ],
})
export class SearchResultItemComponent {
    @Input() title = '';
    @Input() description = '';
    @Input() posterUrl = '';
    @Input() type = '';
    @Input() playlistName = '';
    @Input() showPlaylistInfo = false;

    @Output() itemClick = new EventEmitter<void>();
}