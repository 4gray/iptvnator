import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { TranslateModule } from '@ngx-translate/core';

@Component({
    standalone: true,
    imports: [MatIconModule, TranslateModule],
    template: `
        <div mat-dialog-content>
            <img src="./assets/icons/icon-tv-256.png" width="128" /><br />
            <h2 mat-dialog-title>{{ 'ABOUT.TITLE' | translate }}</h2>
            <p>{{ 'ABOUT.DESCRIPTION' | translate }}</p>
            <p>{{ 'ABOUT.VERSION' | translate }}: {{ appVersion }}</p>
            <p>
                <a
                    href="https://github.com/4gray/iptvnator"
                    target="_blank"
                    [title]="'ABOUT.GITHUB_TOOLTIP' | translate"
                    [attr.aria-label]="'ABOUT.GITHUB_TOOLTIP' | translate"
                    ><img
                        src="./assets/icons/github-light.png"
                        [title]="'ABOUT.GITHUB_TOOLTIP' | translate" /></a
                >&nbsp;
                <a
                    href="http://twitter.com/share?text=IPTVnator &mdash; free cross-platform IPTV player. Available as PWA and as native application.&url=https://github.com/4gray/iptvnator&hashtags=iptv,m3u,video-player"
                    [title]="'ABOUT.TWITTER_TOOLTIP' | translate"
                >
                    <img
                        height="32"
                        src="./assets/icons/twitter-light.png"
                        [title]="'ABOUT.TWITTER_TOOLTIP' | translate"
                    />
                </a>
                <a
                    href="https://www.buymeacoffee.com/4gray"
                    target="_blank"
                    [title]="'ABOUT.BUY_ME_A_COFFEE_TOOLTIP' | translate"
                    [attr.aria-label]="
                        'ABOUT.BUY_ME_A_COFFEE_TOOLTIP' | translate
                    "
                    ><mat-icon>local_cafe</mat-icon></a
                >
            </p>
        </div>
    `,
    styles: [
        `
            button {
                text-transform: uppercase;
            }

            a {
                color: #fff;
            }

            .mat-icon {
                font-size: 32px;
            }
        `,
    ],
})
export class AboutDialogComponent {
    constructor(@Inject(MAT_DIALOG_DATA) public appVersion: string) {}
}
