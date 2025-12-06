import { Component, inject, signal } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { TranslatePipe } from '@ngx-translate/core';
import { PlaylistType, RecentPlaylistsComponent } from 'components';
import { AddPlaylistDialogComponent } from '../shared/components/add-playlist/add-playlist-dialog.component';
import { HeaderComponent } from '../shared/components/header/header.component';

@Component({
    selector: 'app-home',
    templateUrl: './home.component.html',
    styleUrls: ['./home.component.scss'],
    imports: [HeaderComponent, RecentPlaylistsComponent, TranslatePipe],
})
export class HomeComponent {
    private readonly dialog = inject(MatDialog);

    searchQuery = signal<string>('');

    onSearchQueryChange(query: string): void {
        this.searchQuery.set(query);
    }

    onAddPlaylist(playlistType: PlaylistType): void {
        this.dialog.open<AddPlaylistDialogComponent, { type: PlaylistType }>(
            AddPlaylistDialogComponent,
            {
                width: '600px',
                data: { type: playlistType },
            }
        );
    }
}
