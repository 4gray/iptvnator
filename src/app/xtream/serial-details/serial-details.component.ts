import { JsonPipe, NgIf } from '@angular/common';
import { Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { Store } from '@ngrx/store';
import {
    XtreamSerieDetails,
    XtreamSerieEpisode,
} from '../../../../shared/xtream-serie-details.interface';
import { selectCurrentPlaylist } from '../../state/selectors';
import { PlayerDialogComponent } from '../player-dialog/player-dialog.component';
import { SeasonContainerComponent } from '../season-container/season-container.component';

@Component({
    selector: 'app-serial-details',
    templateUrl: './serial-details.component.html',
    styleUrls: ['../detail-view.scss'],
    standalone: true,
    imports: [
        JsonPipe,
        MatButtonModule,
        NgIf,
        SeasonContainerComponent,
        PlayerDialogComponent,
    ],
})
export class SerialDetailsComponent {
    @Input({ required: true }) item: XtreamSerieDetails;

    @Output() playClicked = new EventEmitter<XtreamSerieEpisode>();

    store = inject(Store);
    currentPlaylist = this.store.selectSignal(selectCurrentPlaylist);
}
