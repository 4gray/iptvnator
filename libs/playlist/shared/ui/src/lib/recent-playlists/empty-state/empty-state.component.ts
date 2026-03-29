import { Component, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';

export type EmptyStateType = 'welcome' | 'no-results';

@Component({
    selector: 'app-empty-state',
    templateUrl: './empty-state.component.html',
    styleUrls: ['./empty-state.component.scss'],
    imports: [MatButtonModule, MatIcon, TranslatePipe],
})
export class EmptyStateComponent {
    readonly type = input.required<EmptyStateType>();
    readonly addPlaylistClicked = output<void>();

    onAddPlaylist(): void {
        this.addPlaylistClicked.emit();
    }
}
