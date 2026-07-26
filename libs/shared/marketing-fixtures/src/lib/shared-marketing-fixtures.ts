/* eslint-disable max-lines -- This file is a single static, provider-neutral catalog with no behavior. */

export type MarketingMovieCategoryKey =
    'action-mystery' | 'future-fantasy' | 'family-comedy' | 'drama-documentary';

export type MarketingMovieFixture = {
    actors: string;
    categoryKey: MarketingMovieCategoryKey;
    description: string;
    director: string;
    genre: string;
    name: string;
    rating: number;
    slug: string;
    tagline: string;
    year: number;
};

export const NEW_MARKETING_MOVIES = [
    {
        categoryKey: 'action-mystery',
        name: 'Black Harbor',
        slug: 'black-harbor',
        description:
            'A dock inspector follows a missing cargo ledger through a fogbound harbor where every night crew remembers a different ship.',
        director: 'Nadia Rook',
        actors: 'Mara Venn, Elias Shore, Tomas Bell, June Cross',
        genre: 'Maritime Crime Thriller',
        rating: 8.2,
        tagline: 'Every tide returns a secret.',
        year: 2026,
    },
    {
        categoryKey: 'family-comedy',
        name: 'The Paper Astronaut',
        slug: 'the-paper-astronaut',
        description:
            'A careful paper astronaut crosses a handmade bedroom universe to return one fallen star before morning.',
        director: 'Lumi North',
        actors: 'Kit Arden, Orla Moss, Finn Vale, Mina Hart',
        genre: 'Stop-Motion Family Animation',
        rating: 8.6,
        tagline: 'Fold a small world. Take a giant step.',
        year: 2026,
    },
    {
        categoryKey: 'drama-documentary',
        name: 'Summer Static',
        slug: 'summer-static',
        description:
            'Four friends rebuild an abandoned community radio booth during the final week before their coastal town changes forever.',
        director: 'Elise March',
        actors: 'Ari Cole, Leni Wynn, Milo Reed, Tessa Vale',
        genre: 'Coming-of-Age Drama',
        rating: 8.0,
        tagline: 'The clearest signal never lasts.',
        year: 2025,
    },
    {
        categoryKey: 'action-mystery',
        name: 'House of Tides',
        slug: 'house-of-tides',
        description:
            'A marine surveyor returns to a cliff house whose rooms appear only when the winter tide retreats.',
        director: 'Iris Shore',
        actors: 'Rhea Voss, Owen Marr, Selah Quinn, Bram North',
        genre: 'Gothic Coastal Mystery',
        rating: 8.3,
        tagline: 'The sea leaves one door open.',
        year: 2025,
    },
    {
        categoryKey: 'family-comedy',
        name: 'Open Late',
        slug: 'open-late',
        description:
            'Three exhausted night-shift clerks turn a quiet neighborhood shop into an accidental refuge before sunrise.',
        director: 'Milo Hart',
        actors: 'Clara Moss, Ben Rowe, Juno Pike, Evelyn Cole',
        genre: 'Workplace Comedy',
        rating: 7.8,
        tagline: 'Nothing ordinary happens after midnight.',
        year: 2026,
    },
    {
        categoryKey: 'action-mystery',
        name: 'White Room Six',
        slug: 'white-room-six',
        description:
            'A sleep researcher wakes inside her own clinical trial with five empty rooms and a recording she does not remember making.',
        director: 'Noah Venn',
        actors: 'Amara Cross, Theo Holt, Cora Wynn, Elias Vale',
        genre: 'Psychological Thriller',
        rating: 8.1,
        tagline: 'The experiment ended yesterday.',
        year: 2026,
    },
    {
        categoryKey: 'drama-documentary',
        name: 'Field Notes',
        slug: 'field-notes',
        description:
            'A patient botanist documents the last flowering season of an overlooked wetland and the people protecting it.',
        director: 'Ruth Arden',
        actors: 'Nora Bell, Kai March, Mina Shore, Owen Reed',
        genre: 'Nature Documentary',
        rating: 8.5,
        tagline: 'Look closely before it changes.',
        year: 2024,
    },
    {
        categoryKey: 'drama-documentary',
        name: 'A Thousand Steps',
        slug: 'a-thousand-steps',
        description:
            'A retired mountain guide returns to a vertical race carrying a promise made twenty years earlier.',
        director: 'Tomas North',
        actors: 'Darius Holt, Lina Cross, Rafi Bell, Selah Moss',
        genre: 'Mountain Sports Drama',
        rating: 8.2,
        tagline: 'The summit is not the finish.',
        year: 2025,
    },
    {
        categoryKey: 'drama-documentary',
        name: 'The Small Hours',
        slug: 'the-small-hours',
        description:
            'Two strangers waiting for the first tram walk through a sleeping city and borrow one honest night from their real lives.',
        director: 'Mara Shore',
        actors: 'Nadia Wynn, Julian Hart, Elise Vale, Theo Reed',
        genre: 'Urban Romantic Drama',
        rating: 8.0,
        tagline: 'Morning can wait one more stop.',
        year: 2024,
    },
    {
        categoryKey: 'action-mystery',
        name: 'Copper Rain',
        slug: 'copper-rain',
        description:
            'A municipal photographer discovers the same copper umbrella at every unexplained blackout across the old city.',
        director: 'Ren Voss',
        actors: 'Iris Marr, Leo Cross, Omar Vale, June Hart',
        genre: 'Neo-Noir Mystery',
        rating: 8.1,
        tagline: 'Some reflections arrive first.',
        year: 2025,
    },
    {
        categoryKey: 'future-fantasy',
        name: 'Willow Engine',
        slug: 'willow-engine',
        description:
            'A young mechanic awakens a walking wooden engine and follows it into a valley disappearing from every map.',
        director: 'Talia Moss',
        actors: 'Lumi Vale, Kit Shore, Orla Reed, Finn Arden',
        genre: 'Family Fantasy Adventure',
        rating: 8.4,
        tagline: 'Every old tree remembers a road.',
        year: 2026,
    },
    {
        categoryKey: 'drama-documentary',
        name: 'Quiet Thunder',
        slug: 'quiet-thunder',
        description:
            'A widowed horse trainer and her estranged son prepare one stubborn mare for the final county storm season.',
        director: 'Owen Rook',
        actors: 'Tessa Marr, Adrian Cole, Ruth Bell, Nico Hart',
        genre: 'Contemporary Western Drama',
        rating: 7.9,
        tagline: 'The land speaks before the sky.',
        year: 2024,
    },
    {
        categoryKey: 'family-comedy',
        name: 'Parallel Kitchens',
        slug: 'parallel-kitchens',
        description:
            'Two rival cooks discover matching pantry doors that open into each other’s restaurants in neighboring realities.',
        director: 'Cora March',
        actors: 'Mina Wynn, Elias Rowe, Bram Pike, Juno Vale',
        genre: 'Science-Fiction Comedy',
        rating: 7.9,
        tagline: 'Dinner is served twice.',
        year: 2026,
    },
    {
        categoryKey: 'drama-documentary',
        name: 'First String',
        slug: 'first-string',
        description:
            'A reserve orchestra cellist receives one unexpected solo and twenty-four hours to decide whose career it will replace.',
        director: 'Lina Venn',
        actors: 'Amara Moss, Theo North, Clara Shore, Ren Hart',
        genre: 'Music Drama',
        rating: 8.3,
        tagline: 'One note changes every seat.',
        year: 2025,
    },
    {
        categoryKey: 'action-mystery',
        name: 'The Long Museum',
        slug: 'the-long-museum',
        description:
            'An overnight guard follows a newly appeared corridor through galleries that display tomorrow’s missing objects.',
        director: 'June Vale',
        actors: 'Bram Cole, Iris Wynn, Selah Hart, Rafi Cross',
        genre: 'Art Mystery',
        rating: 8.2,
        tagline: 'The newest room has always been there.',
        year: 2026,
    },
    {
        categoryKey: 'family-comedy',
        name: 'Cloud Hotel',
        slug: 'cloud-hotel',
        description:
            'A shy apprentice opens a tiny floating hotel for weather creatures stranded between seasons.',
        director: 'Orla March',
        actors: 'Lumi Bell, Kit Vale, Finn Moss, Ari Shore',
        genre: 'Animated Family Fantasy',
        rating: 8.5,
        tagline: 'Every storm needs somewhere to rest.',
        year: 2026,
    },
    {
        categoryKey: 'family-comedy',
        name: 'Unpaid Overtime',
        slug: 'unpaid-overtime',
        description:
            'Five office workers locked in after hours attempt to finish one impossible presentation without doing any more work.',
        director: 'Milo Cross',
        actors: 'Cora Hart, Ben Vale, Juno Moss, Adrian Reed',
        genre: 'Office Satire',
        rating: 7.7,
        tagline: 'The deadline already went home.',
        year: 2025,
    },
    {
        categoryKey: 'action-mystery',
        name: 'Deep Green',
        slug: 'deep-green',
        description:
            'Two cave ecologists follow an underground forest beyond the mapped air line after their only exit floods.',
        director: 'Nadia Holt',
        actors: 'Rhea Shore, Elias North, Mina Cross, Tomas Bell',
        genre: 'Survival Adventure',
        rating: 8.0,
        tagline: 'Below the roots, keep breathing.',
        year: 2026,
    },
    {
        categoryKey: 'drama-documentary',
        name: 'November Radio',
        slug: 'november-radio',
        description:
            'In 1978, a remote weather announcer keeps broadcasting through a mountain blackout to listeners she cannot hear.',
        director: 'Elena Rook',
        actors: 'Mara Voss, Owen Hart, Ruth Vale, Theo March',
        genre: 'Period Drama',
        rating: 8.4,
        tagline: 'Stay with the signal.',
        year: 2024,
    },
    {
        categoryKey: 'drama-documentary',
        name: 'The Last Orange',
        slug: 'the-last-orange',
        description:
            'Three generations gather to harvest a failing seaside orchard and divide everything except the final fruit.',
        director: 'Iris Cole',
        actors: 'Evelyn Shore, Nadia Bell, Leo Hart, Mina Vale',
        genre: 'Mediterranean Family Drama',
        rating: 8.1,
        tagline: 'Some inheritances must be shared.',
        year: 2025,
    },
] as const satisfies readonly MarketingMovieFixture[];

