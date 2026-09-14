import {
    Component,
    EventEmitter,
    Output,
    ChangeDetectionStrategy,
} from '@angular/core';
import {
    FormControl,
    FormGroup,
    ReactiveFormsModule,
    Validators,
} from '@angular/forms';
import { MatInputModule } from '@angular/material/input';
import { TranslatePipe } from '@ngx-translate/core';

@Component({
    selector: 'app-text-import',
    templateUrl: './text-import.component.html',
    styleUrls: ['./text-import.component.scss'],
    changeDetection: ChangeDetectionStrategy.Eager,
    imports: [MatInputModule, ReactiveFormsModule, TranslatePipe],
})
export class TextImportComponent {
    @Output() textAdded = new EventEmitter<string>();

    textForm = new FormGroup({
        text: new FormControl('', Validators.required),
    });

    clearForm(): void {
        this.textForm.reset({
            text: '',
        });
    }
}
