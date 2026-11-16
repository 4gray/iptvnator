import { CommonModule } from '@angular/common';
import {
    ChangeDetectionStrategy,
    Component,
    DOCUMENT,
    inject,
    Injector,
    input,
} from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { TranslateModule } from '@ngx-translate/core';
import { Language } from '@iptvnator/shared/interfaces';
import {
    StartupBehaviorOption,
    StartupWindowModeOption,
} from './settings.models';
import { markSectionForCheckOnFormEvents } from './settings-section-form-render';
import { provideFormFieldDefaults } from '@iptvnator/ui/components/form-field-defaults';

@Component({
    selector: 'app-settings-general-section',
    providers: [provideFormFieldDefaults()],
    imports: [
        CommonModule,
        MatButtonModule,
        MatFormFieldModule,
        MatSelectModule,
        MatSlideToggleModule,
        ReactiveFormsModule,
        TranslateModule,
    ],
    templateUrl: './settings-general-section.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
    styles: [
        ':host { display: contents; }',
        '.android-shell-settings { margin-block-start: 12px; }',
    ],
})
export class SettingsGeneralSectionComponent {
    private readonly shell = (
        inject(DOCUMENT).defaultView as
            | (Window & { TvShell?: { postMessage(message: string): void } })
            | null
    )?.TvShell;
    readonly canOpenAndroidSettings =
        typeof this.shell?.postMessage === 'function';

    openAndroidSettings(): void {
        this.shell?.postMessage(JSON.stringify(['openSettings']));
    }

    readonly form = input.required<FormGroup>();
    private readonly injector = inject(Injector);

    constructor() {
        // Parent patches (Discard, backup import) change the form outside
        // this OnPush section's events.
        markSectionForCheckOnFormEvents(this.form);
    }

    readonly languageEnum = input.required<typeof Language>();
    readonly startupBehaviorOptions = input.required<StartupBehaviorOption[]>();
    readonly startupWindowModeOptions =
        input.required<StartupWindowModeOption[]>();
    /** Desktop only: the window-mode select needs the main-process mirror and F11 */
    readonly supportsStartupWindowMode = input(false);
    readonly supportsPortalConnectivityGuard = input(false);

    /**
     * Opens the workspace shell's shortcuts dialog, the one `?` opens.
     * Settings renders inside the shell, whose chunk is already loaded, so
     * the import costs no fetch. A static import or a root service shared
     * with the shell would land in the startup bundle instead.
     */
    protected async openKeyboardShortcuts(): Promise<void> {
        const service = await this.loadShortcutsService();
        this.injector.get(service, null)?.openShortcutsDialog();
    }

    /** Replaced in specs: ESM Jest cannot mock a dynamic import. */
    protected loadShortcutsService = async () =>
        (await import('@iptvnator/workspace/shell/feature'))
            .WorkspaceKeyboardShortcutsService;
}
