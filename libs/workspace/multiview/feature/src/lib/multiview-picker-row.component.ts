import {
    ChangeDetectionStrategy,
    Component,
    computed,
    inject,
    input,
    signal,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { SettingsStore } from '@iptvnator/services';
import {
    epgDisplayTimeMs,
    type EpgProgram,
} from '@iptvnator/shared/interfaces';
import { TranslatePipe } from '@ngx-translate/core';
import type { MultiviewPickerRow } from './multiview-picker-row';

const MINUTE_MS = 60_000;

/** A programme boundary in display time (with the EPG offset setting). */
function programTime(
    value: string,
    timestamp: number | null | undefined,
    offsetMinutes: number
): number {
    const raw = timestamp ? timestamp * 1000 : Date.parse(value);
    return epgDisplayTimeMs(raw, offsetMinutes);
}

/** "SA" for "Sport Arena": the logo tile of a row without a logo. */
export function initialsOf(name: string): string {
    const words = name.trim().split(/\s+/).filter(Boolean);
    return words
        .slice(0, 2)
        .map((word) => word[0]?.toUpperCase() ?? '')
        .join('');
}

/** Elapsed share and minutes of a running programme, or null. */
export function programProgress(
    program: EpgProgram | null,
    now = Date.now(),
    offsetMinutes = 0
): { readonly percent: number; readonly minutes: number } | null {
    if (!program) return null;
    const start = programTime(
        program.start,
        program.startTimestamp,
        offsetMinutes
    );
    const stop = programTime(
        program.stop,
        program.stopTimestamp,
        offsetMinutes
    );
    if (!Number.isFinite(start) || !Number.isFinite(stop) || stop <= start) {
        return null;
    }
    if (now < start || now >= stop) return null;
    return {
        percent: Math.round(((now - start) / (stop - start)) * 100),
        minutes: Math.floor((now - start) / MINUTE_MS),
    };
}

function clock(
    value: string,
    timestamp: number | null | undefined,
    offsetMinutes: number
): string {
    const date = new Date(programTime(value, timestamp, offsetMinutes));
    return Number.isNaN(date.getTime())
        ? ''
        : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * One row of the picker list (spec 9.5): logo or poster, name, one line of
 * detail and a badge. Live rows show the running programme with a thin
 * progress bar and its elapsed minutes, or LIVE without EPG (D10).
 */
@Component({
    selector: 'app-multiview-picker-row',
    templateUrl: './multiview-picker-row.component.html',
    styleUrl: './multiview-picker-row.component.scss',
    imports: [MatIconModule, TranslatePipe],
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
        role: 'option',
        class: 'mv-picker-row',
        '[class.mv-picker-row--active]': 'active()',
        '[class.mv-picker-row--disabled]': 'disabled()',
        '[attr.aria-selected]': 'active()',
        '[attr.aria-disabled]': 'disabled() || null',
        '[attr.aria-busy]': 'busy() || null',
    },
})
export class MultiviewPickerRowComponent {
    readonly row = input.required<MultiviewPickerRow>();
    readonly program = input<EpgProgram | null>(null);
    readonly active = input(false);
    readonly disabled = input(false);
    readonly busy = input(false);
    readonly failed = input(false);

    readonly item = computed(() => this.row().item);
    /** A logo that fails to load falls back to the initials. */
    readonly imageFailed = signal(false);
    readonly image = computed(() =>
        this.imageFailed()
            ? null
            : this.item().logo || this.item().posterUrl || null
    );
    readonly initials = computed(() => initialsOf(this.item().name));
    private readonly epgOffset = inject(SettingsStore).resolvedEpgOffsetMinutes;
    readonly progress = computed(() =>
        programProgress(this.program(), Date.now(), this.epgOffset())
    );
    readonly times = computed(() => {
        const program = this.program();
        const offset = this.epgOffset();
        return program
            ? `${clock(program.start, program.startTimestamp, offset)}–${clock(
                  program.stop,
                  program.stopTimestamp,
                  offset
              )}`
            : '';
    });
    readonly resumeAt = computed(() => {
        const seconds = this.row().position?.positionSeconds ?? 0;
        if (seconds <= 0) return null;
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        const pad = (value: number) => String(value).padStart(2, '0');
        return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
    });
}
