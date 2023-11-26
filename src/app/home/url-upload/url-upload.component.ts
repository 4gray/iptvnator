import { NgIf } from '@angular/common';
import { Component, EventEmitter, OnInit, Output } from '@angular/core';
import {
    ReactiveFormsModule,
    UntypedFormBuilder,
    UntypedFormGroup,
    Validators,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatInputModule } from '@angular/material/input';
import { TranslateModule } from '@ngx-translate/core';
import { DataService } from '../../services/data.service';

@Component({
    standalone: true,
    selector: 'app-url-upload',
    templateUrl: './url-upload.component.html',
    styleUrls: ['./url-upload.component.scss'],
    imports: [
        MatButtonModule,
        MatCardModule,
        MatInputModule,
        NgIf,
        ReactiveFormsModule,
        TranslateModule,
    ],
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
    constructor(
        private fb: UntypedFormBuilder,
        private dataService: DataService
    ) {}

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
