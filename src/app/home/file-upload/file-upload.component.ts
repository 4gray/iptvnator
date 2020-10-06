import { Component, EventEmitter, Output } from '@angular/core';
import {
    UploaderOptions,
    UploadFile,
    UploadOutput,
    UploadInput,
} from 'ngx-uploader';

@Component({
    selector: 'app-file-upload',
    templateUrl: './file-upload.component.html',
    styleUrls: ['./file-upload.component.scss'],
})
export class FileUploadComponent {
    /** Array with uploaded files */
    files: UploadFile[] = [];
    /** Upload emitter */
    uploadInput: EventEmitter<UploadInput> = new EventEmitter<UploadInput>();
    /** Drag over flag */
    dragOver: boolean;
    /** ngx-uploader lib options */
    options: UploaderOptions = {
        allowedContentTypes: [
            'application/x-mpegurl',
            'application/octet-stream',
            'application/mpegurl',
            'application/vnd.apple.mpegurl',
            'application/vnd.apple.mpegurl.audio',
            'audio/x-mpegurl',
            'audio/mpegurl',
        ],
        concurrency: 1,
        maxUploads: 1,
    };
    /** Emits on reject event */
    @Output() fileRejected: EventEmitter<string> = new EventEmitter();
    /** Emits after successful file selection */
    @Output() fileSelected: EventEmitter<{
        uploadEvent: Event;
        file: UploadFile;
    }> = new EventEmitter();

    /**
     * Handles file upload
     * @param output
     */
    onUploadOutput(output: UploadOutput): void {
        if (output.type === 'allAddedToQueue') {
            if (this.files.length > 0) {
                const fileReader = new FileReader();
                fileReader.onload = (uploadEvent) =>
                    this.fileSelected.emit({
                        uploadEvent,
                        file: this.files[0],
                    });
                fileReader.readAsText(this.files[0].nativeFile);
            }
        } else if (
            output.type === 'addedToQueue' &&
            typeof output.file !== 'undefined'
        ) {
            this.files.push(output.file);
        } else if (
            output.type === 'uploading' &&
            typeof output.file !== 'undefined'
        ) {
            const index = this.files.findIndex(
                (file) =>
                    typeof output.file !== 'undefined' &&
                    file.id === output.file.id
            );
            this.files[index] = output.file;
        } else if (output.type === 'cancelled' || output.type === 'removed') {
            this.files = this.files.filter(
                (file: UploadFile) => file !== output.file
            );
        } else if (output.type === 'dragOver') {
            this.dragOver = true;
        } else if (output.type === 'dragOut') {
            this.dragOver = false;
        } else if (output.type === 'drop') {
            this.dragOver = false;
        } else if (
            output.type === 'rejected' &&
            typeof output.file !== 'undefined'
        ) {
            this.fileRejected.emit(output.file.name);
        }
    }
}
