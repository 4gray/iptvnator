import { ClipboardModule } from '@angular/cdk/clipboard';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import { getM3uArchiveDays, isM3uCatchupPlaybackSupported } from 'm3u-utils';
import { Channel } from 'shared-interfaces';

interface ChannelDetailField {
    readonly empty?: boolean;
    readonly labelKey: string;
    readonly monospace?: boolean;
    readonly translateParams?: Record<string, number>;
    readonly value?: string;
    readonly valueKey?: string;
}

interface HeroStat {
    readonly empty?: boolean;
    readonly icon: string;
    readonly labelKey: string;
    readonly mono?: boolean;
    readonly translateParams?: Record<string, number>;
    readonly value?: string;
    readonly valueKey?: string;
}

@Component({
    selector: 'app-channel-details-dialog',
    templateUrl: './channel-details-dialog.component.html',
    styleUrls: ['./channel-details-dialog.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [ClipboardModule, MatButtonModule, MatDialogModule, MatIconModule, TranslatePipe],
})
export class ChannelDetailsDialogComponent {
    readonly channel = inject<Channel>(MAT_DIALOG_DATA);

    readonly archiveDays = getM3uArchiveDays(this.channel);
    readonly catchupAvailable = this.archiveDays > 0;
    readonly catchupPlaybackSupported = isM3uCatchupPlaybackSupported(
        this.channel
    );

    logoError = false;

    readonly hasTvgData = !!(
        this.channel.tvg?.id ||
        this.channel.tvg?.name ||
        this.channel.tvg?.url ||
        this.channel.tvg?.rec
    );

    readonly hasHttpData = !!(
        this.channel.http?.origin ||
        this.channel.http?.referrer ||
        this.channel.http?.['user-agent']
    );

    readonly heroStats: HeroStat[] = [
        {
            icon: 'tag',
            labelKey: 'CHANNELS.DETAILS_DIALOG.CHANNEL_ID',
            value: this.channel.id?.trim() || undefined,
            valueKey: this.channel.id?.trim()
                ? undefined
                : 'CHANNELS.DETAILS_DIALOG.EMPTY',
            mono: true,
            empty: !this.channel.id?.trim(),
        },
        {
            icon: 'folder',
            labelKey: 'CHANNELS.DETAILS_DIALOG.GROUP',
            value: this.channel.group?.title?.trim() || undefined,
            valueKey: this.channel.group?.title?.trim()
                ? undefined
                : 'CHANNELS.DETAILS_DIALOG.EMPTY',
            empty: !this.channel.group?.title?.trim(),
        },
        this.createArchiveHeroStat(),
        {
            icon: 'schedule',
            labelKey: 'CHANNELS.DETAILS_DIALOG.TIMESHIFT',
            value: this.channel.timeshift?.trim() || undefined,
            valueKey: this.channel.timeshift?.trim()
                ? undefined
                : 'CHANNELS.DETAILS_DIALOG.NOT_AVAILABLE',
            empty: !this.channel.timeshift?.trim(),
        },
    ];

    readonly streamFields: ChannelDetailField[] = [
        this.field(
            'CHANNELS.DETAILS_DIALOG.EPG_PARAMS',
            this.channel.epgParams,
            true
        ),
        this.field(
            'CHANNELS.DETAILS_DIALOG.TVG_LOGO',
            this.channel.tvg?.logo,
            true
        ),
    ];

    readonly tvgFields: ChannelDetailField[] = [
        this.field('CHANNELS.DETAILS_DIALOG.TVG_ID', this.channel.tvg?.id, true),
        this.field('CHANNELS.DETAILS_DIALOG.TVG_NAME', this.channel.tvg?.name),
        this.field(
            'CHANNELS.DETAILS_DIALOG.TVG_URL',
            this.channel.tvg?.url,
            true
        ),
        this.field('CHANNELS.DETAILS_DIALOG.TVG_REC', this.channel.tvg?.rec),
    ];

    readonly catchupFields: ChannelDetailField[] = [
        this.field(
            'CHANNELS.DETAILS_DIALOG.CATCHUP_SOURCE',
            this.channel.catchup?.source,
            true
        ),
        this.field(
            'CHANNELS.DETAILS_DIALOG.CATCHUP_DAYS',
            this.channel.catchup?.days
        ),
    ];

    readonly httpFields: ChannelDetailField[] = [
        this.field(
            'CHANNELS.DETAILS_DIALOG.HTTP_ORIGIN',
            this.channel.http?.origin,
            true
        ),
        this.field(
            'CHANNELS.DETAILS_DIALOG.HTTP_REFERRER',
            this.channel.http?.referrer,
            true
        ),
        this.field(
            'CHANNELS.DETAILS_DIALOG.HTTP_USER_AGENT',
            this.channel.http?.['user-agent'],
            true
        ),
    ];

    private createArchiveHeroStat(): HeroStat {
        if (!this.catchupAvailable) {
            return {
                empty: true,
                icon: 'history',
                labelKey: 'CHANNELS.DETAILS_DIALOG.WINDOW',
                valueKey: 'CHANNELS.DETAILS_DIALOG.NOT_AVAILABLE',
            };
        }

        return {
            icon: 'history',
            labelKey: 'CHANNELS.DETAILS_DIALOG.WINDOW',
            translateParams: { count: this.archiveDays },
            valueKey:
                this.archiveDays === 1
                    ? 'CHANNELS.DETAILS_DIALOG.DAYS_ONE'
                    : 'CHANNELS.DETAILS_DIALOG.DAYS_OTHER',
        };
    }

    private field(
        labelKey: string,
        value: string | null | undefined,
        monospace = false
    ): ChannelDetailField {
        const normalized = value?.trim() ?? '';

        if (!normalized) {
            return {
                empty: true,
                labelKey,
                monospace,
                valueKey: 'CHANNELS.DETAILS_DIALOG.EMPTY',
            };
        }

        return { labelKey, monospace, value: normalized };
    }
}
