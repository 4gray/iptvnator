import { NgIf } from '@angular/common';
import { Component, EventEmitter, OnInit, Output } from '@angular/core';
import {
    FormBuilder,
    FormGroup,
    ReactiveFormsModule,
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

    form: FormGroup;

    isElectron = this.dataService.isElectron;

    constructor(
        private fb: FormBuilder,
        private dataService: DataService
    ) {}

    ngOnInit(): void {
        const urlRegex = '(https?://.*?)';
        this.form = this.fb.group({
            playlistUrl: [
                '',
                [Validators.required, Validators.pattern(urlRegex)],
            ],
        });
    }
}
