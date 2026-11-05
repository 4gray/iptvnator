import {
    ChangeDetectionStrategy,
    Component,
    computed,
    inject,
} from '@angular/core';
import {
    ImportProgressComponent,
    ImportProgressView,
} from '@iptvnator/ui/components';
import { WorkspaceShellXtreamImportService } from '../../services/workspace-shell-xtream-import.service';

@Component({
    selector: 'app-workspace-shell-import-overlay',
    imports: [ImportProgressComponent],
    templateUrl: './workspace-shell-import-overlay.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkspaceShellImportOverlayComponent {
    protected readonly xtreamImport = inject(WorkspaceShellXtreamImportService);
    protected readonly progressView = computed<ImportProgressView>(() => ({
        title: this.xtreamImport.xtreamImportTitleLabel(),
        source: this.xtreamImport.xtreamImportSourceLabel(),
        tone: this.xtreamImport.xtreamImportPhaseTone(),
        phase: this.xtreamImport.xtreamImportPhaseLabel(),
        detail: this.xtreamImport.xtreamImportDetailLabel(),
        current: this.xtreamImport.xtreamActiveImportCount(),
        total: this.xtreamImport.xtreamActiveItemsToImport(),
        progress: this.xtreamImport.xtreamImportProgressLabel(),
        canCancel: this.xtreamImport.canCancelXtreamImport(),
        cancelling: this.xtreamImport.isCancellingXtreamImport(),
    }));

    onCancel(): void {
        this.xtreamImport.cancelXtreamImport();
    }
}
