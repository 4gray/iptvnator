import { Component } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';

@Component({
    selector: 'app-player-view',
    templateUrl: './player-view.component.html',
    standalone: true,
    imports: [MatIconModule, RouterLink],
    styles: [
        `
            .centered {
                text-align: center;
                line-height: 24px;
                margin: 20px;

                .icon {
                    font-size: 64px;
                    height: 64px;
                    width: 64px;
                }
            }
        `,
    ],
})
export class PlayerViewComponent {
    openUrl(url: string) {
        window.open(url, '_blank');
    }
}
