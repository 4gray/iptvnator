let sequence = 0;

function next(label: string): string {
    sequence += 1;
    return `${label} ${sequence}`;
}

export const faker = {
    seed: (seed: number) => {
        sequence = seed;
    },
    company: {
        name: () => next('Company'),
        catchPhrase: () => next('Synthetic programme'),
    },
    music: {
        genre: () => next('Genre'),
        songName: () => next('Song'),
    },
    word: {
        noun: () => next('Station'),
    },
    lorem: {
        words: (count: number) =>
            Array.from({ length: count }, () => next('word')).join(' '),
        paragraph: () => next('Synthetic paragraph'),
        sentence: () => next('Synthetic sentence'),
    },
    person: {
        fullName: () => next('Test Person'),
    },
    date: {
        past: ({ years }: { years: number }) =>
            new Date(Date.UTC(2026 - years, 0, 1)),
    },
};
