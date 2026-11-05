import {
    ChangeDetectionStrategy,
    Component,
    computed,
    inject,
    input,
} from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import {
    PortalRailLink,
    PortalRailSection,
} from '@iptvnator/portal/shared/util';
import {
    type ServerConnectionState,
    ServerStorageStatusService,
} from '@iptvnator/services';
import { WorkspaceShellRailLinksComponent } from '../workspace-shell-rail-links/workspace-shell-rail-links.component';

@Component({
    selector: 'app-workspace-shell-rail',
    imports: [
        MatIcon,
        MatTooltip,
        RouterLink,
        TranslatePipe,
        WorkspaceShellRailLinksComponent,
    ],
    templateUrl: './workspace-shell-rail.component.html',
    styleUrl: './workspace-shell-rail.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkspaceShellRailComponent {
    readonly isMacOS = input(false);
    readonly workspaceLinks = input<PortalRailLink[]>([]);
    readonly primaryContextLinks = input<PortalRailLink[]>([]);
    readonly secondaryContextLinks = input<PortalRailLink[]>([]);
    readonly selectedSection = input<
        PortalRailSection | string | null | undefined
    >(null);
    readonly railProviderClass = input('rail-context-region');
    readonly isSettingsRoute = input(false);

    /** Self-hosted server storage: hidden while `inactive`. */
    readonly serverState = inject(ServerStorageStatusService).state;
    readonly serverIcon = computed(() => SERVER_ICONS[this.serverState()]);
    readonly serverLabelKey = computed(
        () => SERVER_LABEL_KEYS[this.serverState()]
    );
}

const SERVER_ICONS: Record<ServerConnectionState, string> = {
    inactive: 'dns',
    online: 'dns',
    offline: 'cloud_off',
    unauthorized: 'lock',
};

const SERVER_LABEL_KEYS: Record<ServerConnectionState, string> = {
    inactive: 'SERVER_STORAGE.STATUS_ONLINE',
    online: 'SERVER_STORAGE.STATUS_ONLINE',
    offline: 'SERVER_STORAGE.STATUS_OFFLINE',
    unauthorized: 'SERVER_STORAGE.STATUS_UNAUTHORIZED',
};
