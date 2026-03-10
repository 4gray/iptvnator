import { Location } from '@angular/common';
import { Component, inject } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { TranslateModule } from '@ngx-translate/core';
import { SettingsContextService } from '@iptvnator/workspace/shell/util';

@Component({
    selector: 'app-workspace-settings-context-panel',
    imports: [MatIconModule, TranslateModule],
    styleUrls: ['./workspace-settings-context-panel.component.scss'],
    template: `
        <h2 class="panel-title">{{ 'SETTINGS.TITLE' | translate }}</h2>
        <div class="settings-panel-body">
            <div class="nav-list settings-sections-list">
                @for (section of ctx.sections(); track section.id) {
                    <button
                        type="button"
                        class="nav-item settings-section-item"
                        [class.active]="ctx.activeSection() === section.id"
                        (click)="ctx.navigateToSection(section.id)"
                    >
                        <mat-icon>{{ section.icon }}</mat-icon>
                        <span>{{ section.label | translate }}</span>
                    </button>
                }
            </div>
        </div>
        <div class="settings-panel-footer">
            <button
                type="button"
                class="nav-item settings-back-button"
                (click)="onBack()"
            >
                <mat-icon>arrow_back</mat-icon>
                <span>{{ 'SETTINGS.BACK_TO_HOME' | translate }}</span>
            </button>
        </div>
    `,
})
export class WorkspaceSettingsContextPanelComponent {
    readonly ctx = inject(SettingsContextService);
    private readonly location = inject(Location);

    onBack() {
        this.location.back();
    }
}
