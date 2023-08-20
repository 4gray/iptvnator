import { StalkerPortalActions } from '../../../shared/stalker-portal-actions.enum';

export const StalkerContentTypes = {
    stb: {
        doAuth: 'do_auth',
        handshake: 'handshake',
    },
    itv: {
        title: 'Live streams',
        getContentAction: StalkerPortalActions.GetOrderedList,
        getCategoryAction: StalkerPortalActions.GetGenres,
        getLink: StalkerPortalActions.CreateLink,
    },
    vod: {
        title: 'VOD streams',
        getContentAction: StalkerPortalActions.GetOrderedList,
        getCategoryAction: StalkerPortalActions.GetCategories,
        getLink: StalkerPortalActions.CreateLink,
    },
};