export const EXISTING_MARKETING_MOVIES = [
    {
        categoryKey: 'drama-documentary',
        name: 'Orchard Walls',
        slug: 'orchard-walls',
        description:
            'A quiet prison gardener and a new volunteer rebuild an abandoned orchard while both reconsider the lives waiting beyond its walls.',
        director: 'Elena March',
        actors: 'Darius Cole, Mina Hart, Ruth Bell, Owen Pike',
        genre: 'Human Drama',
        rating: 8.4,
        tagline: 'Some walls are grown, not built.',
        year: 2025,
    },
    {
        categoryKey: 'family-comedy',
        name: 'Blue Current',
        slug: 'blue-current',
        description:
            'A young reef fish and an anxious lantern companion cross a changing ocean current to guide their family home.',
        director: 'Talia North',
        actors: 'Lumi Vale, Finn Reed, Orla Moss, Kit Arden',
        genre: 'Animated Family Adventure',
        rating: 8.6,
        tagline: 'The smallest light can find the way.',
        year: 2026,
    },
    {
        categoryKey: 'action-mystery',
        name: 'Signal Nine',
        slug: 'signal-nine',
        description:
            'A transit reporter and a railway investigator trace a repeating emergency signal through a city that insists nothing happened.',
        director: 'Mara Venn',
        actors: 'Nadia Cross, Elias Rowe, June Mercer, Tomas Vale',
        genre: 'Urban Conspiracy Thriller',
        rating: 8.1,
        tagline: 'The ninth signal was never sent.',
        year: 2026,
    },
    {
        categoryKey: 'family-comedy',
        name: 'Checkout at Noon',
        slug: 'checkout-at-noon',
        description:
            'An exhausted hotel manager has one morning to settle a cheerful traveler and a formidable guest into the same impossible room.',
        director: 'Milo Hart',
        actors: 'Adrian Moss, Clara Wynn, Evelyn Shore, Ben Vale',
        genre: 'Ensemble Comedy',
        rating: 7.7,
        tagline: 'Every guest has a different plan.',
        year: 2025,
    },
    {
        categoryKey: 'future-fantasy',
        name: 'Vesper Crown',
        slug: 'vesper-crown',
        description:
            'A royal archivist crosses a silent salt kingdom to recover a broken crown before its seven pieces choose a new ruler.',
        director: 'Iris March',
        actors: 'Selah Quinn, Rowan Pike, Mira Holt, Theo Arden',
        genre: 'Fantasy Adventure',
        rating: 8.3,
        tagline: 'Seven pieces remember the throne.',
        year: 2026,
    },
    {
        categoryKey: 'action-mystery',
        name: 'Last Detour',
        slug: 'last-detour',
        description:
            'A veteran mechanic and a bicycle courier take one mountain road too far and discover why every map avoids it.',
        director: 'Noah Rook',
        actors: 'Tessa Marr, Leo Venn, Omar Pike, Nina Cross',
        genre: 'Road Action Thriller',
        rating: 7.9,
        tagline: 'The long way back is the only way out.',
        year: 2025,
    },
    {
        categoryKey: 'drama-documentary',
        name: 'Borrowed Summer',
        slug: 'borrowed-summer',
        description:
            'Two former friends meet beside a lakeside bus route and spend one final season deciding which memories still belong to them.',
        director: 'Lina Shore',
        actors: 'Mara Wynn, Julian Hart, Elise Rowe, Finn Cole',
        genre: 'Romantic Drama',
        rating: 8.0,
        tagline: 'Some seasons are only passing through.',
        year: 2024,
    },
    {
        categoryKey: 'action-mystery',
        name: 'Under the Floor',
        slug: 'under-the-floor',
        description:
            'A tenant renovating an empty family home follows a red thread beneath the floorboards and into a history no room remembers.',
        director: 'Oren Vale',
        actors: 'Rhea Moss, Daniel Cross, Mina Shore, Asa Bell',
        genre: 'Supernatural Horror',
        rating: 7.8,
        tagline: 'The house kept one thing hidden.',
        year: 2025,
    },
    {
        categoryKey: 'future-fantasy',
        name: 'Red Winter',
        slug: 'red-winter',
        description:
            'A planetary botanist crosses a frozen red plain with the last living samples after her remote habitat falls silent.',
        director: 'Vera Holt',
        actors: 'Nora Venn, Kai March, Elias Moss, Ruth Arden',
        genre: 'Science Fiction Survival',
        rating: 8.5,
        tagline: 'Life travels light.',
        year: 2026,
    },
    {
        categoryKey: 'family-comedy',
        name: 'Saturday Champions',
        slug: 'saturday-champions',
        description:
            'Six neighborhood footballers with mismatched kits train for the one match their muddy community field has been waiting for.',
        director: 'Tomas Hart',
        actors: 'Milo Quinn, Ari Bell, Leni Moss, Kit Rowe',
        genre: 'Family Sports Comedy',
        rating: 7.9,
        tagline: 'The score is not the whole story.',
        year: 2025,
    },
    {
        categoryKey: 'drama-documentary',
        name: 'The Silent Verdict',
        slug: 'the-silent-verdict',
        description:
            'A public defender receives one sealed envelope after an empty courtroom closes and must decide whether justice can survive the truth.',
        director: 'June Marr',
        actors: 'Amara Voss, Theo Reed, Elias Hart, Cora Wynn',
        genre: 'Courtroom Drama',
        rating: 8.2,
        tagline: 'The final evidence said nothing.',
        year: 2026,
    },
    {
        categoryKey: 'action-mystery',
        name: 'Low Tide Letters',
        slug: 'low-tide-letters',
        description:
            'An aging postal worker crosses the tidal flats to deliver a final bundle of letters to a village missing from every new map.',
        director: 'Owen Shore',
        actors: 'Bram North, Iris Cole, Lena March, Rafi Bell',
        genre: 'Coastal Mystery',
        rating: 8.1,
        tagline: 'The sea returns every address.',
        year: 2024,
    },
    {
        categoryKey: 'family-comedy',
        name: 'Salt & Cedar',
        slug: 'salt-cedar',
        description:
            'Two estranged siblings reopen their family restaurant and discover that the old recipes settle fewer arguments than they start.',
        director: 'Cora Vale',
        actors: 'Mina Wynn, Adrian Rowe, Ruth Moss, Nico Hart',
        genre: 'Culinary Dramedy',
        rating: 7.8,
        tagline: 'Every table remembers.',
        year: 2025,
    },
    {
        categoryKey: 'action-mystery',
        name: 'Brass Horizon',
        slug: 'brass-horizon',
        description:
            'A desert aircraft engineer races an experimental survey plane ahead of a dust front that has erased every route home.',
        director: 'Ren Arden',
        actors: 'Talia Cross, Owen Pike, Mara Bell, Jules North',
        genre: 'Retro Aviation Adventure',
        rating: 8.0,
        tagline: 'Build what the horizon cannot stop.',
        year: 2023,
    },
    {
        categoryKey: 'family-comedy',
        name: 'Moonlight Delivery',
        slug: 'moonlight-delivery',
        description:
            'A young night courier climbs a winding miniature city to deliver three glowing parcels before the moon disappears.',
        director: 'Lumi Hart',
        actors: 'Kit Vale, Orla Reed, Finn Moss, Ari Shore',
        genre: 'Animated Family Adventure',
        rating: 8.4,
        tagline: 'Every doorstep needs a little light.',
        year: 2026,
    },
] as const satisfies readonly MarketingMovieFixture[];

export const POSTER_SHOWCASE_MOVIES = [
    ...NEW_MARKETING_MOVIES,
    ...EXISTING_MARKETING_MOVIES,
] as const satisfies readonly MarketingMovieFixture[];
