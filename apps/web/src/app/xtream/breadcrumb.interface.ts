import { StalkerPortalActions, XtreamCodeActions } from 'shared-interfaces';

export type PortalActions = StalkerPortalActions | XtreamCodeActions;

export interface Breadcrumb {
    action: PortalActions;
    title: string;
    category_id?: string;
}
