import { ChangeDetectionStrategy, Component, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { TranslateModule } from '@ngx-translate/core';

@Component({
    selector: 'app-settings-android-device-section',
    imports: [MatButtonModule, TranslateModule],
    templateUrl: './settings-android-device-section.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
    styles: [':host { display: contents; }'],
})
export class SettingsAndroidDeviceSectionComponent {
    readonly openAdvanced = output<void>();
}
