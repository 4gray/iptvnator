import {
    ChangeDetectionStrategy,
    Component,
    computed,
    input,
    output,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ExternalPlayerSession } from 'shared-interfaces';

@Component({
    selector: 'app-external-playback-dock',
    imports: [MatButtonModule, MatIcon, MatProgressSpinnerModule],
    templateUrl: './external-playback-dock.component.html',
    styleUrl: './external-playback-dock.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExternalPlaybackDockComponent {
    readonly session = input.required<ExternalPlayerSession>();
    readonly compact = input(false);

    readonly closeClicked = output<void>();

    readonly playerLabel = computed(() => this.session().player.toUpperCase());
    readonly statusLabel = computed(() => {
        const session = this.session();
        const player = this.playerLabel();

        switch (session.status) {
            case 'launching':
                return `Opening in ${player}...`;
            case 'opened':
                return `Opened in ${player}`;
            case 'playing':
                return `Playing in ${player}`;
            case 'error':
                return session.error || `${player} failed to launch`;
            default:
                return `${player} closed`;
        }
    });

    readonly showSpinner = computed(
        () => this.session().status === 'launching'
    );
    readonly showCloseButton = computed(
        () => this.session().canClose && this.session().status !== 'error'
    );
}
