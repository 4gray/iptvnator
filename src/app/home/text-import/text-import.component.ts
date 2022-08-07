import { Component, EventEmitter, Output } from '@angular/core';
import { FormControl, FormGroup, Validators } from '@angular/forms';

@Component({
    selector: 'app-text-import',
    templateUrl: './text-import.component.html',
    styleUrls: ['./text-import.component.scss'],
})
export class TextImportComponent {
    @Output() textAdded = new EventEmitter<string>();

    textForm = new FormGroup({
        text: new FormControl('', Validators.required),
    });
}
