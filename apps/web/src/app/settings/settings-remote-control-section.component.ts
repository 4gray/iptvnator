import {
    Component,
    input,
    output,
    ViewEncapsulation,
    ChangeDetectionStrategy,
} from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslateModule } from '@ngx-translate/core';
import { QRCodeComponent } from 'angularx-qrcode';
import { markSectionForCheckOnFormEvents } from './settings-section-form-render';

@Component({
    selector: 'app-settings-remote-control-section',
    imports: [
        MatButtonModule,
        MatCheckboxModule,
        MatFormFieldModule,
        MatIconModule,
        MatInputModule,
        MatTooltipModule,
        QRCodeComponent,
        ReactiveFormsModule,
        TranslateModule,
    ],
    templateUrl: './settings-remote-control-section.component.html',
    encapsulation: ViewEncapsulation.None,
    changeDetection: ChangeDetectionStrategy.OnPush,
    styles: [':host { display: contents; }'],
})
export class SettingsRemoteControlSectionComponent {
    readonly form = input.required<FormGroup>();

    constructor() {
        // Parent patches (Discard, backup import) change the form outside
        // this OnPush section's events.
        markSectionForCheckOnFormEvents(this.form);
    }

    readonly localIpAddresses = input.required<string[]>();
    readonly visibleQrCodeIp = input<string | null>(null);

    readonly toggleQrCode = output<string>();
}
