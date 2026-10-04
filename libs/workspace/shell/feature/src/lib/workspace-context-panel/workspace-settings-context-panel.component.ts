import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import {
    registerWorkspaceBack,
    WorkspaceBackNavigationService,
} from '@iptvnator/portal/shared/data-access';
import {
    WorkspaceShellContextDrawerService,
    WorkspaceStartupPreferencesService,
} from '@iptvnator/workspace/shell/util';
import { SettingsContextService } from '@iptvnator/workspace/shell/util/settings-context';

@Component({
    selector: 'app-workspace-settings-context-panel',
    imports: [MatIconModule, RouterLink, RouterLinkActive, TranslateModule],
    styleUrls: ['./workspace-settings-context-panel.component.scss'],
    changeDetection: ChangeDetectionStrategy.Eager,
    template: `
        <h2 class="panel-title">{{ 'SETTINGS.TITLE' | translate }}</h2>
        <div class="settings-panel-body">
            <div class="nav-list settings-sections-list">
                @for (section of ctx.sections(); track section.id) {
                    <!-- replaceUrl keeps a single settings entry in the
                         browser history: switching sections must not turn
                         "Back" (header or browser) into a walk through every
                         visited section page before finally leaving. -->
                    <a
                        class="nav-item settings-section-item"
                        routerLinkActive="active"
                        [routerLink]="['/workspace/settings', section.id]"
                        [replaceUrl]="true"
                        [attr.data-test-id]="'settings-section-' + section.id"
                        [class.has-no-matches]="
                            ctx.matchCounts() !== null &&
                            !ctx.matchCounts()?.[section.id]
                        "
                        (click)="onSectionClicked()"
                    >
                        <mat-icon>{{ section.icon }}</mat-icon>
                        <span class="nav-item-label">{{
                            section.label | translate
                        }}</span>
                        <!-- While a settings search is active, each section
                             shows how many of its settings match. -->
                        @if (ctx.matchCounts(); as counts) {
                            <span
                                class="nav-item-meta"
                                [attr.data-test-id]="
                                    'settings-section-matches-' + section.id
                                "
                                >{{ counts[section.id] ?? 0 }}</span
                            >
                        }
                    </a>
                }
            </div>
        </div>
    `,
})
export class WorkspaceSettingsContextPanelComponent {
    readonly ctx = inject(SettingsContextService);
    private readonly backNavigation = inject(WorkspaceBackNavigationService);
    private readonly startupPreferences = inject(
        WorkspaceStartupPreferencesService
    );
    // Root-provided; optional keeps standalone unit tests light. Section
    // links are real navigations now, so the phone drawer's NavigationEnd
    // auto-close fires too — the explicit close just makes the drawer react
    // immediately instead of waiting for the navigation to settle.
    private readonly contextDrawer = inject(
        WorkspaceShellContextDrawerService,
        {
            optional: true,
        }
    );

    constructor() {
        // The panel exists exactly while the settings route shows, so it
        // offers the page's Back in the header. On a phone the toggle for
        // this drawer stays beside it: the drawer holds the sections.
        // Opened as the session's first page, Back leads to the first
        // workspace view (the dashboard, or sources when it is hidden).
        registerWorkspaceBack({
            phoneDrawerToggle: 'beside',
            run: () =>
                this.backNavigation.back(() =>
                    this.startupPreferences.resolveDashboardPath()
                ),
        });
    }

    onSectionClicked() {
        this.contextDrawer?.close();
    }
}
