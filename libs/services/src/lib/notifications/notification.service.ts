import { inject, Injectable, type Type } from '@angular/core';
import type {
    MatSnackBarConfig,
    MatSnackBarRef,
} from '@angular/material/snack-bar';
import { TranslateService } from '@ngx-translate/core';
import { LazySnackBar } from '../lazy-snack-bar/lazy-snack-bar';

export type NotificationVariant = 'success' | 'info' | 'error';

/**
 * `short` for a confirmation of what the user just did, `default` for the
 * rest, `sticky` stays until the user dismisses it or acts on it.
 */
export type NotificationDuration = 'short' | 'default' | 'sticky';

export const NOTIFICATION_DURATION_MS: Readonly<
    Record<Exclude<NotificationDuration, 'sticky'>, number>
> = { short: 2500, default: 5000 };

/** Interpolation values for a translation key: names, counts, dates. */
export type NotificationParams = object;

/** A translation key and its values, for helpers that pick the message. */
export interface NotificationMessage {
    readonly key: string;
    readonly params?: NotificationParams;
}

export interface NotificationAction {
    /** Translation key of the action button's label. */
    readonly labelKey: string;
    readonly run: () => void;
}

export interface NotificationOptions {
    readonly action?: NotificationAction;
    /** Overrides the variant's preset. */
    readonly duration?: NotificationDuration;
    /** Lifts the toast above a page's bottom save bar (Settings). */
    readonly aboveSaveBar?: boolean;
    /**
     * A machine error code such as `ETIMEDOUT`, shown in brackets after the
     * message. Anything that is not an upper-case code of at most 48
     * characters is dropped, so free provider text never reaches the toast.
     */
    readonly code?: string;
}

export interface NotificationComponentOptions<D> {
    readonly data: D;
    readonly variant?: NotificationVariant;
    /** Milliseconds; a component toast keeps its own timer contract. */
    readonly durationMs?: number;
    readonly aboveSaveBar?: boolean;
}

const CLOSE_KEY = 'CLOSE';
const ERROR_CODE = /^[A-Z][A-Z0-9_]{1,47}$/;

/**
 * The one way the app shows a toast. Every message is a translation key, so
 * an error never shows a provider's or an exception's raw text, and every
 * toast takes the same position, the variant's look
 * (`.app-notification--<variant>` in `styles.scss`) and the variant's
 * politeness: errors are announced assertively (`role="alert"`), the others
 * politely (`role="status"`). Material skips the enter and exit animations
 * under `prefers-reduced-motion: reduce`.
 *
 * The snack-bar module loads on the first toast (`LazySnackBar`), so a root
 * service may inject this one without putting Material on startup.
 * `pnpm run ui:notifications:validate` reports a snack-bar opened anywhere
 * else.
 */
@Injectable({ providedIn: 'root' })
export class NotificationService {
    private readonly lazySnackBar = inject(LazySnackBar);
    private readonly translate = inject(TranslateService);
    /** Counts toast requests: the newest one wins, as Material shows one. */
    private requests = 0;

    /**
     * The sticky action toast's chunk (it imports Material's buttons); a
     * field so specs can substitute it.
     */
    loadActionToast = () =>
        import('./notification-action-toast.component').then(
            (module) => module.NotificationActionToastComponent
        );

    success(
        key: string,
        params?: NotificationParams,
        options?: NotificationOptions
    ): void {
        this.show('success', key, params, options);
    }

    info(
        key: string,
        params?: NotificationParams,
        options?: NotificationOptions
    ): void {
        this.show('info', key, params, options);
    }

    /**
     * Without an action the toast carries a Close button; with one it stays
     * until the user acts on it or dismisses it.
     */
    error(
        key: string,
        params?: NotificationParams,
        options?: NotificationOptions
    ): void {
        this.show('error', key, params, options);
    }

