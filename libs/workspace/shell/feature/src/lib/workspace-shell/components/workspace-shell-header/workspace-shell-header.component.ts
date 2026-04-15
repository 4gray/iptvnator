import {
    ChangeDetectionStrategy,
    Component,
    input,
    output,
} from '@angular/core';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import { PlaylistSwitcherComponent } from '@iptvnator/playlist/shared/ui';
import { WorkspaceHeaderAction } from '@iptvnator/portal/shared/util';

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
    readonly isGlobalFavoritesActive = input(false);
    readonly headerShortcut = input<WorkspaceHeaderAction | null>(null);
    readonly canRefreshPlaylist = input(false);
    readonly isRefreshingPlaylist = input(false);
    readonly isElectron = input(false);
    readonly isDownloadsView = input(false);
    readonly hasActiveDownloads = input(false);

    readonly searchChanged = output<string>();
    readonly searchSubmitted = output<string>();
    readonly commandPaletteRequested = output<void>();
    readonly addPlaylistRequested = output<void>();
    readonly globalFavoritesRequested = output<void>();
    readonly headerShortcutRequested = output<void>();
    readonly refreshPlaylistRequested = output<void>();
    readonly downloadsRequested = output<void>();
    readonly playlistInfoRequested = output<void>();
    readonly accountInfoRequested = output<void>();

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

    onGlobalFavoritesRequested(): void {
        this.globalFavoritesRequested.emit();
    }

    onHeaderShortcutRequested(): void {
        this.headerShortcutRequested.emit();
    }

    onRefreshPlaylistRequested(): void {
        this.refreshPlaylistRequested.emit();
    }

    onDownloadsRequested(): void {
        this.downloadsRequested.emit();
    }
}
