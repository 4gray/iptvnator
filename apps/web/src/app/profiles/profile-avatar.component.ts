import {
    ChangeDetectionStrategy,
    Component,
    computed,
    input,
} from '@angular/core';
import { profileInitial, readableTextColour } from './profile-appearance';

/** The emoji, or the first letter of the name, on the profile's colour. */
@Component({
    selector: 'app-profile-avatar',
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `<span aria-hidden="true">{{ glyph() }}</span>`,
    styles: `
        :host {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            flex: none;
            width: var(--profile-avatar-size, 40px);
            height: var(--profile-avatar-size, 40px);
            border-radius: var(--app-radius-md, 12px);
            font-size: calc(var(--profile-avatar-size, 40px) * 0.5);
            font-weight: 700;
            line-height: 1;
            user-select: none;
        }
    `,
    host: {
        '[style.background-color]': 'colour()',
        '[style.color]': 'textColour()',
    },
})
export class ProfileAvatarComponent {
    readonly name = input.required<string>();
    readonly colour = input.required<string>();
    readonly emoji = input<string | null | undefined>(undefined);

    readonly glyph = computed(
        () => this.emoji() || profileInitial(this.name())
    );
    readonly textColour = computed(() => readableTextColour(this.colour()));
}
