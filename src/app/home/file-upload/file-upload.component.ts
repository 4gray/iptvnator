import { Component, EventEmitter, Output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { TranslateModule } from '@ngx-translate/core';
import { DragDropFileUploadDirective } from './drag-drop-file-upload.directive';

@Component({
    standalone: true,
    imports: [DragDropFileUploadDirective, MatIconModule, TranslateModule],
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
    @Output() addClicked = new EventEmitter<void>();

    allowedContentTypes = [
        'application/mpegurl',
        'application/x-mpegurl',
        'application/octet-stream',
        'application/vnd.apple.mpegurl',
        'application/vnd.apple.mpegurl.audio',
        'audio/x-mpegurl',
        'audio/mpegurl',
    ];

    upload(fileList: FileList) {
        if (!this.allowedContentTypes.includes(fileList[0].type)) {
            this.fileRejected.emit(fileList[0].name);
            return;
        }
        const fileReader = new FileReader();
        fileReader.onload = (uploadEvent) =>
            this.fileSelected.emit({
                uploadEvent,
                file: fileList[0],
            });
        fileReader.readAsText(fileList[0]);
        this.addClicked.emit();
    }
}
