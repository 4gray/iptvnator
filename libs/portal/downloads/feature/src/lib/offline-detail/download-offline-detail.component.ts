import { ChangeDetectionStrategy, Component } from '@angular/core';
import { PortalDetailShellComponent } from '@iptvnator/ui/components';

@Component({
    selector: 'app-download-offline-detail',
    imports: [PortalDetailShellComponent],
    template: '<app-portal-detail-shell [isLoading]="true" />',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DownloadOfflineDetailComponent {}
