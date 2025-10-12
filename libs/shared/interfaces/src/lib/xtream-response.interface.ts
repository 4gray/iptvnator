import { XtreamCodeActions } from './xtream-code-actions';

export interface XtreamResponse {
    payload: unknown;
    action: XtreamCodeActions;
}
