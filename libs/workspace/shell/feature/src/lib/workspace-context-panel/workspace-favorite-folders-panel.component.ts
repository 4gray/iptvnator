import {
    ChangeDetectionStrategy,
    Component,
    inject,
    input,
} from '@angular/core';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import {
    MatContextMenuTrigger,
    MatMenu,
    MatMenuContent,
    MatMenuItem,
} from '@angular/material/menu';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import { WorkspaceFavoriteFoldersPanelState } from '@iptvnator/portal/shared/util';
import { WorkspaceShellContextDrawerService } from '@iptvnator/workspace/shell/util';

@Component({
    selector: 'app-workspace-favorite-folders-panel',
    imports: [
        MatContextMenuTrigger,
        MatIcon,
        MatIconButton,
        MatMenu,
        MatMenuContent,
        MatMenuItem,
        MatTooltip,
        TranslatePipe,
    ],
    templateUrl: './workspace-favorite-folders-panel.component.html',
    styleUrl: './workspace-favorite-folders-panel.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkspaceFavoriteFoldersPanelComponent {
    private readonly drawer = inject(WorkspaceShellContextDrawerService, {
        optional: true,
    });
    readonly panel = input.required<WorkspaceFavoriteFoldersPanelState>();

    selectFolder(id: string): void {
        this.panel().onSelect(id);
        this.drawer?.close();
    }

    openKeyboardMenu(event: Event, row: HTMLButtonElement): void {
        event.preventDefault();
        const { left, bottom } = row.getBoundingClientRect();
        row.dispatchEvent(
            new MouseEvent('contextmenu', {
                bubbles: true,
                cancelable: true,
                clientX: left,
                clientY: bottom,
            })
        );
    }
}
