import { Component, input, output, ViewEncapsulation } from '@angular/core';
import { FormArray, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { EpgViewMode } from '@iptvnator/shared/interfaces';
import { EpgSourceStatusComponent } from '@iptvnator/ui/epg';
import { TranslateModule } from '@ngx-translate/core';
import { EpgViewModeOption } from './settings.models';

@Component({
    selector: 'app-settings-epg-section',
    imports: [
        EpgSourceStatusComponent,
        MatButtonModule,
        MatCheckboxModule,
        MatFormFieldModule,
        MatIconModule,
        MatInputModule,
        MatProgressSpinnerModule,
        MatTooltipModule,
        ReactiveFormsModule,
        TranslateModule,
    ],
    templateUrl: './settings-epg-section.component.html',
    encapsulation: ViewEncapsulation.None,
    styles: [':host { display: contents; }'],
})
export class SettingsEpgSectionComponent {
    readonly form = input.required<FormGroup>();
    readonly activeSection = input.required<string>();
    readonly epgUrl = input.required<FormArray>();
    readonly isClearingEpgData = input(false);
    readonly epgViewModeOptions = input.required<EpgViewModeOption[]>();

    readonly refreshEpg = output<string>();
    readonly removeEpgSource = output<number>();
    readonly addEpgSource = output<void>();
    readonly refreshAllEpg = output<void>();
    readonly clearEpgData = output<void>();
    readonly selectEpgViewMode = output<EpgViewMode>();
}
