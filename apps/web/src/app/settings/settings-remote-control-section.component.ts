import {
    Component,
    input,
    output,
    ViewEncapsulation,
    ChangeDetectionStrategy,
} from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslateModule } from '@ngx-translate/core';
import { QRCodeComponent } from 'angularx-qrcode';
import { AppFormFieldModule } from '@iptvnator/ui/components/form-field';
import { markSectionForCheckOnFormEvents } from './settings-section-form-render';

@Component({
    selector: 'app-settings-remote-control-section',
    imports: [
        MatButtonModule,
        AppFormFieldModule,
        MatIconModule,
        MatInputModule,
        MatSlideToggleModule,
        MatTooltipModule,
        QRCodeComponent,
        ReactiveFormsModule,
        TranslateModule,
    ],
    templateUrl: './settings-remote-control-section.component.html',
    encapsulation: ViewEncapsulation.None,
    changeDetection: ChangeDetectionStrategy.OnPush,
    styleUrls: ['./settings-remote-control-section.component.scss'],
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
