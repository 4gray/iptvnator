import { DatePipe } from '@angular/common';
import {
    FormControl,
    UntypedFormArray,
    UntypedFormBuilder,
    ValidatorFn,
    Validators,
} from '@angular/forms';
import {
    createStalkerMacAddressValidator,
    normalizeXtreamServerUrl,
    PlaylistMeta,
    validateEpgSourceReferenceControl,
} from '@iptvnator/shared/interfaces';
import { STALKER_PORTAL_URL_PATTERN } from './stalker-playlist-edit.utils';

const nonblankCredential: ValidatorFn = ({ value }) =>
    typeof value === 'string' && value.trim() ? null : { required: true };

// Match the connection contract, including full API URLs and provider subpaths.
const xtreamServerUrl: ValidatorFn = ({ value }) => {
    if (typeof value !== 'string' || !value.trim()) return { required: true };
    try {
        normalizeXtreamServerUrl(value);
        return null;
    } catch {
        return { xtreamServerUrl: true };
    }
};

export function createPlaylistEpgSourceControl(
    value = ''
): FormControl<string> {
    return new FormControl(value, {
        nonNullable: true,
        validators: [validateEpgSourceReferenceControl],
    });
}

export function createPlaylistDetailsForm(
    playlist: PlaylistMeta,
    formBuilder: UntypedFormBuilder,
    datePipe: DatePipe
) {
    const isXtream = Boolean(playlist.serverUrl && !playlist.portalUrl);
    return formBuilder.group({
        _id: playlist._id,
        title: new FormControl(playlist.title, Validators.required),
        userAgent: playlist.userAgent || '',
        filename: new FormControl({
            value: playlist.filename || '',
            disabled: true,
        }),
        count: new FormControl({
            value: playlist.count,
            disabled: true,
        }),
        importDate: new FormControl({
            value: datePipe.transform(playlist.importDate),
            disabled: true,
        }),
        url: new FormControl({
            value: playlist.url,
            disabled: true,
        }),
        filePath: new FormControl({
            value: playlist.filePath,
            disabled: true,
        }),
        autoRefresh: new FormControl(playlist.autoRefresh),
        serverUrl: new FormControl(
            playlist.serverUrl,
            isXtream ? [Validators.required, xtreamServerUrl] : []
        ),
        username: new FormControl(
            playlist.username,
            isXtream ? [Validators.required, nonblankCredential] : []
        ),
        password: new FormControl(
            playlist.password,
            isXtream ? [Validators.required, nonblankCredential] : []
        ),
        macAddress: new FormControl(
            playlist.macAddress,
            // Grandfathered: a playlist stored before this validation
            // existed may hold anything, and on a panel that ignores the
            // MAC it works. Blocking Save over it would strand the user's
            // title/URL/EPG edits too.
            createStalkerMacAddressValidator(playlist.macAddress)
        ),
        portalUrl: new FormControl(
            playlist.portalUrl,
            playlist.portalUrl
                ? [
                      Validators.required,
                      Validators.pattern(STALKER_PORTAL_URL_PATTERN),
                  ]
                : []
        ),
        stalkerSerialNumber: new FormControl(playlist.stalkerSerialNumber),
        stalkerDeviceId1: new FormControl(playlist.stalkerDeviceId1),
        stalkerDeviceId2: new FormControl(playlist.stalkerDeviceId2),
        stalkerSignature1: new FormControl(playlist.stalkerSignature1),
        stalkerSignature2: new FormControl(playlist.stalkerSignature2),
        playlistEpgSourceInputs: new UntypedFormArray([
            createPlaylistEpgSourceControl(),
        ]),
    });
}
