import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { PortalStore } from '../../../xtream/portal.store';

@Component({
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
                                'https://github.com/cloud-saviour/csiptv/wiki/What-is-mpv-video-player-and-how-to-install-it-on-different-operating-systems%3F'
                            )
                        "
                        >installation instructions</a
                    >
                    for more details.
                </div>
            </div>
        </mat-dialog-content>
        <mat-dialog-actions style="justify-content: space-between;">
            <div>
                <mat-checkbox (change)="setVisibility($event.checked)"
                    >Don't show anymore</mat-checkbox
                >
            </div>
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
        MatCheckboxModule,
        MatDialogModule,
        MatIconModule,
        RouterLink,
        TranslateModule,
    ]
})
export class ExternalPlayerInfoDialogComponent {
    portalStore = inject(PortalStore);
    openUrl(url: string) {
        window.open(url, '_blank');
    }

    setVisibility(value: boolean) {
        this.portalStore.setHideExternalInfoDialog(value);
    }
}
