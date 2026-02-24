import { Location } from '@angular/common';
import { Component, inject } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { TranslateModule } from '@ngx-translate/core';
import { SettingsContextService } from './settings-context.service';

@Component({
    selector: 'app-workspace-settings-context-panel',
    imports: [MatIconModule, TranslateModule],
    styleUrls: ['./workspace-settings-context-panel.component.scss'],
    template: `
        <h2 class="panel-title">{{ 'SETTINGS.TITLE' | translate }}</h2>
        <div class="nav-list" style="margin-top: 16px">
            <button
                type="button"
                class="nav-item"
                (click)="onBack()"
                style="margin-bottom: 8px;"
            >
                <mat-icon>arrow_back</mat-icon>
                <span>{{ 'SETTINGS.BACK_TO_HOME' | translate }}</span>
            </button>

            <p class="panel-header" style="padding-top: 8px;">
                App preferences
            </p>
            <div class="nav-list">
                @for (section of ctx.sections(); track section.id) {
                    <button
                        type="button"
                        class="nav-item"
                        [class.active]="ctx.activeSection() === section.id"
                        (click)="ctx.setActiveSection(section.id)"
                    >
                        <mat-icon>{{ section.icon }}</mat-icon>
                        <span>{{ section.label | translate }}</span>
                    </button>
                }
            </div>
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
