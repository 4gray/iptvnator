import {
    Directive,
    EventEmitter,
    HostListener,
    Output,
} from '@angular/core';

@Directive({
    standalone: true,
    selector: '[appDragDropFileUpload]',
})
export class DragDropFileUploadDirective {
    @Output() fileDropped = new EventEmitter<FileList>();
    @Output() dragStateChanged = new EventEmitter<boolean>();

    @HostListener('dragenter', ['$event']) dragEnter(event: DragEvent): void {
        event.preventDefault();
        event.stopPropagation();
        this.dragStateChanged.emit(true);
    }

    @HostListener('dragover', ['$event']) dragOver(event: DragEvent): void {
        event.preventDefault();
        event.stopPropagation();
        if (event.dataTransfer) {
            event.dataTransfer.dropEffect = 'copy';
        }
        this.dragStateChanged.emit(true);
    }

    @HostListener('dragleave', ['$event']) dragLeave(event: DragEvent): void {
        event.preventDefault();
        event.stopPropagation();
        this.dragStateChanged.emit(false);
    }

    @HostListener('drop', ['$event']) drop(event: DragEvent): void {
        event.preventDefault();
        event.stopPropagation();
        this.dragStateChanged.emit(false);
        const files = event.dataTransfer?.files;
        if (files && files.length > 0) {
            this.fileDropped.emit(files);
        }
    }
}