    /**
     * Opens a toast whose body is a component (the source removal's Undo
     * toast), with the shared position, look and politeness. Settles with
     * the ref, or with `null` when the snack-bar chunk failed to load.
     */
    async fromComponent<T, D>(
        component: Type<T>,
        options: NotificationComponentOptions<D>
    ): Promise<MatSnackBarRef<T> | null> {
        this.requests++;
        const variant = options.variant ?? 'info';
        let snackBar;
        try {
            snackBar = await this.lazySnackBar.resolve();
        } catch (error) {
            console.error('Could not open the notification:', error);
            return null;
        }
        return snackBar.openFromComponent(component, {
            ...baseConfig(variant, options.aboveSaveBar === true),
            data: options.data,
            duration: options.durationMs,
        });
    }

    private show(
        variant: NotificationVariant,
        key: string,
        params: NotificationParams | undefined,
        options: NotificationOptions = {}
    ): void {
        const request = ++this.requests;
        const { action } = options;
        const message = withCode(
            this.translate.instant(key, params),
            options.code
        );
        const actionLabel = action
            ? this.translate.instant(action.labelKey)
            : variant === 'error'
              ? this.translate.instant(CLOSE_KEY)
              : undefined;
        const duration = resolveDuration(
            options.duration ?? defaultDuration(variant, Boolean(action))
        );
        const aboveSaveBar = options.aboveSaveBar === true;
        // A text snack-bar has one button: a toast that stays until dismissed
        // also needs Close, so the user is never forced to take the action.
        if (action && duration === undefined) {
            void this.openActionToast(
                request,
                variant,
                message,
                action,
                aboveSaveBar
            );
            return;
        }
        void this.lazySnackBar
            .open(message, actionLabel, {
                ...baseConfig(variant, aboveSaveBar),
                duration,
            })
            .then((ref) => {
                if (ref && action) {
                    ref.onAction().subscribe(() => action.run());
                }
            });
    }

    private openTextToast(
        variant: NotificationVariant,
        message: string,
        action: NotificationAction,
        aboveSaveBar: boolean,
        duration: NotificationDuration
    ): void {
        void this.lazySnackBar
            .open(message, this.translate.instant(action.labelKey), {
                ...baseConfig(variant, aboveSaveBar),
                duration: resolveDuration(duration),
            })
            .then((ref) => ref?.onAction().subscribe(() => action.run()));
    }

    private async openActionToast(
        request: number,
        variant: NotificationVariant,
        message: string,
        action: NotificationAction,
        aboveSaveBar: boolean
    ): Promise<void> {
        let component;
        try {
            component = await this.loadActionToast();
        } catch (error) {
            console.error('Could not open the notification:', error);
        }
        // A newer toast was requested while the chunk loaded: it wins, so
        // this one must not replace it (a source removal's Undo, say).
        if (request !== this.requests) return;
        if (!component) {
            // Still offer the action, as a text toast that times out, since
            // without the component there is no separate Close button.
            this.openTextToast(
                variant,
                message,
                action,
                aboveSaveBar,
                'default'
            );
            return;
        }
        const ref = await this.fromComponent(component, {
            variant,
            aboveSaveBar,
            data: {
                message,
                actionLabel: this.translate.instant(action.labelKey),
                closeLabel: this.translate.instant(CLOSE_KEY),
            },
        });
        ref?.onAction().subscribe(() => action.run());
    }
}

function withCode(message: string, code: string | undefined): string {
    return code && ERROR_CODE.test(code) && !message.includes(`(${code})`)
        ? `${message} (${code})`
        : message;
}

function defaultDuration(
    variant: NotificationVariant,
    hasAction: boolean
): NotificationDuration {
    if (variant === 'success') return 'short';
    if (variant === 'error' && hasAction) return 'sticky';
    return 'default';
}

function resolveDuration(duration: NotificationDuration): number | undefined {
    return duration === 'sticky'
        ? undefined
        : NOTIFICATION_DURATION_MS[duration];
}

function baseConfig(
    variant: NotificationVariant,
    aboveSaveBar: boolean
): MatSnackBarConfig {
    return {
        horizontalPosition: 'center',
        verticalPosition: 'bottom',
        politeness: variant === 'error' ? 'assertive' : 'polite',
        panelClass: [
            'app-notification',
            `app-notification--${variant}`,
            ...(aboveSaveBar ? ['app-notification--above-save-bar'] : []),
        ],
    };
}
