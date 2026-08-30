export type Competition = {
  id: number;
  name: string;
  country: string;
};

// The single supported-competition list. Every route that accepts a league id
// validates against this, so a competition is added in one place only.
export const COMPETITIONS: readonly Competition[] = [
  { id: 39, name: 'Premier League', country: 'England' },
  { id: 40, name: 'EFL Championship', country: 'England' },
  { id: 41, name: 'EFL League One', country: 'England' },
  { id: 42, name: 'EFL League Two', country: 'England' },
  { id: 61, name: 'Ligue 1', country: 'France' },
  { id: 140, name: 'La Liga', country: 'Spain' },
  { id: 78, name: 'Bundesliga', country: 'Germany' },
  { id: 135, name: 'Serie A', country: 'Italy' },
  { id: 88, name: 'Eredivisie', country: 'Netherlands' },
  { id: 2, name: 'UEFA Champions League', country: 'UEFA' },
  { id: 3, name: 'UEFA Europa League', country: 'UEFA' },
  { id: 848, name: 'UEFA Conference League', country: 'UEFA' },
];

const BY_ID = new Map(COMPETITIONS.map((competition) => [competition.id, competition]));

export function getCompetition(id: number): Competition | null {
  return BY_ID.get(id) ?? null;
}
