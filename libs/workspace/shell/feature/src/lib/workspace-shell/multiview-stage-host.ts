import {
    ApplicationRef,
    type ComponentRef,
    DestroyRef,
    EnvironmentInjector,
    Injector,
    type Type,
    createComponent,
    effect,
    inject,
    untracked,
} from '@angular/core';
import { MultiviewSessionStore } from '@iptvnator/playback/multiview/data-access';

export interface MultiviewStageHostOptions {
    /** The content frame the stage is appended to. */
    readonly frame: () => HTMLElement | undefined;
    /** The route scroller the stage stays clipped to. */
    readonly clipTo: () => HTMLElement | undefined;
    readonly inert: () => boolean;
    readonly load?: () => Promise<Type<unknown>>;
}

const loadStage = (): Promise<Type<unknown>> =>
    import('@iptvnator/playback/multiview/ui').then(
        (module) => module.MultiviewStageComponent
    );

/**
 * Creates the multiview stage inside the content frame the first time a
 * session starts, and keeps it for the shell's life. Nothing is loaded or
 * rendered before that: the stage and the web players it needs are a lazy
 * chunk, and the shell's own template stays untouched (the launch journey
 * counts its DOM mutations). Must be called in an injection context.
 */
export function hostMultiviewStage(options: MultiviewStageHostOptions): void {
    const store = inject(MultiviewSessionStore);
    const appRef = inject(ApplicationRef);
    const environmentInjector = inject(EnvironmentInjector);
    const elementInjector = inject(Injector);
    let stage: ComponentRef<unknown> | null = null;
    let stageElement: HTMLElement | null = null;
    let loading = false;
    let destroyed = false;

    const sync = (): void => {
        stage?.setInput('clipTo', options.clipTo() ?? null);
        stage?.setInput('inert', options.inert());
    };

    effect(() => {
        const needed = store.exists();
        const frame = options.frame();
        options.clipTo();
        options.inert();
        untracked(() => {
            if (stage) {
                sync();
                return;
            }
            if (!needed || !frame || loading) return;
            loading = true;
            (options.load ?? loadStage)()
                .then((component) => {
                    if (destroyed) return;
                    const hostElement = document.createElement(
                        'app-multiview-stage'
                    );
                    frame.appendChild(hostElement);
                    stageElement = hostElement;
                    stage = createComponent(component, {
                        environmentInjector,
                        elementInjector,
                        hostElement,
                    });
                    appRef.attachView(stage.hostView);
                    sync();
                })
                .catch(() => {
                    // Without the stage the session cannot be seen or left:
                    // end it so the view plays on its own again. The next
                    // session retries the chunk.
                    loading = false;
                    store.end('stage-unavailable');
                });
        });
    });

    inject(DestroyRef).onDestroy(() => {
        destroyed = true;
        stage?.destroy();
        stageElement?.remove();
        stage = null;
    });
}
