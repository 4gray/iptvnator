import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { DialogShellComponent } from '@iptvnator/ui/components';

const guide = 'https://github.com/4gray/iptvnator/blob/master/docker/README.md';

export const SERVER_GUIDES = {
    desktop: guide + '#run-the-server-from-the-desktop-app',
    connection: guide + '#connect-your-clients',
};

@Component({
    imports: [DialogShellComponent, TranslateModule],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <app-dialog-shell
            icon="dns"
            [heading]="'SOURCE_SYNC.ABOUT_TITLE' | translate"
            [bodyFocusable]="true"
        >
            <div class="server-about">
                <p>{{ 'SOURCE_SYNC.ABOUT_PURPOSE' | translate }}</p>
                <p>{{ 'SOURCE_SYNC.ABOUT_PRIVACY' | translate }}</p>

                <section>
                    <h3>{{ 'HOSTED_SERVER.TITLE' | translate }}</h3>
                    <p>{{ 'SOURCE_SYNC.ABOUT_DESKTOP' | translate }}</p>
                    <a
                        [href]="guides.desktop"
                        target="_blank"
                        rel="noopener noreferrer"
                        >{{ 'HOSTED_SERVER.SETUP_GUIDE' | translate }}</a
                    >
                </section>

                <section>
                    <h3>
                        {{ 'SOURCE_SYNC.ABOUT_SEPARATE_TITLE' | translate }}
                    </h3>
                    <p>{{ 'SOURCE_SYNC.ABOUT_SEPARATE' | translate }}</p>
                    <a
                        [href]="guides.connection"
                        target="_blank"
                        rel="noopener noreferrer"
                        >{{ 'HOSTED_SERVER.CLIENT_GUIDE' | translate }}</a
                    >
                </section>
            </div>
        </app-dialog-shell>
    `,
    styles: `
        .server-about {
            display: grid;
            gap: 16px;
            font-size: 13.5px;
            line-height: 1.5;
            overflow-wrap: anywhere;
        }

        section {
            display: grid;
            justify-items: start;
            gap: 4px;
            border-block-start: 1px solid var(--app-widget-border);
            padding-block-start: 12px;
        }

        h3,
        p {
            margin: 0;
        }

        h3 {
            color: var(--app-heading-color);
            font-size: 14px;
            font-weight: 600;
        }

        a {
            color: var(--app-selection-text-color);
            text-underline-offset: 3px;
        }
    `,
})
export class SettingsServerAboutDialogComponent {
    readonly guides = SERVER_GUIDES;
}
