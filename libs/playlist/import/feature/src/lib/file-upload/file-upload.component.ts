import { Component, EventEmitter, Output, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import { DragDropFileUploadDirective } from './drag-drop-file-upload.directive';

const M3U_EXTENSIONS = ['.m3u', '.m3u8'];
const MB = 1024 * 1024;
const KB = 1024;

@Component({
    imports: [DragDropFileUploadDirective, MatIconModule, TranslatePipe],
    selector: 'app-file-upload',
    templateUrl: './file-upload.component.html',
    styleUrls: ['./file-upload.component.scss'],
})
export class FileUploadComponent {
    @Output() fileSelected = new EventEmitter<{
        uploadEvent: Event;
        file: File;
    }>();
    @Output() fileRejected = new EventEmitter<string>();
    @Output() closeDialog = new EventEmitter<void>();

    readonly selectedFile = signal<File | null>(null);
    readonly isDragging = signal(false);

    openPicker(input: HTMLInputElement): void {
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
        const file = input.files?.[0];
        if (file) {
            this.setFile(file);
        }
        input.value = '';
    }

    clearSelection(): void {
        this.selectedFile.set(null);
    }

    confirm(): void {
        const file = this.selectedFile();
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (uploadEvent) =>
            this.fileSelected.emit({ uploadEvent, file });
        reader.readAsText(file);
    }

    formatSize(bytes: number): string {
        if (bytes < KB) return `${bytes} B`;
        if (bytes < MB) return `${(bytes / KB).toFixed(1)} KB`;
        return `${(bytes / MB).toFixed(1)} MB`;
    }

    private setFile(file: File | undefined): void {
        if (!file) return;
        if (!this.hasAllowedExtension(file.name)) {
            this.fileRejected.emit(file.name);
            return;
        }
        this.selectedFile.set(file);
    }

    private hasAllowedExtension(name: string): boolean {
        const lower = name.toLowerCase();
        return M3U_EXTENSIONS.some((ext) => lower.endsWith(ext));
    }
}
