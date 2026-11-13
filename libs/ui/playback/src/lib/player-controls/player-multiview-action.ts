import {
    Directive,
    InjectionToken,
    type Signal,
    TemplateRef,
    ViewContainerRef,
    inject,
} from '@angular/core';

/**
 * The shared dock's "Multiview" action (multiview spec 9.1). A host that can
 * start or extend a multiview session provides it above the player; without
 * a provider the dock renders no button at all.
 */
export interface PlayerMultiviewAction {
    /** False keeps the button visible but inert (e.g. MPV/VLC selected). */
    readonly enabled: Signal<boolean>;
    /** Tooltip translation key while disabled. */
    readonly disabledReasonKey?: string;
    /** Opens the multiview source picker. */
    run(): void;
}

export const PLAYER_MULTIVIEW_ACTION =
    new InjectionToken<PlayerMultiviewAction>('PLAYER_MULTIVIEW_ACTION');

interface PlayerMultiviewActionContext {
    readonly $implicit: PlayerMultiviewAction;
}

/**
 * Stamps its template once, with the provided action as `let-action`, only
 * when a host provides {@link PLAYER_MULTIVIEW_ACTION}. Keeping the button
 * markup in the dock template keeps the dock's own icon-button styles.
 */
@Directive({ selector: '[appPlayerMultiviewAction]' })
export class PlayerMultiviewActionDirective {
    constructor() {
        const action = inject(PLAYER_MULTIVIEW_ACTION, { optional: true });
        if (action) {
            inject(ViewContainerRef).createEmbeddedView(
                inject(TemplateRef<PlayerMultiviewActionContext>),
                { $implicit: action }
            );
        }
    }

    /** Types `let-action` for strict template checking. */
    static ngTemplateContextGuard(
        _directive: PlayerMultiviewActionDirective,
        // Angular's guard convention: the parameter exists for the predicate.
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        context: unknown
    ): context is PlayerMultiviewActionContext {
        return true;
    }
}
