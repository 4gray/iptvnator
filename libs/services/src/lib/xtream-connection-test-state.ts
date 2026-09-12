import { computed, DestroyRef, inject, Injector, signal } from '@angular/core';
import { AbstractControl } from '@angular/forms';
import {
    XtreamConnectionTestResult,
    XtreamConnectionTestService,
    XtreamTestConnection,
} from './xtream-connection-test.service';

/** Form-owned state shared by add and edit; closing or editing invalidates work. */
export function createXtreamConnectionTestState(form: AbstractControl) {
    const injector = inject(Injector);
    const destroyRef = inject(DestroyRef);
    const testing = signal(false);
    const result = signal<XtreamConnectionTestResult | null>(null);
    const credentialsMissing = signal(false);
    let generation = 0;
    const changes = form.valueChanges.subscribe(() => {
        generation++;
        result.set(null);
        credentialsMissing.set(false);
        testing.set(false);
    });
    destroyRef.onDestroy(() => {
        generation++;
        changes.unsubscribe();
    });

    const messageKey = computed(() => {
        if (testing()) return 'HOME.XTREAM_PLAYLIST.CONNECTION_TEST.TESTING';
        if (credentialsMissing())
            return 'HOME.XTREAM_PLAYLIST.CONNECTION_TEST.CREDENTIALS_REQUIRED';
        const value = result();
        if (!value) return '';
        const key = value.usedHttpFallback
            ? 'HTTP_CONNECTED'
            : value.failure
              ? value.failure.kind.toUpperCase() + '_ERROR'
              : value.status.toUpperCase();
        return 'HOME.XTREAM_PLAYLIST.CONNECTION_TEST.' + key;
    });

    return {
        testing,
        result,
        messageKey,
        messageParams: computed(() => ({ status: result()?.failure?.status })),
        async test(allowHttpFallback = false): Promise<void> {
            if (testing()) return;
            const connection = form.getRawValue() as XtreamTestConnection;
            if (!connection.username?.trim() || !connection.password?.trim()) {
                result.set(null);
                credentialsMissing.set(true);
                return;
            }
            if (form.invalid) return;
            credentialsMissing.set(false);
            const owned = ++generation;
            const isCurrent = () =>
                owned === generation && !destroyRef.destroyed;
            testing.set(true);
            result.set(null);
            try {
                const response = await injector
                    .get(XtreamConnectionTestService)
                    .test(connection, isCurrent, allowHttpFallback);
                if (!isCurrent()) return;
                if (response.usedHttpFallback) {
                    form.get('serverUrl')?.setValue(response.serverUrl, {
                        emitEvent: false,
                    });
                    form.get('serverUrl')?.markAsDirty();
                }
                result.set(response);
            } catch {
                if (isCurrent())
                    result.set({
                        status: 'unavailable',
                        serverUrl: connection.serverUrl,
                        usedHttpFallback: false,
                    });
            } finally {
                if (isCurrent()) testing.set(false);
            }
        },
    };
}
