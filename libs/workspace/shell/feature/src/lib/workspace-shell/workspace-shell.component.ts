import {
    Component,
    inject,
} from '@angular/core';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { RouterOutlet } from '@angular/router';
import { ExternalPlaybackDockComponent } from 'components';
import { WorkspaceShellContextSidebarComponent } from './components/workspace-shell-context-sidebar/workspace-shell-context-sidebar.component';
import { WorkspaceShellHeaderComponent } from './components/workspace-shell-header/workspace-shell-header.component';
import { WorkspaceShellRailComponent } from './components/workspace-shell-rail/workspace-shell-rail.component';
import { WorkspaceShellFacade } from './services/workspace-shell.facade';

@Component({
    selector: 'app-workspace-shell',
    imports: [
        ExternalPlaybackDockComponent,
        MatProgressBarModule,
        RouterOutlet,
        WorkspaceShellContextSidebarComponent,
        WorkspaceShellHeaderComponent,
        WorkspaceShellRailComponent,
    ],
    templateUrl: './workspace-shell.component.html',
    styleUrl: './workspace-shell.component.scss',
    providers: [WorkspaceShellFacade],
})
export class WorkspaceShellComponent {
    readonly facade = inject(WorkspaceShellFacade);
}
