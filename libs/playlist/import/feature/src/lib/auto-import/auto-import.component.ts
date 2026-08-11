import { Component, computed, output } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
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
export class AutoImportComponent {
    readonly candidateSelected = output<ProviderImportCandidate>();

    readonly textControl = new FormControl('', { nonNullable: true });

    private readonly textValue = toSignal(this.textControl.valueChanges, {
        initialValue: '',
    });

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
                push('HOME.URL_UPLOAD.PLAYLIST_URL', candidate.url);
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
