import { Component, Output, EventEmitter } from '@angular/core';

@Component({
    selector: 'app-url-upload',
    templateUrl: './url-upload.component.html',
    styleUrls: ['./url-upload.component.scss'],
})
export class UrlUploadComponent {
    /** Emits url string to the parent component on form submit */
    @Output() urlAdded: EventEmitter<string> = new EventEmitter();
}
