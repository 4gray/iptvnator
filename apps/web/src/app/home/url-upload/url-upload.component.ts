import { Component, EventEmitter, inject, OnInit, Output } from '@angular/core';
import {
    FormBuilder,
    FormGroup,
    ReactiveFormsModule,
    Validators,
} from '@angular/forms';
import { MatButton } from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';
import { TranslatePipe } from '@ngx-translate/core';
import { isTauri } from '@tauri-apps/api/core';

@Component({
    selector: 'app-url-upload',
    templateUrl: './url-upload.component.html',
    imports: [MatButton, MatInputModule, ReactiveFormsModule, TranslatePipe],
})
export class UrlUploadComponent implements OnInit {
    private readonly fb = inject(FormBuilder);

    /** Emits url string to the parent component on form submit */
    @Output() urlAdded: EventEmitter<string> = new EventEmitter();

    form: FormGroup;
    isTauri = isTauri();

    ngOnInit() {
        const urlRegex = '(https?://.*?)';
        this.form = this.fb.group({
            playlistUrl: [
                '',
                [Validators.required, Validators.pattern(urlRegex)],
            ],
        });
    }
}
