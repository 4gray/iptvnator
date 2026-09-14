import {
    Component,
    computed,
    input,
    ChangeDetectionStrategy,
} from '@angular/core';

@Component({
    selector: 'app-progress-capsule',
    standalone: true,
    template: `
        <div
            class="progress-capsule"
            [class.progress-capsule--watched]="isWatched()"
        >
            <div
                class="progress-capsule__fill"
                [style.width.%]="progress()"
            ></div>
        </div>
    `,
    // eslint-disable-next-line @angular-eslint/prefer-on-push-component-change-detection -- Preserve pre-Angular 22 eager checking during the framework upgrade.
    changeDetection: ChangeDetectionStrategy.Eager,
    styles: [
        `
            .progress-capsule {
                position: absolute;
                bottom: 0;
                left: 0;
                right: 0;
                height: 5px;
                background: rgba(255, 255, 255, 0.2);
                overflow: hidden;

                &__fill {
                    height: 100%;
                    background: linear-gradient(
                        90deg,
                        #e50914 0%,
                        #ff4d4d 100%
                    );
                    transition: width 0.3s ease-out;
                    border-radius: 0 2px 2px 0;
                }

                &--watched {
                    .progress-capsule__fill {
                        background: linear-gradient(
                            90deg,
                            #46d369 0%,
                            #2ecc71 100%
                        );
                    }
                }
            }
        `,
    ],
})
export class ProgressCapsuleComponent {
    readonly progress = input.required<number>();
    readonly isWatched = computed(() => this.progress() >= 90);
}
