import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { Observable } from 'rxjs';
import {
    MpvPlayerService,
    MpvProcess,
} from '../../services/mpv-player.service';

@Component({
    standalone: true,
    imports: [CommonModule, MatIconModule, MatButtonModule],
    selector: 'app-mpv-player-bar',
    templateUrl: './mpv-player-bar.component.html',
    styleUrls: ['./mpv-player-bar.component.scss'],
})
export class MpvPlayerBarComponent {
    activeProcesses$: Observable<MpvProcess[]>;

    constructor(private mpvPlayerService: MpvPlayerService) {
        this.activeProcesses$ = this.mpvPlayerService.activeProcesses$;
    }

    async closeStream(processId: number): Promise<void> {
        await this.mpvPlayerService.closeStream(processId);
    }

    /* async playStream(processId: number): Promise<void> {
        await this.mpvPlayerService.playStream(processId);
    }

    async pauseStream(processId: number): Promise<void> {
        await this.mpvPlayerService.pauseStream(processId);
    } */
}
