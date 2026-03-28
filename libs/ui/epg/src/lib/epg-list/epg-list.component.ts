import {
    ChangeDetectionStrategy,
    Component,
    computed,
    effect,
    ElementRef,
    inject,
    input,
    signal,
    viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
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

@Component({
    imports: [
        EpgListItemComponent,
        FormsModule,
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

    private readonly store = inject(Store);
    private readonly epgService = inject(EpgService);

    private readonly activeChannel = toSignal(
        this.store.select(selectActive),
        { initialValue: null }
    );
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
    readonly timeshiftUntil = computed(() => {
        const channel = this.displayChannel();
        const value =
            channel?.tvg?.rec || channel?.timeshift || channel?.catchup?.days;
        const days = Number(value ?? 0) || 0;
        return moment().subtract(days, 'days').toISOString();
    });
    readonly filteredItems = computed(() =>
        [...this.items()]
            .filter(
                (item) =>
                    moment(item.start).format(DATE_FORMAT) === this.selectedDate()
            )
            .sort((a, b) => moment(a.start).diff(moment(b.start)))
    );

    private scrollScheduled = false;

    constructor() {
        effect((onCleanup) => {
            const programList = this.programList()?.nativeElement;
            if (!programList || typeof ResizeObserver === 'undefined') {
                return;
            }

            const resizeObserver = new ResizeObserver((entries) => {
                const [entry] = entries;
                if (
                    entry &&
                    entry.contentRect.height > 0 &&
                    entry.contentRect.width > 0
                ) {
                    this.scheduleScrollToCurrentProgram();
                }
            });

            resizeObserver.observe(programList);
            onCleanup(() => resizeObserver.disconnect());
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
                        this.store.dispatch(
                            EpgActions.resetActiveEpgProgram()
                        );
                    }
                } else {
                    this.store.dispatch(EpgActions.resetActiveEpgProgram());
                }
            }

            if (!channel && !this.isControlled()) {
                this.store.dispatch(EpgActions.resetActiveEpgProgram());
            }

            this.scheduleScrollToCurrentProgram();
        });
    }

    changeDate(direction: 'next' | 'prev'): void {
        this.selectedDate.set(
            moment(this.selectedDate())
                [direction === 'next' ? 'add' : 'subtract'](1, 'days')
                .format(DATE_FORMAT)
        );
        this.scheduleScrollToCurrentProgram();
    }

    setEpgProgram(
        program: EpgProgram,
        isLive?: boolean,
        timeshift?: boolean
    ): void {
        if (!this.isControlled()) {
            if (isLive) {
                this.store.dispatch(EpgActions.resetActiveEpgProgram());
            } else if (timeshift) {
                this.store.dispatch(
                    EpgActions.setActiveEpgProgram({ program })
                );
            } else {
                return;
            }
        }

        this.timeNow.set(new Date().toISOString());
    }

    calculateProgress(program: EpgProgram): number {
        const now = new Date().getTime();
        const start = new Date(program.start).getTime();
        const stop = new Date(program.stop).getTime();
        const total = stop - start;
        const elapsed = now - start;

        return Math.min(100, Math.max(0, (elapsed / total) * 100));
    }

    isProgramPlaying(program: EpgProgram): boolean {
        const currentTime = this.timeNow();
        return currentTime >= program.start && currentTime <= program.stop;
    }

    private findCurrentProgram(programs: EpgProgram[]): EpgProgram | undefined {
        const now = new Date().toISOString();
        return programs.find((item) => {
            const start = new Date(item.start).toISOString();
            const stop = new Date(item.stop).toISOString();
            return now >= start && now <= stop;
        });
    }

    private scheduleScrollToCurrentProgram(): void {
        if (this.selectedDate() !== moment().format(DATE_FORMAT)) {
            return;
        }

        if (this.scrollScheduled) {
            return;
        }

        this.scrollScheduled = true;
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                this.scrollScheduled = false;
                this.scrollCurrentProgramIntoView();
            });
        });
    }

    private scrollCurrentProgramIntoView(): void {
        const container = this.programList()?.nativeElement;
        const currentProgram = container?.querySelector<HTMLElement>(
            '.program-item.current-program'
        );

        if (!container || !currentProgram) {
            return;
        }

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
                top:
                    elementBottom -
                    container.clientHeight +
                    16,
            });
        }
    }
}
