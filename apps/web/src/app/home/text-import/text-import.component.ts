import { Component, EventEmitter, Output } from '@angular/core';
import {
    FormControl,
    FormGroup,
    ReactiveFormsModule,
    Validators,
} from '@angular/forms';
import { MatButton } from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';
import { TranslatePipe } from '@ngx-translate/core';

@Component({
    selector: 'app-text-import',
    templateUrl: './text-import.component.html',
    styleUrls: ['./text-import.component.scss'],
    imports: [MatButton, MatInputModule, ReactiveFormsModule, TranslatePipe],
})
export class TextImportComponent {
    @Output() textAdded = new EventEmitter<string>();

    textForm = new FormGroup({
        text: new FormControl('', Validators.required),
    });
}
