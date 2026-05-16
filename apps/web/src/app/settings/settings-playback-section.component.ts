import { CommonModule } from '@angular/common';
import {
    Component,
    input,
    OnInit,
    output,
    signal,
    ViewEncapsulation,
} from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { TranslateModule } from '@ngx-translate/core';
import {
    BackgroundMetadataWarmupSchedule,
    PROTON_VPN_LOCATION_OPTIONS,
    StreamFormat,
    VideoPlayer,
    VpnIntegrationStatus,
    VpnProvider,
} from 'shared-interfaces';
import { SettingsPlayerOption } from './settings.models';

@Component({
    selector: 'app-settings-playback-section',
    imports: [
        CommonModule,
        MatButtonModule,
        MatCheckboxModule,
        MatFormFieldModule,
        MatIconModule,
        MatInputModule,
        MatSelectModule,
        ReactiveFormsModule,
        TranslateModule,
    ],
    templateUrl: './settings-playback-section.component.html',
    encapsulation: ViewEncapsulation.None,
    styles: [':host { display: contents; }'],
})
export class SettingsPlaybackSectionComponent implements OnInit {
    readonly mpvPlayerArgumentsPlaceholder = [
        '--ontop',
        '--autofit=640x360',
        '--geometry=+80+80',
    ].join('\n');
    readonly vlcPlayerArgumentsPlaceholder = [
        '--video-on-top',
        '--width=640',
        '--height=360',
    ].join('\n');
    readonly metadataWarmupScheduleOptions: Array<{
        value: BackgroundMetadataWarmupSchedule;
        labelKey: string;
    }> = [
        {
            value: 'every-opening',
            labelKey:
                'SETTINGS.BACKGROUND_METADATA_WARMUP_SCHEDULE_EVERY_OPENING',
        },
        {
            value: 'weekly',
            labelKey: 'SETTINGS.BACKGROUND_METADATA_WARMUP_SCHEDULE_WEEKLY',
        },
        {
            value: 'monthly',
            labelKey: 'SETTINGS.BACKGROUND_METADATA_WARMUP_SCHEDULE_MONTHLY',
        },
    ];
    readonly metadataWarmupConcurrencyOptions = [2, 4, 6, 8];
    readonly vpnProviderOptions: Array<{
        value: VpnProvider;
        labelKey: string;
    }> = [
        {
            value: 'none',
            labelKey: 'SETTINGS.VPN_PROVIDER_NONE',
        },
        {
            value: 'proton',
            labelKey: 'SETTINGS.VPN_PROVIDER_PROTON',
        },
    ];
    readonly vpnLocationOptions = PROTON_VPN_LOCATION_OPTIONS;

    readonly form = input.required<FormGroup>();
    readonly activeSection = input.required<string>();
    readonly players = input.required<SettingsPlayerOption[]>();
    readonly streamFormatEnum = input.required<typeof StreamFormat>();
    readonly isDesktop = input(false);
    readonly selectRecordingFolder = output<void>();
    readonly clearMediaMetadataCache = output<void>();
    readonly clearImdbOverrides = output<void>();
    readonly vpnStatus = signal<VpnIntegrationStatus | null>(null);
    readonly vpnStatusLoading = signal(false);

    ngOnInit(): void {
        void this.refreshVpnStatus();
    }

    isExternalPlayerSelected(): boolean {
        const player = this.form().value.player;
        return player === VideoPlayer.MPV || player === VideoPlayer.VLC;
    }

    async refreshVpnStatus(): Promise<void> {
        if (!this.isDesktop() || !window.electron?.getVpnIntegrationStatus) {
            return;
        }

        this.vpnStatusLoading.set(true);
        try {
            this.vpnStatus.set(await window.electron.getVpnIntegrationStatus());
        } catch (error) {
            this.vpnStatus.set({
                enabled: Boolean(this.form().value.vpnIntegrationEnabled),
                provider:
                    (this.form().value.vpnProvider as VpnProvider | null) ??
                    'none',
                location: String(this.form().value.vpnLocation ?? ''),
                platform: window.electron.platform,
                reason: error instanceof Error ? error.message : String(error),
                status: 'failed',
                lastCheckedAt: Date.now(),
            });
        } finally {
            this.vpnStatusLoading.set(false);
        }
    }
}
