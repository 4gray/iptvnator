/** Original editorial metadata for the cinematic demo; no real productions. */
const SKYLINE_SEASONS = [
    'A new night crew discovers that the city’s failing relays share a hidden history. Across rooftops, tunnels and river bridges, six dawn shifts turn strangers into a team.',
    'An approaching winter storm tests the crew’s fragile trust as a forgotten maintenance map reveals a second network beneath the city.',
    'With the river rising and the old control room closing, the crew must bring three generations of workers together for one final overnight repair.',
];

const SKYLINE_EPISODES = [
    [
        [
            'The Dawn Shift',
            'On her first rooftop shift, Mara finds a relay transmitting after its power has been cut. A routine inspection becomes a race to reach the next tower before sunrise.',
        ],
        [
            'Under the River',
            'A flooded service tunnel carries the same signal. Theo and Mara follow an obsolete cable beneath the river while the rest of the crew keeps the bridge open.',
        ],
        [
            'Windows of Light',
            'A pattern of dark windows points to a retired engineer. Juno risks a difficult conversation to recover the plans for a building that no longer exists.',
        ],
        [
            'The Long Crossing',
            'A failed lift strands two workers above the river. The crew must coordinate a rescue using a radio channel nobody has monitored in years.',
        ],
        [
            'No Spare Parts',
            'With the replacement relay missing, Ren opens the workshop to a neighborhood repair club. An improvised solution exposes a mistake in the official shutdown order.',
        ],
        [
            'Before the City Wakes',
            'The crew has forty-four minutes to restore the network. Mara must choose between following the approved route and trusting the people who built it.',
        ],
    ],
    [
        [
            'The Winter Map',
            'A hand-drawn maintenance map arrives without a sender, just as the first winter storm isolates the northern towers.',
        ],
        [
            'Below Zero',
            'A frozen intake puts the old river station at risk. Theo revisits a repair he once signed off too quickly.',
        ],
        [
            'Borrowed Power',
            'Juno negotiates a temporary link through a neighborhood workshop while Ren discovers why its owner distrusts the city.',
        ],
        [
            'The Silent Floor',
            'An empty office floor draws more current than the occupied building above it, leading Mara to an unexpected caretaker.',
        ],
        [
            'Night Ferry',
            'The last ferry carries an essential transformer and a passenger who knows the truth about the missing map.',
        ],
        [
            'All the Way Home',
            'As the storm reaches the river, the crew opens an old control room and asks the neighborhood to help keep the lights on.',
        ],
    ],
    [
        [
            'High Water',
            'A rising river exposes the original relay foundations and forces the crew to bring a retired specialist back into the field.',
        ],
        [
            'The New Apprentice',
            'A young recruit questions the crew’s familiar routines and notices a fault their experience has taught them to overlook.',
        ],
        [
            'Three Generations',
            'Workers past and present gather at the workshop, but agreeing on a shared repair plan proves harder than finding the parts.',
        ],
        [
            'Open Circuit',
            'A citywide test disconnects the wrong district. Juno takes responsibility while Mara searches for a way to reconnect it safely.',
        ],
        [
            'The Last Control Room',
            'The scheduled closure leaves one night to transfer the network, and Theo finally explains why he stayed on the crew.',
        ],
        [
            'Morning, Together',
            'From the first rooftop to the river station, every member of the crew takes a position for the final repair before dawn.',
        ],
    ],
] as const;

export function marketingSeasonOverview(name: string, season: number): string {
    return name === 'Skyline Sentinels'
        ? (SKYLINE_SEASONS[season - 1] ?? SKYLINE_SEASONS[0])
        : `Season ${season} follows the people of ${name} as an unexpected change brings old friendships and unfinished plans into focus.`;
}

export function marketingEpisodeStory(
    name: string,
    season: number,
    episode: number
): { title: string; plot: string; artworkTitle: string } {
    const story =
        name === 'Skyline Sentinels'
            ? SKYLINE_EPISODES[season - 1]?.[episode - 1]
            : undefined;
    return {
        title: story?.[0] ?? `${name} S${season}E${episode}`,
        plot:
            story?.[1] ??
            `An unexpected arrival changes the plans of the people at the heart of ${name}. A difficult choice brings a long-standing friendship into a new light.`,
        artworkTitle:
            name === 'Skyline Sentinels' && season === 1 && episode <= 2
                ? `${name} Episode ${episode}`
                : name,
    };
}
