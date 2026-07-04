import { Directive, TemplateRef, inject } from '@angular/core';

/**
 * Structural template markers used by PortalDetailShellComponent.
 *
 * Hosts wrap their hero chips/meta/actions markup in these templates so the
 * shell can stamp the same content twice: once into the hero (browse state)
 * and once into the About block (watch state). A projected node can only
 * appear once, a TemplateRef can be stamped any number of times.
 */
@Directive({
    selector: '[detailTags]',
    standalone: true,
})
export class DetailTagsTemplateDirective {
    readonly templateRef = inject(TemplateRef);
}

@Directive({
    selector: '[detailMeta]',
    standalone: true,
})
export class DetailMetaTemplateDirective {
    readonly templateRef = inject(TemplateRef);
}

@Directive({
    selector: '[detailActions]',
    standalone: true,
})
export class DetailActionsTemplateDirective {
    readonly templateRef = inject(TemplateRef);
}
