import { Component, inject } from '@angular/core';
import {
    FormControl,
    FormGroup,
    FormsModule,
    ReactiveFormsModule,
    Validators,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { Store } from '@ngrx/store';
import { TranslateModule } from '@ngx-translate/core';
import { v4 as uuid } from 'uuid';
import { Playlist } from '../../../../shared/playlist.interface';
import { DataService } from '../../services/data.service';
import { addPlaylist } from '../../state/actions';

@Component({
    standalone: true,
    imports: [
        FormsModule,
        ReactiveFormsModule,
        MatFormFieldModule,
        MatInputModule,
        MatButtonModule,
        TranslateModule,
    ],
    selector: 'app-xtream-code-import',
    templateUrl: './xtream-code-import.component.html',
    styles: [
        `
            :host {
                display: flex;
                margin: 10px;
                justify-content: center;
            }

            form {
                width: 100%;
            }
        `,
    ],
})
export class XtreamCodeImportComponent {
    URL_REGEX = /^(http|https|file):\/\/[^ "]+$/;

    form = new FormGroup({
        _id: new FormControl(uuid()),
        title: new FormControl('', [Validators.required]),
        password: new FormControl('', [Validators.required]),
        username: new FormControl('', [Validators.required]),
        serverUrl: new FormControl('', [
            Validators.required,
            Validators.pattern(this.URL_REGEX),
        ]),
        importDate: new FormControl(new Date().toISOString()),
    });

    dataService = inject(DataService);
    store = inject(Store);

    addPlaylist() {
        this.store.dispatch(
            addPlaylist({ playlist: this.form.value as Playlist })
        );
    }
}
