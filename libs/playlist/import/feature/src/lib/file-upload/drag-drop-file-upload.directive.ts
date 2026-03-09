import {
    Directive,
    EventEmitter,
    HostBinding,
    HostListener,
    Output,
} from '@angular/core';
@Directive({
    standalone: true,
    selector: '[appDragDropFileUpload]',
})
export class DragDropFileUploadDirective {
    readonly defaultColor = 'rgb(255 255 255 / 15%)';
    @Output() fileDropped = new EventEmitter<FileList>();
    @HostBinding('style.background-color') background = this.defaultColor;

    @HostListener('dragover', ['$event']) dragOver(event: DragEvent): void {
        event.preventDefault();
        event.stopPropagation();
        this.background = 'rgb(255 255 255 / 25%)';
    }

    @HostListener('dragleave', ['$event'])
    dragLeave(event: DragEvent): void {
        event.preventDefault();
        event.stopPropagation();
        this.background = this.defaultColor;
    }

    @HostListener('drop', ['$event'])
    drop(event: DragEvent): void {
        event.preventDefault();
        event.stopPropagation();
        this.background = this.defaultColor;
        const files = event.dataTransfer?.files;
        if (files && files.length > 0) {
            this.fileDropped.emit(files);
        }
    }
}
