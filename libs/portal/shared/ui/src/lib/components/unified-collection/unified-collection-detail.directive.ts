import { Directive, inject, TemplateRef } from '@angular/core';
import { UnifiedCollectionItem } from '@iptvnator/portal/shared/util';

export interface UnifiedCollectionDetailContext {
    $implicit: UnifiedCollectionItem;
    item: UnifiedCollectionItem;
    close: () => void;
}

@Directive({
    selector: 'ng-template[unifiedCollectionDetail]',
})
export class UnifiedCollectionDetailDirective {
    readonly templateRef = inject(TemplateRef<UnifiedCollectionDetailContext>);
}
