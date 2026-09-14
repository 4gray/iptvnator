import { NgTemplateOutlet } from '@angular/common';
import {
    Component,
    TemplateRef,
    input,
    ChangeDetectionStrategy,
} from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';

/**
 * Watch-state metadata block ("About the show / movie"). Rendered by
 * PortalDetailShellComponent below the episodes slot so the hero metadata
 * stays reachable while the player occupies the hero position.
 *
 * Degradation rule: anything missing simply is not rendered — no "N/A"
 * placeholders. Chips and credits are stamped from the host-provided
 * *appDetailTags / *appDetailMeta templates, so the host's own @if guards apply.
 */
@Component({
    selector: 'app-content-about',
    standalone: true,
    imports: [NgTemplateOutlet, TranslateModule],
    template: `
        <section class="about">
            <h3 class="about__heading">{{ 'PORTALS.ABOUT' | translate }}</h3>
            <div class="about__body">
                @if (posterUrl()) {
                    <img
                        class="about__poster"
                        [src]="posterUrl()"
                        [alt]="title() ?? ''"
                        loading="lazy"
                    />
                }
                <div class="about__info">
                    @if (title()) {
                        <h4 class="about__title">{{ title() }}</h4>
                    }
                    @if (tagsTemplate(); as tags) {
                        <div class="about__tags details__tags">
                            <ng-container [ngTemplateOutlet]="tags" />
                        </div>
                    }
                    @if (description()) {
                        <p class="about__description">{{ description() }}</p>
                    }
                    @if (metaTemplate(); as meta) {
                        <div class="about__meta details__meta">
                            <ng-container [ngTemplateOutlet]="meta" />
                        </div>
                    }
                </div>
            </div>
        </section>
    `,
    // eslint-disable-next-line @angular-eslint/prefer-on-push-component-change-detection -- Preserve pre-Angular 22 eager checking during the framework upgrade.
    changeDetection: ChangeDetectionStrategy.Eager,
    styleUrls: ['./content-about.component.scss'],
})
export class ContentAboutComponent {
    readonly title = input<string>();
    readonly posterUrl = input<string>();
    readonly description = input<string>();
    readonly tagsTemplate = input<TemplateRef<unknown> | null>(null);
    readonly metaTemplate = input<TemplateRef<unknown> | null>(null);
}
