import { Component, EventEmitter, Output, inject } from '@angular/core';
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
    @Output() addClicked = new EventEmitter<void>();
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
        const serverUrlAsString = this.form.value.serverUrl as string;
        const url = new URL(serverUrlAsString);
        const serverUrl = `${url.protocol}//${url.hostname}${url.port ? ':' + url.port : ''}`;
        this.store.dispatch(
            addPlaylist({
                playlist: {
                    ...this.form.value,
                    serverUrl,
                } as Playlist,
            })
        );
        this.addClicked.emit();
    }

    extractParams(urlAsString: string): void {
        if (
            this.form.get('username').value !== '' ||
            this.form.get('password').value !== ''
        )
            return;
        try {
            // Create a new URL object from the complete link
            const url = new URL(urlAsString);

            // Extract username and password from query parameters
            const username = url.searchParams.get('username') || '';
            const password = url.searchParams.get('password') || '';

            this.form.get('username')?.setValue(username);
            this.form.get('password')?.setValue(password);
        } catch (error) {
            console.error('Invalid URL', error);
        }
    }
}
