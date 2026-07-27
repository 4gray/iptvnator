import { FormControl, FormGroup, Validators } from '@angular/forms';
import { v4 as uuid } from 'uuid';

const HTTP_URL_REGEX = /^https?:\/\/[^ "]+$/;

export function createStalkerImportForm(): FormGroup<{
    _id: FormControl<string | null>;
    title: FormControl<string | null>;
    macAddress: FormControl<string | null>;
    serialNumber: FormControl<string | null>;
    deviceId1: FormControl<string | null>;
    deviceId2: FormControl<string | null>;
    signature1: FormControl<string | null>;
    signature2: FormControl<string | null>;
    password: FormControl<string | null>;
    username: FormControl<string | null>;
    portalUrl: FormControl<string | null>;
    importDate: FormControl<string | null>;
    userAgent: FormControl<string | null>;
}> {
    return new FormGroup({
        _id: new FormControl(uuid()),
        title: new FormControl('', [Validators.required]),
        macAddress: new FormControl('', [Validators.required]),
        serialNumber: new FormControl(''),
        deviceId1: new FormControl(''),
        deviceId2: new FormControl(''),
        signature1: new FormControl(''),
        signature2: new FormControl(''),
        password: new FormControl(''),
        username: new FormControl(''),
        portalUrl: new FormControl('', [
            Validators.required,
            Validators.pattern(HTTP_URL_REGEX),
        ]),
        importDate: new FormControl(new Date().toISOString()),
        userAgent: new FormControl(''),
    });
}
