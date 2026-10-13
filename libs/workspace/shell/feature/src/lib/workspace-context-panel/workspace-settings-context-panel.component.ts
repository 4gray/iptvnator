import { NgTemplateOutlet } from '@angular/common';
import {
    Component,
    computed,
    ElementRef,
    inject,
    signal,
    ChangeDetectionStrategy,
} from '@angular/core';
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
import {
    SettingsContextService,
    SettingsNavItem,
} from '@iptvnator/workspace/shell/util/settings-context';
import { SETTINGS_NAV_GROUPS } from '@iptvnator/workspace/shell/util/settings-search';

interface SettingsNavGroupView {
    readonly id: string;
    readonly labelKey: string;
    readonly sections: readonly SettingsNavItem[];
}

@Component({
    selector: 'app-workspace-settings-context-panel',
    imports: [
        MatIconModule,
        NgTemplateOutlet,
        RouterLink,
        RouterLinkActive,
        TranslateModule,
    ],
    styleUrls: ['./workspace-settings-context-panel.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
        // Esc leaves settings, as the header Back advertises. Registered
        // before any routed content's listener; see `onEscape`.
        '(document:keydown.escape)': 'onEscape($event)',
    },
    template: `
        <h2 class="panel-title">{{ 'SETTINGS.TITLE' | translate }}</h2>
        <nav
            class="settings-nav"
            [attr.aria-label]="'SETTINGS.TITLE' | translate"
        >
            @for (group of groups(); track group.id) {
                <div class="settings-nav__group" [attr.data-group]="group.id">
                    <div class="settings-nav__group-label">
                        {{ group.labelKey | translate }}
                    </div>
                    @for (section of group.sections; track section.id) {
                        <ng-container
                            *ngTemplateOutlet="
                                sectionLink;
                                context: { $implicit: section }
                            "
                        />
                    }
                </div>
            }
            <div class="settings-nav__spacer"></div>
            @if (footer().length > 0) {
                <div class="settings-nav__footer">
                    @for (section of footer(); track section.id) {
                        <ng-container
                            *ngTemplateOutlet="
                                sectionLink;
                                context: { $implicit: section, footer: true }
                            "
                        />
                    }
                </div>
            }
        </nav>

        <ng-template #sectionLink let-section let-footer="footer">
            <!-- replaceUrl keeps a single settings entry in the browser
                 history: switching sections must not turn "Back" (header or
                 browser) into a walk through every visited section page
                 before finally leaving. -->
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
                <!-- While a settings search is active, each section shows
                     how many of its settings match. -->
                @if (ctx.matchCounts(); as counts) {
                    <span
                        class="nav-item-meta"
                        [attr.data-test-id]="
                            'settings-section-matches-' + section.id
                        "
                        >{{ counts[section.id] ?? 0 }}</span
                    >
                } @else if (ctx.dirtySections().has(section.id)) {
                    <!-- Staged edits wait on this page for Save. -->
                    <span
                        class="nav-item-dot"
                        [attr.data-test-id]="
                            'settings-section-dirty-' + section.id
                        "
                        [attr.aria-label]="'SETTINGS.UNSAVED_CHANGES' | translate"
                        role="img"
                    ></span>
                } @else if (footer && ctx.updateAvailable()) {
                    <span
                        class="nav-item-badge"
                        data-test-id="settings-nav-update-badge"
                        >{{ 'SETTINGS.APP_UPDATE_DOWNLOAD' | translate }}</span
                    >
                } @else if (footer && ctx.version(); as version) {
                    <span
                        class="nav-item-version"
                        data-test-id="settings-nav-version"
                        [attr.title]="version"
                        >{{ version }}</span
                    >
                }
            </a>
        </ng-template>
    `,
})
export class WorkspaceSettingsContextPanelComponent {
    readonly ctx = inject(SettingsContextService);
    private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
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

    /** Grouped sections in group order; empty groups are left out. */
    readonly groups = computed<readonly SettingsNavGroupView[]>(() => {
        const sections = this.ctx.sections();
        return SETTINGS_NAV_GROUPS.map((group) => ({
            id: group.id,
            labelKey: group.labelKey,
            sections: sections.filter((section) => section.group === group.id),
        })).filter((group) => group.sections.length > 0);
    });

    /** Sections without a group sit at the bottom (About). */
    readonly footer = computed(() =>
        this.ctx.sections().filter((section) => !section.group)
    );

    constructor() {
        // The panel exists exactly while the settings route shows, so it
        // offers the page's Back in the header. On a phone the toggle for
        // this drawer stays beside it: the drawer holds the sections.
        // Opened as the session's first page, Back leads to the first
        // workspace view (the dashboard, or sources when it is hidden).
        registerWorkspaceBack({
            phoneDrawerToggle: 'beside',
            escapeShortcut: signal(true),
            run: () => this.leaveSettings(),
        });
    }

    onSectionClicked() {
        this.contextDrawer?.close();
    }

    /**
     * Esc leaves settings unless something closer owns it: a modifier chord,
     * an already handled key (the shell closes the phone drawer first), an
     * open overlay (select panel, menu, dialog), text being edited, or
     * browser fullscreen.
     */
    onEscape(event: Event): void {
        const keyboard = event as KeyboardEvent;
        if (
            keyboard.defaultPrevented ||
            keyboard.repeat ||
            keyboard.altKey ||
            keyboard.ctrlKey ||
            keyboard.metaKey ||
            keyboard.shiftKey
        ) {
            return;
        }
        const document = this.host.nativeElement.ownerDocument;
        if (document.fullscreenElement) return;
        if (document.querySelector('.cdk-overlay-backdrop')) return;
        const target = keyboard.target as HTMLElement | null;
        if (
            target?.isContentEditable ||
            target?.closest(
                'input, textarea, select, [contenteditable]:not([contenteditable="false"])'
            )
        ) {
            return;
        }
        keyboard.preventDefault();
        this.leaveSettings();
    }

    private leaveSettings(): void {
        this.backNavigation.back(() =>
            this.startupPreferences.resolveDashboardPath()
        );
    }
}
