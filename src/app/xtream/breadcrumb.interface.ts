import { XtreamCodeActions } from '../../../shared/xtream-code-actions';

export interface Breadcrumb {
    action: XtreamCodeActions;
    title: string;
    category_id?: string;
}
