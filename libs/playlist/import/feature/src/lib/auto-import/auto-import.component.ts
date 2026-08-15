import { Component, computed, input, OnInit, output } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { TranslatePipe } from '@ngx-translate/core';
import {
    detectProviderImportCandidates,
    ProviderImportCandidate,
    ProviderImportConfidence,
    ProviderImportKind,
} from '@iptvnator/shared/interfaces';

interface CandidateSummaryRow {
    labelKey: string;
    value: string;
}

const KIND_ICONS: Record<ProviderImportKind, string> = {
    xtream: 'vpn_key',
    stalker: 'cast',
    'm3u-url': 'public',
    'm3u-text': 'subject',
};

const KIND_LABEL_KEYS: Record<ProviderImportKind, string> = {
    xtream: 'HOME.ADD_PLAYLIST.METHOD_XTREAM_LABEL',
    stalker: 'HOME.ADD_PLAYLIST.METHOD_STALKER_LABEL',
    'm3u-url': 'HOME.ADD_PLAYLIST.METHOD_URL_LABEL',
    'm3u-text': 'HOME.ADD_PLAYLIST.METHOD_TEXT_LABEL',
};

const CONFIDENCE_LABEL_KEYS: Record<ProviderImportConfidence, string> = {
    high: 'HOME.AUTO_DETECT.CONFIDENCE_HIGH',
    medium: 'HOME.AUTO_DETECT.CONFIDENCE_MEDIUM',
    low: 'HOME.AUTO_DETECT.CONFIDENCE_LOW',
};

/**
 * "Paste anything from your provider" surface: a free-text area run through
 * the deterministic `detectProviderImportCandidates` on every edit. Each
 * recognized source renders as a card; picking one hands the candidate to the
 * dialog, which switches to the matching import form with the fields
 * prefilled. Detection never adds a playlist by itself — the existing forms
 * (and their behavioral probes) stay the single path into the store.
 */
@Component({
    selector: 'app-auto-import',
    templateUrl: './auto-import.component.html',
    styleUrl: './auto-import.component.scss',
    imports: [
        MatButtonModule,
        MatFormFieldModule,
        MatIcon,
        MatInputModule,
        ReactiveFormsModule,
        TranslatePipe,
    ],
})
export class AutoImportComponent implements OnInit {
    readonly candidateSelected = output<ProviderImportCandidate>();

    /**
     * The pasted text lives in the DIALOG, not here: switching to a prefilled
     * form destroys this component (`@switch`), and coming back to compare or
     * pick another candidate must not cost the user their paste. The dialog
     * feeds the last text back in and listens for edits.
     */
    readonly initialText = input('');
    readonly textChanged = output<string>();

    readonly textControl = new FormControl('', { nonNullable: true });

    private readonly textValue = toSignal(this.textControl.valueChanges, {
        initialValue: '',
    });

    constructor() {
        this.textControl.valueChanges
            .pipe(takeUntilDestroyed())
            .subscribe((value) => this.textChanged.emit(value));
    }

    ngOnInit(): void {
        const initial = this.initialText();
        if (initial) {
            this.textControl.setValue(initial);
        }
    }

    readonly candidates = computed(() =>
        detectProviderImportCandidates(this.textValue())
    );

    readonly hasText = computed(() => this.textValue().trim().length > 0);

    clearForm(): void {
        this.textControl.setValue('');
    }

    selectCandidate(candidate: ProviderImportCandidate): void {
        this.candidateSelected.emit(candidate);
    }

    kindIcon(kind: ProviderImportKind): string {
        return KIND_ICONS[kind];
    }

    kindLabelKey(kind: ProviderImportKind): string {
        return KIND_LABEL_KEYS[kind];
    }

    confidenceLabelKey(confidence: ProviderImportConfidence): string {
        return CONFIDENCE_LABEL_KEYS[confidence];
    }

    /**
     * Rows shown on a candidate card. Labels reuse the import forms' own
     * translation keys so the card vocabulary matches the form it prefills.
     * The password is never rendered — its presence is stated with a mask.
     */
    summaryRows(candidate: ProviderImportCandidate): CandidateSummaryRow[] {
        const rows: CandidateSummaryRow[] = [];
        const push = (labelKey: string, value: string | undefined) => {
            if (value) {
                rows.push({ labelKey, value });
            }
        };
        switch (candidate.kind) {
            case 'm3u-url':
                // get.php links carry the password in their query — the card
                // must not show it while every other password here is masked.
                // The candidate keeps the untouched URL for prefilling.
                push(
                    'HOME.URL_UPLOAD.PLAYLIST_URL',
                    candidate.url?.replace(
                        /([?&]password=)[^&#\s]*/i,
                        '$1••••••'
                    )
                );
                break;
            case 'xtream':
                push(
                    'HOME.XTREAM_PLAYLIST.SERVER_URL',
                    candidate.serverUrl
                );
                push('HOME.XTREAM_PLAYLIST.USERNAME', candidate.username);
                push(
                    'HOME.XTREAM_PLAYLIST.PASSWORD',
                    candidate.password ? '••••••' : undefined
                );
                break;
            case 'stalker':
                push(
                    'HOME.STALKER_PORTAL.SERVER_URL',
                    candidate.portalUrl
                );
                push(
                    'HOME.STALKER_PORTAL.MAC_ADDRESS',
                    candidate.macAddress
                );
                push(
                    'HOME.STALKER_PORTAL.SERIAL_NUMBER',
                    candidate.serialNumber
                );
                push('HOME.STALKER_PORTAL.DEVICE_ID_1', candidate.deviceId1);
                push('HOME.STALKER_PORTAL.DEVICE_ID_2', candidate.deviceId2);
                push('HOME.STALKER_PORTAL.SIGNATURE_1', candidate.signature1);
                push('HOME.STALKER_PORTAL.SIGNATURE_2', candidate.signature2);
                push('HOME.XTREAM_PLAYLIST.USERNAME', candidate.username);
                push(
                    'HOME.XTREAM_PLAYLIST.PASSWORD',
                    candidate.password ? '••••••' : undefined
                );
                break;
            case 'm3u-text':
                break;
        }
        return rows;
    }
}
