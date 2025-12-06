import { Component, input, output, viewChild } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { TranslatePipe } from '@ngx-translate/core';
import { AddPlaylistMenuComponent, PlaylistType } from '../../add-playlist-menu/add-playlist-menu.component';

export type EmptyStateType = 'welcome' | 'no-results';

@Component({
    selector: 'app-empty-state',
    templateUrl: './empty-state.component.html',
    styleUrls: ['./empty-state.component.scss'],
    imports: [AddPlaylistMenuComponent, MatButtonModule, MatIcon, MatMenuModule, TranslatePipe],
})
export class EmptyStateComponent {
    readonly addPlaylistMenuComponent = viewChild.required(AddPlaylistMenuComponent);
    readonly type = input.required<EmptyStateType>();
    readonly addPlaylistClicked = output<PlaylistType>();

    onAddPlaylist(playlistType: PlaylistType): void {
        this.addPlaylistClicked.emit(playlistType);
    }
}
