import {
    ChangeDetectionStrategy,
    Component,
    input,
    output,
    viewChild,
} from '@angular/core';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import {
    AddPlaylistMenuComponent,
    PlaylistSwitcherComponent,
    PlaylistType,
} from '@iptvnator/playlist/shared/ui';
import { WorkspaceHeaderAction } from '@iptvnator/portal/shared/util';
import { WorkspaceHeaderBulkAction } from '../../services/workspace-shell.facade';

@Component({
    selector: 'app-workspace-shell-header',
    imports: [
        AddPlaylistMenuComponent,
        MatIcon,
        MatIconButton,
        MatMenuModule,
        MatTooltip,
        PlaylistSwitcherComponent,
        TranslatePipe,
    ],
    templateUrl: './workspace-shell-header.component.html',
    styleUrl: './workspace-shell-header.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkspaceShellHeaderComponent {
    readonly addPlaylistMenu = viewChild.required(AddPlaylistMenuComponent);

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
    readonly isElectron = input(false);
    readonly isDownloadsView = input(false);
    readonly headerBulkAction = input<WorkspaceHeaderBulkAction | null>(null);

    readonly searchChanged = output<string>();
    readonly searchSubmitted = output<string>();
    readonly commandPaletteRequested = output<void>();
    readonly addPlaylistRequested = output<PlaylistType>();
    readonly globalFavoritesRequested = output<void>();
    readonly headerShortcutRequested = output<void>();
    readonly downloadsRequested = output<void>();
    readonly headerBulkActionRequested = output<void>();
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

    onAddPlaylistRequested(type: PlaylistType): void {
        this.addPlaylistRequested.emit(type);
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

    onDownloadsRequested(): void {
        this.downloadsRequested.emit();
    }

    onHeaderBulkActionRequested(): void {
        this.headerBulkActionRequested.emit();
    }
}
