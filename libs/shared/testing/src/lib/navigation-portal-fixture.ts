/** Small provider catalog with only synthetic metadata and inline SVG artwork. */
export const NAVIGATION_PORTAL_ART = `data:image/svg+xml,${encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="360"><rect width="240" height="360" fill="#334155"/><text x="24" y="180" fill="white" font-size="20">SYNTHETIC</text></svg>'
)}`;

export function navigationPortalResponse(params: URLSearchParams): unknown {
    const source = params.get('username') === 'synthetic-b' ? 'B' : 'A';
    const action = params.get('action');
    const duplicates = params.get('username') === 'synthetic-duplicates';
    const movie = (index: number) => ({
        num: index,
        stream_id: 20000 + index,
        name: `Synthetic Film ${source}${index}`,
        stream_type: 'movie',
        category_id: '201',
        stream_icon: NAVIGATION_PORTAL_ART,
        rating: '7',
        added: '1767225600',
        container_extension: 'mp4',
        direct_source: '',
    });
    const series = {
        series_id: 30001,
        name: `Synthetic Series ${source}1`,
        category_id: '301',
        cover: NAVIGATION_PORTAL_ART,
        plot: 'Synthetic series description.',
        rating: '7',
        last_modified: '1767225600',
        episode_run_time: '25',
        backdrop_path: [],
    };

    switch (action) {
        case 'get_live_categories':
            return [];
        case 'get_vod_categories':
            return [
                { category_id: '201', category_name: 'Synthetic Films' },
                ...(duplicates
                    ? [
                          {
                              category_id: '202',
                              category_name: 'Synthetic Duplicate Films',
                          },
                      ]
                    : []),
            ];
        case 'get_series_categories':
            return [
                { category_id: '301', category_name: 'Synthetic Series' },
                ...(duplicates
                    ? [
                          {
                              category_id: '302',
                              category_name: 'Synthetic Duplicate Series',
                          },
                      ]
                    : []),
            ];
        case 'get_live_streams':
            return [];
        case 'get_vod_streams':
            return [
                movie(1),
                movie(2),
                ...(duplicates ? [{ ...movie(1), category_id: '202' }] : []),
            ];
        case 'get_series':
            return [
                series,
                ...(duplicates ? [{ ...series, category_id: '302' }] : []),
            ];
        case 'get_vod_info': {
            const item = movie(Number(params.get('vod_id') ?? '20001') - 20000);
            return {
                info: {
                    name: item.name,
                    movie_image: NAVIGATION_PORTAL_ART,
                    plot: 'Synthetic film description.',
                    duration_secs: 3600,
                    rating: '7',
                    backdrop_path: [],
                },
                movie_data: item,
            };
        }
        case 'get_series_info':
            return {
                info: series,
                seasons: [],
                episodes: {
                    '1': [
                        {
                            id: '50001',
                            episode_num: 1,
                            season: 1,
                            title: `Synthetic Episode ${source}1`,
                            container_extension: 'mp4',
                            info: {
                                duration_secs: 1500,
                                movie_image: NAVIGATION_PORTAL_ART,
                            },
                        },
                    ],
                },
            };
        default:
            return {
                user_info: {
                    username: params.get('username'),
                    password: 'synthetic-only',
                    auth: 1,
                    status: 'Active',
                    exp_date: '4102444800',
                    allowed_output_formats: ['ts'],
                },
                server_info: { url: 'synthetic.invalid', timezone: 'UTC' },
            };
    }
}
