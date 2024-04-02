import { Component } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';

@Component({
    standalone: true,
    template: `
        <h2 mat-dialog-title>{{ 'INFORMATION' | translate }}</h2>
        <mat-dialog-content class="mat-typography">
            <div class="centered">
                <mat-icon class="icon">live_tv</mat-icon>
                <div>
                    The video is playing in external player window.<br />
                    Please make sure that mpv/vlc player is correctly installed
                    on your system.<br />
                    See
                    <a
                        [routerLink]
                        style="cursor: pointer"
                        (click)="
                            openUrl(
                                'https://github.com/4gray/iptvnator/wiki/What-is-mpv-video-player-and-how-to-install-it-on-different-operating-systems%3F'
                            )
                        "
                        >installation instructions</a
                    >
                    for more details.
                </div>
            </div>
        </mat-dialog-content>
        <mat-dialog-actions align="end">
            <button mat-button mat-dialog-close cdkFocusInitial color="accent">
                {{ 'CLOSE' | translate }}
            </button>
        </mat-dialog-actions>
    `,
    styles: [
        `
            .centered {
                text-align: center;
                line-height: 24px;
                margin: 20px;

                .icon {
                    font-size: 64px;
                    height: 64px;
                    width: 64px;
                }
            }
        `,
    ],
    imports: [
        MatButtonModule,
        MatDialogModule,
        MatIconModule,
        RouterLink,
        TranslateModule,
    ],
})
export class ExternalPlayerInfoDialogComponent {
    openUrl(url: string) {
        window.open(url, '_blank');
    }
}
