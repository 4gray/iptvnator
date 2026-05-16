import {
    Component,
    EventEmitter,
    Output,
    inject,
    input,
    signal,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import { PlaylistFileImportService } from '@iptvnator/playlist/shared/util';
import { PlaylistSourceVpnConfig } from 'shared-interfaces';
import { DragDropFileUploadDirective } from './drag-drop-file-upload.directive';

const MB = 1024 * 1024;
const KB = 1024;

@Component({
    imports: [DragDropFileUploadDirective, MatIconModule, TranslatePipe],
    selector: 'app-file-upload',
    templateUrl: './file-upload.component.html',
    styleUrls: ['./file-upload.component.scss'],
})
export class FileUploadComponent {
    private readonly importService = inject(PlaylistFileImportService);

    @Output() imported = new EventEmitter<{ title: string }>();
    @Output() fileRejected = new EventEmitter<string>();
    @Output() closeDialog = new EventEmitter<void>();

    readonly selectedFile = signal<File | null>(null);
    readonly isDragging = signal(false);
    readonly isImporting = signal(false);
    readonly sourceVpn = input<PlaylistSourceVpnConfig | undefined>();

    async openPicker(input: HTMLInputElement): Promise<void> {
        if (this.importService.canImportFromNativeDialog()) {
            await this.importFromNativeDialog();
            return;
        }

        input.value = '';
        input.click();
    }

    onDragStateChange(isDragging: boolean): void {
        this.isDragging.set(isDragging);
    }

    onFilesDropped(files: FileList): void {
        this.setFile(files[0]);
    }

    onPicked(input: HTMLInputElement): void {
        const file = input.files?.[0] as (File & { path?: string }) | undefined;
        const pathOverride = input.dataset['filePathOverride'];

        if (file && !file.path && pathOverride) {
            Object.defineProperty(file, 'path', {
                configurable: true,
                value: pathOverride,
            });
        }

        if (file) {
            this.setFile(file);
        }

        delete input.dataset['filePathOverride'];
        input.value = '';
    }

    clearSelection(): void {
        this.selectedFile.set(null);
    }

    async confirm(): Promise<void> {
        const file = this.selectedFile();
        if (!file || this.isImporting()) return;

        this.isImporting.set(true);
        const result = await this.importService.importFile(
            file,
            this.sourceVpn()
        );
        this.isImporting.set(false);

        if (result.ok === true) {
            this.imported.emit({ title: result.title });
            return;
        }

        this.selectedFile.set(null);
        this.fileRejected.emit(file.name);
    }

    formatSize(bytes: number): string {
        if (bytes < KB) return `${bytes} B`;
        if (bytes < MB) return `${(bytes / KB).toFixed(1)} KB`;
        return `${(bytes / MB).toFixed(1)} MB`;
    }

    private setFile(file: File | undefined): void {
        if (!file) return;
        if (!this.importService.isSupportedFile(file)) {
            this.fileRejected.emit(file.name);
            return;
        }
        this.selectedFile.set(file);
    }

    private async importFromNativeDialog(): Promise<void> {
        if (this.isImporting()) return;

        this.isImporting.set(true);
        const result = await this.importService.importFromNativeDialog(
            this.sourceVpn()
        );
        this.isImporting.set(false);

        if (result.ok === true) {
            this.imported.emit({ title: result.title });
            return;
        }

        if (result.reason !== 'cancelled') {
            this.fileRejected.emit('selected playlist');
        }
    }
}
