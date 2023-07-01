import { JsonPipe, NgIf } from '@angular/common';
import { Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { Store } from '@ngrx/store';
import { OPEN_MPV_PLAYER } from '../../../../shared/ipc-commands';
import { XtreamSerieDetails } from '../../../../shared/xtream-serie-details.interface';
import { DataService } from '../../services/data.service';
import { selectCurrentPlaylist } from '../../state/selectors';
import { SeasonContainerComponent } from '../season-container/season-container.component';

@Component({
    selector: 'app-serial-details',
    templateUrl: './serial-details.component.html',
    styleUrls: ['../detail-view.scss'],
    standalone: true,
    imports: [JsonPipe, MatButtonModule, NgIf, SeasonContainerComponent],
})
export class SerialDetailsComponent {
    @Input({ required: true }) item: XtreamSerieDetails;

    @Output() playClicked = new EventEmitter();

    dialog = inject(MatDialog);
    store = inject(Store);
    dataService = inject(DataService);
    currentPlaylist = this.store.selectSignal(selectCurrentPlaylist);

    playEpisode(episode: any) {
        const { serverUrl, username, password } = this.currentPlaylist();

        const streamUrl = `${serverUrl}/series/${username}/${password}/${episode.id}.${episode.container_extension}`;
        /* this.dialog.open(PlayerDialogComponent, {
            data: streamUrl,
        }); */
        this.dataService.sendIpcEvent(OPEN_MPV_PLAYER, { url: streamUrl });
    }
}
