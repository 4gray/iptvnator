import { Component, EventEmitter, OnInit, Output } from '@angular/core';
import { UntypedFormBuilder, UntypedFormGroup, Validators } from '@angular/forms';
import { DataService } from '../../services/data.service';

@Component({
    selector: 'app-url-upload',
    templateUrl: './url-upload.component.html',
    styleUrls: ['./url-upload.component.scss'],
})
export class UrlUploadComponent implements OnInit {
    /** Emits url string to the parent component on form submit */
    @Output() urlAdded: EventEmitter<string> = new EventEmitter();

    /** Form group with playlist url */
    form: UntypedFormGroup;

    /** Is true if app runs in electron-based environment */
    isElectron = this.dataService.isElectron;

    /**
     * Creates an instance of component
     * @param fb angular form builder
     */
    constructor(private fb: UntypedFormBuilder, private dataService: DataService) {}

    ngOnInit(): void {
        const urlRegex = '(https?://.*?)';
        this.form = this.fb.group({
            playlistUrl: [
                '',
                // eslint-disable-next-line @typescript-eslint/unbound-method
                [Validators.required, Validators.pattern(urlRegex)],
            ],
        });
    }
}
