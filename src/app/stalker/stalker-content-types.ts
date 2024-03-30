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
    series: {
        title: 'Series',
        getContentAction: StalkerPortalActions.GetOrderedList,
        getCategoryAction: StalkerPortalActions.GetCategories,
        getLink: StalkerPortalActions.CreateLink,
    },
    /* radio: {
        title: 'Radio',
        getContentAction: StalkerPortalActions.GetOrderedList,
        getCategoryAction: StalkerPortalActions.GetOrderedList,
        getLink: StalkerPortalActions.CreateLink,
    }, */
};
