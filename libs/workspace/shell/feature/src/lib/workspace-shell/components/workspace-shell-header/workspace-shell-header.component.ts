import {
    ChangeDetectionStrategy,
    Component,
    computed,
    ElementRef,
    input,
    output,
    viewChild,
} from '@angular/core';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import { PlaylistSwitcherComponent } from '@iptvnator/playlist/shared/ui';
import { WorkspaceHeaderAction } from '@iptvnator/portal/shared/util';
import { PlaylistMeta } from '@iptvnator/shared/interfaces';
import {
    WorkspaceHeaderBulkAction,
    WorkspaceHeaderSidebarToggle,
} from '../../services/helpers/workspace-shell-constants';

@Component({
    selector: 'app-workspace-shell-header',
    imports: [
        MatIcon,
        MatIconButton,
        MatTooltip,
        PlaylistSwitcherComponent,
        TranslatePipe,
    ],
    templateUrl: './workspace-shell-header.component.html',
    styleUrl: './workspace-shell-header.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkspaceShellHeaderComponent {
    private readonly searchInput =
        viewChild<ElementRef<HTMLInputElement>>('searchInput');
    // read: ElementRef because mat-icon-button is a component, so a bare
    // template-ref query would resolve to the MatIconButton instance.
    private readonly contextDrawerToggle = viewChild('contextDrawerToggle', {
        read: ElementRef<HTMLButtonElement>,
    });

    readonly isMac =
        typeof navigator !== 'undefined' &&
        /Mac|iPhone|iPad|iPod/i.test(navigator.platform);
    readonly commandShortcutLabel = this.isMac ? '⌘K' : 'Ctrl+K';

    readonly playlistTitle = input('');
    readonly playlistSubtitle = input('');
    readonly canOpenPlaylistInfo = input(false);
    readonly canOpenAccountInfo = input(false);
    readonly searchQuery = input('');
    readonly canUseSearch = input(false);
    readonly searchPlaceholder = input('');
    readonly searchScopeLabel = input('');
    readonly searchStatusLabel = input('');
    readonly headerShortcut = input<WorkspaceHeaderAction | null>(null);
    readonly headerBulkAction = input<WorkspaceHeaderBulkAction | null>(null);
    readonly headerSidebarToggle = input<WorkspaceHeaderSidebarToggle | null>(
        null
    );
    readonly canRefreshPlaylist = input(false);
    readonly isRefreshingPlaylist = input(false);
    readonly isElectron = input(false);
    readonly hasNoPlaylists = input(false);
    readonly isDownloadsView = input(false);
    readonly activeDownloadsCount = input(0);
    readonly hasActiveDownloads = computed(
        () => this.activeDownloadsCount() > 0
    );
    /**
     * When true the playlist switcher + the "+ Add source" / refresh /
     * bulk-action buttons are hidden — those controls scope to a
     * playlist, but Settings is a global page, so leaving them visible
     * implies (falsely) that switching the playlist changes which
     * settings you're editing. Driven from the shell facade's existing
     * isSettingsRoute computed.
     */
    readonly isSettingsRoute = input(false);
    /**
     * Phone-width (≤640px) drawer toggle for the context panel. The button
     * itself is hidden by CSS above the phone breakpoint, so these inputs
     * only matter on small viewports: `showContextDrawerToggle` reflects
     * whether the current route has panel content to show, and
     * `isContextDrawerOpen` feeds aria-expanded.
     */
    readonly showContextDrawerToggle = input(false);
    readonly isContextDrawerOpen = input(false);
    /**
     * Variant-aware labels: the drawer holds categories on portal routes,
     * type filters on sources/collection routes, and section navigation on
     * the settings route — a fixed "Categories & filters" label would
     * misdescribe two of the three.
     */
    readonly contextDrawerToggleAriaKey = input(
        'WORKSPACE.SHELL.CONTEXT_DRAWER_CATEGORIES_TOGGLE'
    );
    readonly contextDrawerTooltipKey = input(
        'WORKSPACE.SHELL.CONTEXT_DRAWER_CATEGORIES_TOOLTIP'
    );

    readonly searchChanged = output<string>();
    readonly searchSubmitted = output<string>();
    readonly commandPaletteRequested = output<void>();
    readonly shortcutsRequested = output<void>();
    readonly addPlaylistRequested = output<void>();
    readonly headerShortcutRequested = output<void>();
    readonly headerBulkActionRequested = output<void>();
    readonly headerSidebarToggleRequested = output<void>();
    readonly refreshPlaylistRequested = output<void>();
    readonly downloadsRequested = output<void>();
    readonly playlistInfoRequested = output<void>();
    readonly accountInfoRequested = output<void>();
    readonly contextDrawerToggleRequested = output<void>();
    readonly accountInfoForPlaylistRequested = output<PlaylistMeta>();

    focusSearchInput(options: { select?: boolean } = {}): void {
        const inputElement = this.searchInput()?.nativeElement;
        if (!inputElement || inputElement.disabled) {
            return;
        }

        inputElement.focus();
        if (options.select) {
            inputElement.select();
        }
    }

    containsSearchInput(target: EventTarget | null): boolean {
        const inputElement = this.searchInput()?.nativeElement;
        return !!inputElement && target === inputElement;
    }

    onSearchInput(event: Event): void {
        const target = event.target as HTMLInputElement | null;
        this.searchChanged.emit(target?.value ?? '');
    }

    onSearchEnter(event: Event): void {
        const target = event.target as HTMLInputElement | null;
        this.searchSubmitted.emit(target?.value ?? this.searchQuery());
    }

    onPlaylistInfoRequested(): void {
        this.playlistInfoRequested.emit();
    }

    onAccountInfoRequested(): void {
        this.accountInfoRequested.emit();
    }

    onAccountInfoForPlaylistRequested(playlist: PlaylistMeta): void {
        this.accountInfoForPlaylistRequested.emit(playlist);
    }

    onAddPlaylistRequested(): void {
        this.addPlaylistRequested.emit();
    }

    onCommandPaletteRequested(): void {
        this.commandPaletteRequested.emit();
    }

    onShortcutsRequested(): void {
        this.shortcutsRequested.emit();
    }

    onHeaderShortcutRequested(): void {
        this.headerShortcutRequested.emit();
    }

    onHeaderBulkActionRequested(): void {
        this.headerBulkActionRequested.emit();
    }

    onHeaderSidebarToggleRequested(): void {
        this.headerSidebarToggleRequested.emit();
    }

    onRefreshPlaylistRequested(): void {
        this.refreshPlaylistRequested.emit();
    }

    onDownloadsRequested(): void {
        this.downloadsRequested.emit();
    }

    onContextDrawerToggleRequested(): void {
        this.contextDrawerToggleRequested.emit();
    }

    /**
     * Returns focus to the drawer toggle after the drawer closes. Reports
     * whether the toggle actually received focus — after a navigation to a
     * route without a context panel the toggle is gone (and above the phone
     * breakpoint it is display: none, where focus() silently does nothing),
     * and the caller then needs a fallback target.
     */
    focusContextDrawerToggle(): boolean {
        const toggle = this.contextDrawerToggle()?.nativeElement;
        if (!toggle) {
            return false;
        }

        toggle.focus();
        return document.activeElement === toggle;
    }
}
