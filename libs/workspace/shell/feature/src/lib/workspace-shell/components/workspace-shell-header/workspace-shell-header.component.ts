import {
    ChangeDetectionStrategy,
    Component,
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
import { WorkspaceHeaderBulkAction } from '../../services/helpers/workspace-shell-constants';

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
    readonly canRefreshPlaylist = input(false);
    readonly isRefreshingPlaylist = input(false);
    readonly isElectron = input(false);
    readonly hasNoPlaylists = input(false);
    readonly isDownloadsView = input(false);
    readonly hasActiveDownloads = input(false);
    /**
     * When true the playlist switcher + the "+ Add source" / refresh /
     * bulk-action buttons are hidden — those controls scope to a
     * playlist, but Settings is a global page, so leaving them visible
     * implies (falsely) that switching the playlist changes which
     * settings you're editing. Driven from the shell facade's existing
     * isSettingsRoute computed.
     */
    readonly isSettingsRoute = input(false);

    readonly searchChanged = output<string>();
    readonly searchSubmitted = output<string>();
    readonly commandPaletteRequested = output<void>();
    readonly shortcutsRequested = output<void>();
    readonly addPlaylistRequested = output<void>();
    readonly headerShortcutRequested = output<void>();
    readonly headerBulkActionRequested = output<void>();
    readonly refreshPlaylistRequested = output<void>();
    readonly downloadsRequested = output<void>();
    readonly playlistInfoRequested = output<void>();
    readonly accountInfoRequested = output<void>();

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

    onRefreshPlaylistRequested(): void {
        this.refreshPlaylistRequested.emit();
    }

    onDownloadsRequested(): void {
        this.downloadsRequested.emit();
    }
}
