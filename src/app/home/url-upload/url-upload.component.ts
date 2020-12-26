import { Component, Output, EventEmitter } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';

@Component({
    selector: 'app-url-upload',
    templateUrl: './url-upload.component.html',
    styleUrls: ['./url-upload.component.scss'],
})
export class UrlUploadComponent {
    /** Emits url string to the parent component on form submit */
    @Output() urlAdded: EventEmitter<string> = new EventEmitter();

    /** Form group with playlist url */
    form: FormGroup;

    /**
     * Creates an instance of component
     * @param fb angulars form builder
     */
    constructor(private fb: FormBuilder) {
        const urlRegex = '(https?://.*?.(m3u|m3u8))';
        this.form = this.fb.group({
            playlistUrl: [
                '',
                // eslint-disable-next-line @typescript-eslint/unbound-method
                [Validators.required, Validators.pattern(urlRegex)],
            ],
        });
    }
}
