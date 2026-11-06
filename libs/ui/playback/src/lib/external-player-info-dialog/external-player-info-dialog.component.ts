import { Component, ChangeDetectionStrategy } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import {
    DialogFooterDirective,
    DialogFooterStartDirective,
    DialogShellComponent,
} from '@iptvnator/ui/components';

@Component({
    template: `
        <app-dialog-shell icon="live_tv" [heading]="'INFORMATION' | translate">
            <p class="external-player-info">
                {{ 'EXTERNAL_PLAYER.INFO_DIALOG.PLAYING' | translate }}<br />
                {{ 'EXTERNAL_PLAYER.INFO_DIALOG.INSTALL_HINT' | translate
                }}<br />
                <a
                    [routerLink]
                    class="external-player-info__link"
                    (click)="
                        openUrl(
                            'https://github.com/4gray/iptvnator/wiki/What-is-mpv-video-player-and-how-to-install-it-on-different-operating-systems%3F'
                        )
                    "
                    >{{
                        'EXTERNAL_PLAYER.INFO_DIALOG.INSTALL_INSTRUCTIONS'
                            | translate
                    }}</a
                >
            </p>
            <div appDialogFooterStart>
                <mat-checkbox (change)="setVisibility($event.checked)">{{
                    'EXTERNAL_PLAYER.INFO_DIALOG.DONT_SHOW_AGAIN' | translate
                }}</mat-checkbox>
            </div>
            <div appDialogFooter>
                <button mat-button mat-dialog-close cdkFocusInitial>
                    {{ 'CLOSE' | translate }}
                </button>
            </div>
        </app-dialog-shell>
    `,
    styles: [
        `
            .external-player-info {
                margin: 0;
                line-height: 1.6;
            }

            .external-player-info__link {
                cursor: pointer;
            }
        `,
    ],
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        DialogFooterDirective,
        DialogFooterStartDirective,
        DialogShellComponent,
        MatButtonModule,
        MatCheckboxModule,
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

    setVisibility(value: boolean) {
        localStorage.setItem('hideExternalInfoDialog', value.toString());
    }
}
