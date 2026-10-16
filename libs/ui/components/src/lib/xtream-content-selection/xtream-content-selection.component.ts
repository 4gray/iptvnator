import {
    ChangeDetectionStrategy,
    Component,
    input,
    output,
} from '@angular/core';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { TranslatePipe } from '@ngx-translate/core';
import {
    normalizeXtreamContentTypes,
    XtreamContentType,
} from '@iptvnator/shared/interfaces';

@Component({
    selector: 'app-xtream-content-selection',
    imports: [MatCheckboxModule, TranslatePipe],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <fieldset>
            <legend>
                {{ 'HOME.XTREAM_PLAYLIST.CONTENT_TO_LOAD' | translate }}
            </legend>
            @for (option of options; track option.type) {
                <mat-checkbox
                    [checked]="selected().includes(option.type)"
                    (change)="toggle(option.type, $event.checked)"
                    [attr.data-test-id]="'xtream-load-' + option.type"
                    >{{ option.label | translate }}</mat-checkbox
                >
            }
            <p>{{ 'HOME.XTREAM_PLAYLIST.CONTENT_TO_LOAD_HINT' | translate }}</p>
        </fieldset>
    `,
    styles: [
        `
            fieldset {
                margin: 0;
                padding: 0;
                border: 0;
                min-width: 0;
            }
            mat-checkbox {
                margin-inline-end: 12px;
            }
            p {
                color: var(--app-eyebrow-color);
                font-size: 12px;
            }
        `,
    ],
})
export class XtreamContentSelectionComponent {
    readonly selected = input<XtreamContentType[]>(['live', 'movie', 'series']);
    readonly selectedChange = output<XtreamContentType[]>();
    readonly options: { type: XtreamContentType; label: string }[] = [
        { type: 'live', label: 'PORTALS.LIVE_TV' },
        { type: 'movie', label: 'PORTALS.MOVIES' },
        { type: 'series', label: 'PORTALS.SERIES' },
    ];

    toggle(type: XtreamContentType, checked: boolean): void {
        this.selectedChange.emit(
            normalizeXtreamContentTypes(
                checked
                    ? [...this.selected(), type]
                    : this.selected().filter((value) => value !== type)
            )
        );
    }
}
