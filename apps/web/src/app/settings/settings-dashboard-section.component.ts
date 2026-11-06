import { CommonModule } from '@angular/common';
import {
    Component,
    input,
    ViewEncapsulation,
    ChangeDetectionStrategy,
} from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { TranslateModule } from '@ngx-translate/core';
import { markSectionForCheckOnFormEvents } from './settings-section-form-render';

@Component({
    selector: 'app-settings-dashboard-section',
    imports: [
        CommonModule,
        MatIconModule,
        MatSlideToggleModule,
        ReactiveFormsModule,
        TranslateModule,
    ],
    templateUrl: './settings-dashboard-section.component.html',
    encapsulation: ViewEncapsulation.None,
    changeDetection: ChangeDetectionStrategy.OnPush,
    styles: [':host { display: contents; }'],
})
export class SettingsDashboardSectionComponent {
    readonly form = input.required<FormGroup>();

    constructor() {
        // Parent patches (Discard, backup import) change the form outside
        // this OnPush section's events.
        markSectionForCheckOnFormEvents(this.form);
    }
}
