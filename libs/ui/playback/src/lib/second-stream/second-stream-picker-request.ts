import { effect, inject, signal } from '@angular/core';
import { MatDialog, type MatDialogRef } from '@angular/material/dialog';
import { ActivatedRoute } from '@angular/router';
import {
    SecondStreamCatalogService,
    type SecondStreamSelection,
} from '@iptvnator/portal/shared/data-access';
import { dialogSize } from '@iptvnator/ui/components/dialog-size';
import { firstValueFrom } from 'rxjs';
import type {
    CompanionSlot,
    SecondStreamPickerData,
} from './second-stream-open-stream';
import type { SecondStreamPickerComponent } from './second-stream-picker.component';

type PickerRequest = Omit<SecondStreamPickerData, 'initialPlaylist'> & {
    current: () => boolean;
    accept: (
        selection: SecondStreamSelection,
        allowed: () => boolean
    ) => Promise<boolean>;
};

export class SecondStreamPickerRequest {
    private readonly dialog = inject(MatDialog);
    private readonly route = inject(ActivatedRoute, { optional: true });
    private readonly catalog = inject(SecondStreamCatalogService);
    private ref?: MatDialogRef<
        SecondStreamPickerComponent,
        SecondStreamSelection
    >;
    private epoch = 0;
    private current?: () => boolean;
    readonly editing = signal(false);

    constructor() {
        effect(() => {
            if (this.editing() && this.current?.() === false) this.cancel();
        });
    }

    async open({
        current,
        accept,
        ...data
    }: PickerRequest): Promise<CompanionSlot | null> {
        if (this.editing()) return null;
        const route = this.route?.snapshot;
        const epoch = ++this.epoch;
        const requestCurrent = () =>
            this.epoch === epoch && current() && this.route?.snapshot === route;
        this.current = requestCurrent;
        this.editing.set(true);
        try {
            const { SecondStreamPickerComponent } =
                await import('./second-stream-picker.component');
            if (!requestCurrent()) return null;
            this.ref = this.dialog.open<
                SecondStreamPickerComponent,
                SecondStreamPickerData,
                SecondStreamSelection
            >(SecondStreamPickerComponent, {
                ...dialogSize('lg'),
                width: '820px',
                height: 'min(780px, calc(100dvh - 32px))',
                ariaModal: true,
                autoFocus: 'input[type="search"]',
                restoreFocus: false,
                backdropClass: 'second-stream-picker-backdrop',
                data: {
                    ...data,
                    initialPlaylist:
                        [...(route?.pathFromRoot ?? [])]
                            .reverse()
                            .find((entry) =>
                                /^(xtreams|stalker)\/:id$/.test(
                                    entry.routeConfig?.path ?? ''
                                )
                            )
                            ?.paramMap.get('id') ?? undefined,
                },
            });
            const selection = await firstValueFrom(this.ref.afterClosed(), {
                defaultValue: undefined,
            });
            this.ref = undefined;
            if (!selection) return null;
            const allowed = () =>
                requestCurrent() &&
                this.catalog.isAllowed(selection.item) &&
                data.findDuplicateSlot(selection) === undefined;
            return allowed() && (await accept(selection, allowed))
                ? data.slot
                : null;
        } finally {
            this.current = undefined;
            this.ref = undefined;
            this.editing.set(false);
        }
    }

    cancel(): void {
        this.epoch++;
        const ref = this.ref;
        this.ref = undefined;
        ref?.close();
    }
}
