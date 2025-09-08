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
            @if (type) {
                <div class="type-badge" [class]="type">{{ type }}</div>
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
            }

            mat-card {
                cursor: pointer;
            }

            h4 {
                margin: 0;
                padding: 8px;
            }

            .poster {
                width: 100%;
                object-fit: cover;
            }

            .poster-placeholder {
                width: 100%;
                height: 200px;
                display: flex;
                align-items: center;
                justify-content: center;
            }

            .type-badge {
                position: absolute;
                top: 8px;
                right: 8px;
                padding: 4px 8px;
                border-radius: 4px;
                font-size: 12px;
                text-transform: uppercase;
            }

            .playlist-badge {
                display: flex;
                align-items: center;
                gap: 4px;
                margin-top: 8px;
                font-size: 12px;
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
