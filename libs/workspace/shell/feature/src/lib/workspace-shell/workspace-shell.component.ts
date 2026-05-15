import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ExternalPlaybackDockComponent } from '@iptvnator/ui/components';
import {
    PlaylistDropOverlayComponent,
    PlaylistDropZoneDirective,
} from '../playlist-drop-overlay';
import { WorkspaceShellContextSidebarComponent } from './components/workspace-shell-context-sidebar/workspace-shell-context-sidebar.component';
import { WorkspaceShellHeaderComponent } from './components/workspace-shell-header/workspace-shell-header.component';
import { WorkspaceShellImportOverlayComponent } from './components/workspace-shell-import-overlay/workspace-shell-import-overlay.component';
import { WorkspaceShellRailComponent } from './components/workspace-shell-rail/workspace-shell-rail.component';
import { WorkspaceShellFacade } from './services/workspace-shell.facade';
import { WorkspaceShellXtreamImportService } from './services/workspace-shell-xtream-import.service';
import { WorkspaceShellCommandPaletteService } from './services/workspace-shell-command-palette.service';

@Component({
    selector: 'app-workspace-shell',
    imports: [
        ExternalPlaybackDockComponent,
        PlaylistDropOverlayComponent,
        PlaylistDropZoneDirective,
        RouterOutlet,
        WorkspaceShellContextSidebarComponent,
        WorkspaceShellHeaderComponent,
        WorkspaceShellImportOverlayComponent,
        WorkspaceShellRailComponent,
    ],
    templateUrl: './workspace-shell.component.html',
    styleUrl: './workspace-shell.component.scss',
    providers: [
        WorkspaceShellFacade,
        WorkspaceShellXtreamImportService,
        WorkspaceShellCommandPaletteService,
    ],
})
export class WorkspaceShellComponent {
    readonly facade = inject(WorkspaceShellFacade);
}
