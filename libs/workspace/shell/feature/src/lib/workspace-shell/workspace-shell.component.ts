import { CdkTrapFocus } from '@angular/cdk/a11y';
import {
    Component,
    effect,
    ElementRef,
    HostListener,
    inject,
    untracked,
    viewChild,
} from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { ExternalPlaybackDockComponent } from '@iptvnator/ui/components';
import { EmbeddedMpvOverlayVisibilityService } from '@iptvnator/ui/playback';
import {
    PlaylistDropOverlayComponent,
    PlaylistDropZoneDirective,
} from '../playlist-drop-overlay';
import { WorkspaceShellContextSidebarComponent } from './components/workspace-shell-context-sidebar/workspace-shell-context-sidebar.component';
import { WorkspaceShellHeaderComponent } from './components/workspace-shell-header/workspace-shell-header.component';
import { WorkspaceShellImportOverlayComponent } from './components/workspace-shell-import-overlay/workspace-shell-import-overlay.component';
import { WorkspaceShellRailComponent } from './components/workspace-shell-rail/workspace-shell-rail.component';
import { WorkspaceShellFacade } from './services/workspace-shell.facade';
import { WorkspaceShellXtreamImportService } from './services/workspace-shell-xtream-import.service';
import { WorkspaceShellCommandPaletteService } from './services/workspace-shell-command-palette.service';
import { WorkspaceShellHeaderService } from './services/workspace-shell-header.service';
import { WorkspaceShellRouteStateService } from './services/workspace-shell-route-state.service';
import { WorkspaceShellSearchSyncService } from './services/workspace-shell-search-sync.service';
import { WorkspaceShellSearchService } from './services/workspace-shell-search.service';
import { WorkspaceKeyboardShortcutsService } from '../workspace-keyboard-shortcuts/workspace-keyboard-shortcuts.service';
import { WorkspaceLiveCategoriesPopoverService } from '../workspace-live-categories-popover/workspace-live-categories-popover.service';
import { WorkspaceShellContextDrawerService } from '@iptvnator/workspace/shell/util';
import { LIVE_CATEGORIES_POPOVER } from '@iptvnator/portal/shared/util';

@Component({
    selector: 'app-workspace-shell',
    imports: [
        CdkTrapFocus,
        ExternalPlaybackDockComponent,
        TranslatePipe,
        PlaylistDropOverlayComponent,
        PlaylistDropZoneDirective,
        RouterOutlet,
        WorkspaceShellContextSidebarComponent,
        WorkspaceShellHeaderComponent,
        WorkspaceShellImportOverlayComponent,
        WorkspaceShellRailComponent,
    ],
    templateUrl: './workspace-shell.component.html',
    styleUrl: './workspace-shell.component.scss',
    providers: [
        WorkspaceShellFacade,
        WorkspaceShellRouteStateService,
        WorkspaceShellSearchSyncService,
        WorkspaceShellSearchService,
        WorkspaceShellHeaderService,
        WorkspaceShellXtreamImportService,
        WorkspaceShellCommandPaletteService,
        WorkspaceKeyboardShortcutsService,
        // The live layouts inside the router outlet open the folded categories
        // rail through this token; see `LiveCategoriesPopover`.
        {
            provide: LIVE_CATEGORIES_POPOVER,
            useClass: WorkspaceLiveCategoriesPopoverService,
        },
    ],
})
export class WorkspaceShellComponent {
    readonly facade = inject(WorkspaceShellFacade);
    readonly keyboardShortcuts = inject(WorkspaceKeyboardShortcutsService);
    readonly contextDrawer = inject(WorkspaceShellContextDrawerService);
    private readonly mpvOverlayVisibility = inject(
        EmbeddedMpvOverlayVisibilityService
    );
    private readonly header = viewChild<WorkspaceShellHeaderShortcutTarget>(
        'workspaceHeader'
    );
    private readonly workspaceContent = viewChild<ElementRef<HTMLElement>>(
        'workspaceContent'
    );

    constructor() {
        // Focus restoration is the closing half of the drawer's focus
        // contract: CdkTrapFocus captures focus into the drawer on open, but
        // deactivating a trap does not restore focus, and the closed drawer
        // is visibility: hidden — whatever was focused inside it silently
        // drops to <body>. Returning it to the toggle keeps keyboard users
        // where they acted.
        let wasOpen = false;
        effect(() => {
            const open = this.contextDrawer.isOpen();
            if (wasOpen && !open) {
                // Deferred: the header is inert while the drawer is open,
                // and focus() on a still-inert element is silently ignored.
                // The timeout runs after the render that removes `inert`.
                setTimeout(() => {
                    if (this.header()?.focusContextDrawerToggle()) {
                        return;
                    }
                    // The toggle is gone — a drawer selection navigated to
                    // a route without a context panel. Focus lands on the
                    // route content instead of silently dropping to <body>.
                    this.workspaceContent()?.nativeElement.focus();
                });
            }
            wasOpen = open;
        });

        // The Embedded MPV native-view video surface is composited outside
        // DOM stacking and would paint straight over the drawer regardless
        // of z-index; registering the open drawer as an external modal
        // surface hides the native view exactly like a Material dialog does.
        effect((onCleanup) => {
            if (!this.contextDrawer.isOpen()) {
                return;
            }
            // untracked: the service reads its own signals while
            // recomputing; tracked here, that read would make this effect
            // depend on state its own acquire/release toggles.
            onCleanup(
                untracked(() =>
                    this.mpvOverlayVisibility.acquireExternalModalSurface()
                )
            );
        });
    }

    // Typed Event, not KeyboardEvent: Angular types a key-filtered host
    // listener's $event as Event, and only preventDefault is needed here.
    @HostListener('document:keydown.escape', ['$event'])
    onEscapePressed(event: Event): void {
        if (event.defaultPrevented || !this.contextDrawer.isOpen()) {
            return;
        }

        // Consume the event: this listener registers before any routed
        // content's, and downstream Escape consumers (the portal detail
        // shell's inline player, the shared controls shortcuts) check
        // defaultPrevented — without this, one keypress would close both
        // the drawer and the obscured playback surface behind it.
        event.preventDefault();
        this.contextDrawer.close();
    }

    @HostListener('document:keydown', ['$event'])
    onDocumentKeydown(event: KeyboardEvent): void {
        if (
            event.defaultPrevented ||
            !this.facade.isElectron ||
            !isFindShortcut(event) ||
            // The open drawer is modal: Ctrl/Cmd+F would navigate to global
            // search behind it (the search input it focuses is inside the
            // inert header, so the shortcut would act on obscured UI).
            this.contextDrawer.isOpen()
        ) {
            return;
        }

        const header = this.header();
        const target = event.target;
        if (isEditableTarget(target) && !header?.containsSearchInput(target)) {
            return;
        }

        event.preventDefault();
        this.facade.openGlobalSearch(this.facade.searchQuery());
        setTimeout(() => header?.focusSearchInput({ select: true }));
    }
}

function isFindShortcut(event: KeyboardEvent): boolean {
    return (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f';
}

function isEditableTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) {
        return false;
    }

    if (target.isContentEditable) {
        return true;
    }

    const tagName = target.tagName.toLowerCase();
    return (
        tagName === 'input' || tagName === 'textarea' || tagName === 'select'
    );
}

interface WorkspaceShellHeaderShortcutTarget {
    containsSearchInput(target: EventTarget | null): boolean;
    focusSearchInput(options?: { select?: boolean }): void;
    focusContextDrawerToggle(): boolean;
}
