import { Component, inject, OnInit } from '@angular/core';
import {
    FormBuilder,
    FormControl,
    FormGroup,
    ReactiveFormsModule,
    Validators,
} from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { TranslatePipe } from '@ngx-translate/core';

@Component({
    selector: 'app-url-upload',
    templateUrl: './url-upload.component.html',
    imports: [
        MatFormFieldModule,
        MatInputModule,
        ReactiveFormsModule,
        TranslatePipe,
    ],
})
export class UrlUploadComponent implements OnInit {
    private readonly fb = inject(FormBuilder);

    form!: FormGroup<{
        playlistName: FormControl<string>;
        playlistUrl: FormControl<string>;
    }>;
    readonly isDesktop = !!window.electron;

    ngOnInit(): void {
        const urlRegex = '(https?://.*?)';
        this.form = this.fb.nonNullable.group({
            playlistUrl: [
                '',
                [Validators.required, Validators.pattern(urlRegex)],
            ],
            playlistName: [''],
        });
    }
}
