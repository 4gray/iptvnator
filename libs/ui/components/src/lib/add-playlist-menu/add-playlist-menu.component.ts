import { Component, output, viewChild } from '@angular/core';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatMenu, MatMenuModule } from '@angular/material/menu';
import { TranslateModule } from '@ngx-translate/core';

export type PlaylistType = 'xtream' | 'url' | 'text' | 'file' | 'stalker';

@Component({
    selector: 'app-add-playlist-menu',
    templateUrl: './add-playlist-menu.component.html',
    imports: [MatDividerModule, MatIconModule, MatMenuModule, TranslateModule],
})
export class AddPlaylistMenuComponent {
    readonly menu = viewChild.required<MatMenu>('addPlaylistMenu');

    readonly playlistTypeSelected = output<PlaylistType>();

    onPlaylistTypeClick(type: PlaylistType): void {
        this.playlistTypeSelected.emit(type);
    }
}
