import {
    afterRenderEffect,
    DestroyRef,
    type ElementRef,
    effect,
    inject,
    linkedSignal,
    type Signal,
    signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
    SecondStreamEpgService,
    type SecondStreamChannel,
} from '@iptvnator/portal/shared/data-access';
import {
    EpgPreferencesService,
    EpgSourceSettingsService,
    SettingsStore,
} from '@iptvnator/services';
import type { EpgProgram } from '@iptvnator/shared/interfaces';
import { getProgramTimeMs, summaryProgress } from '@iptvnator/ui/epg';
import { filter, map, scan, timer } from 'rxjs';

interface Preview {
    readonly program: EpgProgram | null;
    readonly refreshAfter: number;
}

/** One queue per open dialog. Scroll and search replace the pending rows. */
export class SecondStreamPickerEpg {
    private readonly service = inject(SecondStreamEpgService);
    private readonly preferences = inject(EpgPreferencesService);
    private readonly settings = inject(SettingsStore);
    private readonly sources = inject(EpgSourceSettingsService);
    private readonly destroy = inject(DestroyRef);
    private readonly offset = this.settings.resolvedEpgOffsetMinutes;
    private readonly now = toSignal(
        timer(0, 30_000).pipe(map(() => Date.now())),
        {
            initialValue: Date.now(),
        }
    );
    private readonly guideRevision = toSignal(
        this.service.xmltvAvailable$.pipe(
            filter(Boolean),
            scan((revision) => revision + 1, 0)
        ),
        { initialValue: 0 }
    );
    private readonly previews = linkedSignal(() => {
        this.preferences.enabled();
        this.offset();
        this.sources.revision();
        this.guideRevision();
        return new Map<string, Preview>();
    });
    private readonly visible = signal<ReadonlySet<string>>(new Set());
    private readonly busy = signal(false);
    private readonly closed = signal(false);

    constructor(
        rows: Signal<readonly SecondStreamChannel[]>,
        elements: Signal<readonly ElementRef<HTMLElement>[]>,
        list: Signal<ElementRef<HTMLElement> | undefined>
    ) {
        afterRenderEffect((cleanup) => {
            const targets = elements();
            const root = list()?.nativeElement;
            if (
                this.closed() ||
                !this.preferences.enabled() ||
                !root ||
                !targets.length
            ) {
                this.visible.set(new Set());
                return;
            }
            const renderedIds = new Set(
                targets.map(
                    ({ nativeElement }) => nativeElement.dataset['epgRow']
                )
            );
            this.visible.update(
                (ids) => new Set([...ids].filter((id) => renderedIds.has(id)))
            );
            const observer = new IntersectionObserver(
                (entries) => {
                    const visible = new Set(this.visible());
                    for (const { target, isIntersecting } of entries) {
                        const id = (target as HTMLElement).dataset['epgRow'];
                        if (!id) continue;
                        if (isIntersecting) visible.add(id);
                        else visible.delete(id);
                    }
                    this.visible.set(visible);
                },
                { root, rootMargin: '68px 0px' }
            );
            for (const target of targets)
                observer.observe(target.nativeElement);
            cleanup(() => observer.disconnect());
        });

        effect(() => {
            if (this.closed() || !this.preferences.enabled() || this.busy())
                return;
            const visible = this.visible();
            const previews = this.previews();
            const now = this.now();
            const batch = rows().filter(
                ({ item }) =>
                    visible.has(item.uid) &&
                    (previews.get(item.uid)?.refreshAfter ?? 0) <= now
            );
            // XMLTV is batched. Portal previews may each make a network request.
            const xmltv = batch.filter(({ item }) => item.sourceType === 'm3u');
            const portals = batch
                .filter(({ item }) => item.sourceType !== 'm3u')
                .slice(0, 4);
            if (xmltv.length || portals.length)
                void this.load([...xmltv, ...portals], previews);
        });
    }

    stop(): void {
        this.closed.set(true);
    }

    program(uid: string): EpgProgram | null {
        const program = this.previews().get(uid)?.program;
        return program && !(this.stopTime(program) <= this.now())
            ? program
            : null;
    }

    progress(program: EpgProgram | null): number {
        if (!program) return 0;
        return (
            summaryProgress(
                {
                    start: getProgramTimeMs(
                        program.start,
                        program.startTimestamp,
                        this.offset()
                    ),
                    stop: this.stopTime(program),
                },
                this.now()
            ) ?? 0
        );
    }

    private stopTime(program: EpgProgram): number {
        return getProgramTimeMs(
            program.stop,
            program.stopTimestamp,
            this.offset()
        );
    }

    private async load(
        rows: SecondStreamChannel[],
        previews: Map<string, Preview>
    ): Promise<void> {
        this.busy.set(true);
        try {
            const programs = await this.service
                .load(rows)
                .catch(() => new Map<string, EpgProgram | null>());
            if (
                this.destroy.destroyed ||
                this.closed() ||
                this.previews() !== previews
            )
                return;
            const next = new Map(previews);
            const now = Date.now();
            for (const { item } of rows) {
                const program = programs.get(item.uid) ?? null;
                const stop = program ? this.stopTime(program) : NaN;
                const refreshAfter =
                    Number.isFinite(stop) && stop > now ? stop : now + 60_000;
                next.set(item.uid, { program, refreshAfter });
            }
            this.previews.set(next);
        } finally {
            if (!this.destroy.destroyed) this.busy.set(false);
        }
    }
}
