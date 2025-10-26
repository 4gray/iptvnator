import { Component } from '@angular/core';

@Component({
    /* imports: [MatIcon, MatIconButton], */
    selector: 'app-mpv-player-bar',
    templateUrl: './mpv-player-bar.component.html',
    styleUrls: ['./mpv-player-bar.component.scss'],
})
export class MpvPlayerBarComponent {
    /* private mpvPlayerService = inject(MpvPlayerService);

    activeProcesses$ = this.mpvPlayerService.activeProcesses$;
    
    async closeStream(processId: number): Promise<void> {
        await this.mpvPlayerService.closeStream(processId);
    } */
    /* async playStream(processId: number): Promise<void> {
        await this.mpvPlayerService.playStream(processId);
    }

    async pauseStream(processId: number): Promise<void> {
        await this.mpvPlayerService.pauseStream(processId);
    } */
}
