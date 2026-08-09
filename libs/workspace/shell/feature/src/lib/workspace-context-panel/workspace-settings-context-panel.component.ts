import { Location } from '@angular/common';
import { Component, inject } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import {
    WorkspaceShellContextDrawerService,
    SettingsContextService,
} from '@iptvnator/workspace/shell/util';

@Component({
    selector: 'app-workspace-settings-context-panel',
    imports: [MatIconModule, RouterLink, RouterLinkActive, TranslateModule],
    styleUrls: ['./workspace-settings-context-panel.component.scss'],
    template: `
        <h2 class="panel-title">{{ 'SETTINGS.TITLE' | translate }}</h2>
        <div class="settings-panel-body">
            <div class="nav-list settings-sections-list">
                @for (section of ctx.sections(); track section.id) {
                    <!-- replaceUrl keeps a single settings entry in the
                         browser history: switching sections must not turn
                         "Back" (footer or browser) into a walk through every
                         visited section page before finally leaving. -->
                    <a
                        class="nav-item settings-section-item"
                        routerLinkActive="active"
                        [routerLink]="['/workspace/settings', section.id]"
                        [replaceUrl]="true"
                        [attr.data-test-id]="'settings-section-' + section.id"
                        (click)="onSectionClicked()"
                    >
                        <mat-icon>{{ section.icon }}</mat-icon>
                        <span>{{ section.label | translate }}</span>
                    </a>
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
    // Root-provided; optional keeps standalone unit tests light. Section
    // links are real navigations now, so the phone drawer's NavigationEnd
    // auto-close fires too — the explicit close just makes the drawer react
    // immediately instead of waiting for the navigation to settle.
    private readonly contextDrawer = inject(WorkspaceShellContextDrawerService, {
        optional: true,
    });

    onSectionClicked() {
        this.contextDrawer?.close();
    }

    onBack() {
        this.location.back();
    }
}
