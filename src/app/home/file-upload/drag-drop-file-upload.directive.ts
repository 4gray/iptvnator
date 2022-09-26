import {
    Directive,
    EventEmitter,
    HostBinding,
    HostListener,
    Output,
} from '@angular/core';
@Directive({
    selector: '[appDragDropFileUpload]',
})
export class DragDropFileUploadDirective {
    defaultColor = 'rgb(255 255 255 / 15%)';
    @Output() fileDropped = new EventEmitter<any>();
    @HostBinding('style.background-color') background = this.defaultColor;

    @HostListener('dragover', ['$event']) dragOver(event: any) {
        event.preventDefault();
        event.stopPropagation();
        this.background = 'rgb(255 255 255 / 25%)';
    }

    @HostListener('dragleave', ['$event']) public dragLeave(event: any) {
        event.preventDefault();
        event.stopPropagation();
        this.background = this.defaultColor;
    }

    @HostListener('drop', ['$event']) public drop(event: any) {
        event.preventDefault();
        event.stopPropagation();
        this.background = this.defaultColor;
        const files = event.dataTransfer.files;
        if (files.length > 0) {
            this.fileDropped.emit(files);
        }
    }
}
