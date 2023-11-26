import { Component, EventEmitter, Output } from '@angular/core';
import {
    FormControl,
    FormGroup,
    ReactiveFormsModule,
    Validators,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';
import { TranslateModule } from '@ngx-translate/core';

@Component({
    standalone: true,
    selector: 'app-text-import',
    templateUrl: './text-import.component.html',
    styleUrls: ['./text-import.component.scss'],
    imports: [
        MatButtonModule,
        MatInputModule,
        ReactiveFormsModule,
        TranslateModule,
    ],
})
export class TextImportComponent {
    @Output() textAdded = new EventEmitter<string>();

    textForm = new FormGroup({
        text: new FormControl('', Validators.required),
    });
}
