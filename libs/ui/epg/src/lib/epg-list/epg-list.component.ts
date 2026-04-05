import {
    ChangeDetectionStrategy,
    Component,
    ElementRef,
    computed,
    effect,
    inject,
    input,
    output,
    signal,
    viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { EpgService } from '@iptvnator/epg/data-access';
import { MomentDatePipe } from '@iptvnator/pipes';
import { Store } from '@ngrx/store';
import { TranslatePipe } from '@ngx-translate/core';
import { EpgActions, selectActive } from 'm3u-state';
import moment from 'moment';
import { Channel, EpgChannel, EpgProgram } from 'shared-interfaces';
import { EpgListItemComponent } from './epg-list-item/epg-list-item.component';

const DATE_FORMAT = 'YYYY-MM-DD';

export interface EpgProgramActivationEvent {
    program: EpgProgram;
    type: 'live' | 'timeshift';
}

@Component({
    imports: [
        EpgListItemComponent,
        MatIcon,
        MatIconButton,
        MatTooltip,
        MomentDatePipe,
        TranslatePipe,
    ],
    selector: 'app-epg-list',
    templateUrl: './epg-list.component.html',
    styleUrls: ['./epg-list.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EpgListComponent {
    readonly controlledChannel = input<Channel | null>(null);
    readonly controlledPrograms = input<EpgProgram[] | null>(null);
    readonly controlledArchiveDays = input<number | null>(null);
    readonly programActivated = output<EpgProgramActivationEvent>();

    private readonly store = inject(Store);
    private readonly epgService = inject(EpgService);

    private readonly activeChannel = toSignal(this.store.select(selectActive), {
        initialValue: null,
    });
    private readonly servicePrograms = toSignal(
        this.epgService.currentEpgPrograms$,
        { initialValue: [] as EpgProgram[] }
    );

    readonly programList = viewChild<ElementRef<HTMLElement>>('programList');
    readonly selectedDate = signal(moment().format(DATE_FORMAT));
    readonly timeNow = signal(new Date().toISOString());
    readonly todayDate = signal(moment().format(DATE_FORMAT));

    readonly isControlled = computed(
        () =>
            this.controlledChannel() !== null ||
            this.controlledPrograms() !== null
    );
    readonly displayChannel = computed(
        () => this.controlledChannel() ?? this.activeChannel()
    );
    readonly channel = computed<EpgChannel | null>(() => {
        const channel = this.displayChannel();
        if (!channel) {
            return null;
        }

        return {
            id: channel.tvg?.id || '',
            displayName: channel.name ? [{ lang: '', value: channel.name }] : [],
            url: channel.url ? [channel.url] : [],
            icon: channel.tvg?.logo ? [{ src: channel.tvg.logo }] : [],
        };
    });
    readonly items = computed(
        () => this.controlledPrograms() ?? this.servicePrograms() ?? []
    );
    readonly archiveDays = computed(() => {
        const controlledArchiveDays = this.controlledArchiveDays();
        if (controlledArchiveDays !== null) {
            return Math.max(0, controlledArchiveDays);
        }

        const channel = this.displayChannel();
        const value =
            channel?.tvg?.rec || channel?.timeshift || channel?.catchup?.days;
        return Math.max(0, Number(value ?? 0) || 0);
    });
    readonly timeshiftUntil = computed(() =>
        moment()
            .subtract(this.archiveDays(), 'days')
            .toISOString()
    );
    readonly filteredItems = computed(() =>
        [...this.items()]
            .filter(
                (item) =>
                    moment(item.start).format(DATE_FORMAT) ===
                    this.selectedDate()
            )
            .sort(
                (left, right) =>
                    getProgramTimeMs(left.start, left.startTimestamp) -
                    getProgramTimeMs(right.start, right.startTimestamp)
            )
    );

    private scrollScheduled = false;
    private activeScrollContextKey: string | null = null;
    private lastAutoScrolledContextKey: string | null = null;

    constructor() {
        effect((onCleanup) => {
            const intervalId = window.setInterval(() => {
                this.timeNow.set(new Date().toISOString());
            }, 30_000);

            onCleanup(() => clearInterval(intervalId));
        });

        effect(() => {
            const programs = this.items();
            const channel = this.displayChannel();

            this.timeNow.set(new Date().toISOString());
            this.todayDate.set(moment().format(DATE_FORMAT));

            if (!this.isControlled()) {
                this.store.dispatch(
                    EpgActions.setEpgAvailableFlag({
                        value: programs.length > 0,
                    })
                );

                if (programs.length > 0) {
                    const currentProgram = this.findCurrentProgram(programs);
                    if (currentProgram) {
                        this.store.dispatch(
                            EpgActions.setCurrentEpgProgram({
                                program: currentProgram,
                            })
                        );
                    } else {
                        this.store.dispatch(EpgActions.resetActiveEpgProgram());
                    }
                } else {
                    this.store.dispatch(EpgActions.resetActiveEpgProgram());
                }
            }

            if (!channel && !this.isControlled()) {
                this.store.dispatch(EpgActions.resetActiveEpgProgram());
            }

            this.updateScrollContext(channel, programs);
            this.scheduleScrollToCurrentProgram();
        });
    }

    changeDate(direction: 'next' | 'prev'): void {
        this.selectedDate.set(
            moment(this.selectedDate())
                [direction === 'next' ? 'add' : 'subtract'](1, 'days')
                .format(DATE_FORMAT)
        );
    }

    activateProgram(program: EpgProgram): void {
        const isLive = this.isProgramPlaying(program);
        const isTimeshift = this.isProgramArchived(program);

        if (!isLive && !isTimeshift) {
            return;
        }

        if (this.isControlled()) {
            this.programActivated.emit({
                program,
                type: isLive ? 'live' : 'timeshift',
            });
            this.timeNow.set(new Date().toISOString());
            return;
        }

        if (isLive) {
            this.store.dispatch(EpgActions.resetActiveEpgProgram());
        } else {
            this.store.dispatch(EpgActions.setActiveEpgProgram({ program }));
        }

        this.timeNow.set(new Date().toISOString());
    }

    canActivateProgram(program: EpgProgram): boolean {
        return this.isProgramPlaying(program) || this.isProgramArchived(program);
    }

    calculateProgress(program: EpgProgram): number {
        const now = Date.now();
        const start = getProgramTimeMs(program.start, program.startTimestamp);
        const stop = getProgramTimeMs(program.stop, program.stopTimestamp);
        const total = stop - start;
        const elapsed = now - start;

        return total > 0 ? Math.min(100, Math.max(0, (elapsed / total) * 100)) : 0;
    }

    isProgramPlaying(program: EpgProgram): boolean {
        const now = Date.now();
        const start = getProgramTimeMs(program.start, program.startTimestamp);
        const stop = getProgramTimeMs(program.stop, program.stopTimestamp);
        return now >= start && now <= stop;
    }

    isProgramArchived(program: EpgProgram): boolean {
        if (this.archiveDays() <= 0) {
            return false;
        }

        const now = Date.now();
        const start = getProgramTimeMs(program.start, program.startTimestamp);
        const stop = getProgramTimeMs(program.stop, program.stopTimestamp);
        const archiveLimit = Date.parse(this.timeshiftUntil());

        return stop < now && start >= archiveLimit;
    }

    private findCurrentProgram(programs: EpgProgram[]): EpgProgram | undefined {
        const now = Date.now();
        return programs.find((program) => {
            const start = getProgramTimeMs(
                program.start,
                program.startTimestamp
            );
            const stop = getProgramTimeMs(program.stop, program.stopTimestamp);
            return now >= start && now <= stop;
        });
    }

    private updateScrollContext(
        channel: Channel | null,
        programs: EpgProgram[]
    ): void {
        const nextContextKey = buildScrollContextKey(channel, programs);
        if (nextContextKey === this.activeScrollContextKey) {
            return;
        }

        this.activeScrollContextKey = nextContextKey;
        this.scrollScheduled = false;
    }

    private scheduleScrollToCurrentProgram(): void {
        if (this.selectedDate() !== moment().format(DATE_FORMAT)) {
            return;
        }

        const scrollContextKey = this.activeScrollContextKey;
        if (
            !scrollContextKey ||
            this.lastAutoScrolledContextKey === scrollContextKey
        ) {
            return;
        }

        if (this.scrollScheduled) {
            return;
        }

        this.scrollScheduled = true;
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                this.scrollScheduled = false;
                this.scrollCurrentProgramIntoView(scrollContextKey);
            });
        });
    }

    private scrollCurrentProgramIntoView(scrollContextKey: string): void {
        const container = this.programList()?.nativeElement;
        const currentProgram = container?.querySelector<HTMLElement>(
            '.program-item.current-program'
        );

        if (!container || !currentProgram) {
            return;
        }

        this.lastAutoScrolledContextKey = scrollContextKey;

        const viewTop = container.scrollTop;
        const viewBottom = viewTop + container.clientHeight;
        const elementTop = currentProgram.offsetTop;
        const elementBottom = elementTop + currentProgram.offsetHeight;

        if (elementTop < viewTop) {
            container.scrollTo({ top: Math.max(elementTop - 16, 0) });
            return;
        }

        if (elementBottom > viewBottom) {
            container.scrollTo({
                top: elementBottom - container.clientHeight + 16,
            });
        }
    }
}

function buildScrollContextKey(
    channel: Channel | null,
    programs: EpgProgram[]
): string | null {
    if (!channel && programs.length === 0) {
        return null;
    }

    const channelKey =
        channel?.tvg?.id || channel?.name || channel?.url || 'unknown-channel';
    const programKey = programs
        .map(
            (program) =>
                `${getProgramTimeMs(program.start, program.startTimestamp)}-${getProgramTimeMs(program.stop, program.stopTimestamp)}`
        )
        .join('|');

    return `${channelKey}:${programKey}`;
}

function getProgramTimeMs(
    isoValue: string,
    timestampValue?: number | null
): number {
    if (Number.isFinite(timestampValue) && Number(timestampValue) > 0) {
        return Number(timestampValue) * 1000;
    }

    return Date.parse(isoValue);
}
