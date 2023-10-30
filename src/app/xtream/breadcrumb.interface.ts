import { StalkerPortalActions } from '../../../shared/stalker-portal-actions.enum';
import { XtreamCodeActions } from '../../../shared/xtream-code-actions';

export type PortalActions = StalkerPortalActions | XtreamCodeActions;

export interface Breadcrumb {
    action: PortalActions;
    title: string;
    category_id?: string;
}
