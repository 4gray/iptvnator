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
    selector: 'app-stalker-portal-import',
    templateUrl: './stalker-portal-import.component.html',
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
export class StalkerPortalImportComponent {
    @Output() addClicked = new EventEmitter<void>();
    URL_REGEX = /^(http|https|file):\/\/[^ "]+$/;

    form = new FormGroup({
        _id: new FormControl(uuid()),
        title: new FormControl('', [Validators.required]),
        macAddress: new FormControl('', [Validators.required]),
        password: new FormControl(''),
        username: new FormControl(''),
        portalUrl: new FormControl('', [
            Validators.required,
            Validators.pattern(this.URL_REGEX),
        ]),
        importDate: new FormControl(new Date().toISOString()),
    });

    dataService = inject(DataService);
    store = inject(Store);

    addPlaylist() {
        this.form.value.portalUrl = this.transformPortalUrl(
            this.form.value.portalUrl
        );
        this.store.dispatch(
            addPlaylist({ playlist: this.form.value as Playlist })
        );
        this.addClicked.emit();
    }

    transformPortalUrl(url: string) {
        // if the url ends with "/c" it should be to end with "/portal.php"
        if (url.endsWith('/c')) {
            return url.replace('/c', '/portal.php');
        }

        if (url.endsWith('/c/')) {
            return url.replace('/c/', '/portal.php');
        }

        // if the url ends with "/stalker_portal" it should be extended to "/stalker_portal/server/load.php"
        if (url.endsWith('/stalker_portal')) {
            return url.replace(
                '/stalker_portal/c',
                '/stalker_portal/server/load.php'
            );
        }

        // otherwise keep the provided url
        return url;
    }
}
