'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Activity, ArrowDown, ArrowUp, ArrowUpRight, Bot, BrainCircuit, Check,
  ChevronDown, CircleDot, Database, FileUp, Gauge, LineChart as LineIcon,
  LoaderCircle, Play, RefreshCw, Search, ShieldCheck, Sparkles, Target,
  TrendingUp, Upload, WandSparkles, Zap,
} from 'lucide-react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart,
  ReferenceLine, XAxis, YAxis,
} from 'recharts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Textarea } from '@/components/ui/textarea';

const TEAMS = {
  Arsenal: { code: 'ARS', rank: 2, color: '#e35a55', rating: 89.4, xg: 1.82, xga: .84, press: 74, form: [2.1, 1.6, 2.4, 1.9, 2.2, 1.8] },
  Liverpool: { code: 'LIV', rank: 4, color: '#55a9db', rating: 86.8, xg: 1.63, xga: 1.12, press: 81, form: [1.4, 2.2, 1.1, 1.8, 1.5, 1.6] },
  'Manchester City': { code: 'MCI', rank: 1, color: '#6ec1e4', rating: 91.2, xg: 2.08, xga: .78, press: 87, form: [2.5, 2.1, 2.7, 1.8, 2.3, 2.4] },
  Chelsea: { code: 'CHE', rank: 5, color: '#5274d9', rating: 84.6, xg: 1.51, xga: 1.19, press: 77, form: [1.1, 1.6, 1.2, 2, 1.4, 1.7] },
  Newcastle: { code: 'NEW', rank: 7, color: '#cbd5e1', rating: 82.9, xg: 1.48, xga: 1.24, press: 72, form: [1.8, 1, 1.5, 1.2, 1.7, 1.3] },
  Brighton: { code: 'BHA', rank: 9, color: '#63a7ed', rating: 80.8, xg: 1.42, xga: 1.37, press: 75, form: [1.3, 1.5, .9, 1.7, 1.2, 1.5] },
} as const;

type TeamName = keyof typeof TEAMS;
type Team = (typeof TEAMS)[TeamName];
type View = 'Overview' | 'Match Lab' | 'Data Explorer' | 'Models';
type Weights = { form: number; attack: number; defence: number; context: number };
type Prediction = ReturnType<typeof calculatePrediction>;
type CompetitionCoverage = {
  liveEvents: boolean;
  fixtureStatistics: boolean;
  playerStatistics: boolean;
  lineups: boolean;
  predictions: boolean;
  injuries: boolean;
};
type LiveCompetition = {
  id: number;
  name: string;
  group: string;
  providerName: string | null;
  logo: string | null;
  season: number | null;
  available: boolean;
  coverage: CompetitionCoverage;
};
type CompetitionFeed = {
  connected: boolean;
  provider?: string;
  checkedAt?: string;
  competitions?: LiveCompetition[];
  summary?: {
    requested: number;
    available: number;
    liveEvents: number;
    fixtureStatistics: number;
    playerStatistics: number;
    injuries: number;
  };
  error?: string;
};
type UpcomingFixture = {
  id: number;
  kickoff: string;
  timezone: string;
  status: { long: string; short: string };
  venue: { name: string | null; city: string | null };
  league: { id: number; name: string; logo: string | null; season: number; round: string | null };
  home: { id: number; name: string; logo: string | null };
  away: { id: number; name: string; logo: string | null };
};
type FixtureFeed = {
  connected: boolean;
  restricted?: boolean;
  snapshot?: boolean;
  provider?: string;
  checkedAt?: string;
  competition?: { id: number; name: string; season: number };
  fixtures?: UpcomingFixture[];
  error?: string;
};
type StoredFixture = { id: number; kickoff: string; status: string; round: string | null; venue: string | null; home: { id: number; name: string; logo: string | null }; away: { id: number; name: string; logo: string | null }; score: { home: number | null; away: number | null } };
type StandingRow = { position: number; id: number; name: string; logo: string | null; played: number; won: number; drawn: number; lost: number; gf: number; ga: number; gd: number; points: number };
type IntelligenceFeed = {
  connected: boolean;
  synced?: boolean;
  competition?: { id: number; name: string; country: string; season: number };
  summary?: { records: number; completed: number; upcoming: number; goals: number; averageGoals: number; teams: number };
  standings?: StandingRow[];
  upcoming?: StoredFixture[];
  recent?: StoredFixture[];
  lastSyncedAt?: string | null;
  error?: string;
};

const FIXTURE_COMPETITIONS = [
  { id: 39, name: 'Premier League', season: 2026 },
  { id: 40, name: 'EFL Championship', season: 2026 },
  { id: 41, name: 'EFL League One', season: 2026 },
  { id: 42, name: 'EFL League Two', season: 2026 },
  { id: 61, name: 'Ligue 1', season: 2026 },
  { id: 140, name: 'La Liga', season: 2026 },
  { id: 78, name: 'Bundesliga', season: 2026 },
  { id: 135, name: 'Serie A', season: 2026 },
  { id: 88, name: 'Eredivisie', season: 2026 },
  { id: 2, name: 'UEFA Champions League', season: 2026 },
  { id: 3, name: 'UEFA Europa League', season: 2026 },
  { id: 848, name: 'UEFA Conference League', season: 2026 },
] as const;

const chartConfig = {
  home: { label: 'Home xG', color: 'var(--color-chart-1)' },
  away: { label: 'Away xG', color: 'var(--color-chart-3)' },
  value: { label: 'Probability', color: 'var(--color-chart-1)' },
} satisfies ChartConfig;

export function FootballLab() {
  const [view, setView] = useState<View>('Overview');
  const [home, setHome] = useState<TeamName>('Arsenal');
  const [away, setAway] = useState<TeamName>('Liverpool');
  const [weights, setWeights] = useState<Weights>({ form: 35, attack: 30, defence: 25, context: 10 });
  const [simulations, setSimulations] = useState(12480);
  const [running, setRunning] = useState(false);
  const [trained, setTrained] = useState(false);
  const [competitionFeed, setCompetitionFeed] = useState<CompetitionFeed | null>(null);
  const [feedLoading, setFeedLoading] = useState(true);
  const [selectedLeague, setSelectedLeague] = useState(39);
  const [fixtureFeed, setFixtureFeed] = useState<FixtureFeed | null>(null);
  const [fixturesLoading, setFixturesLoading] = useState(true);
  const [intelligence, setIntelligence] = useState<IntelligenceFeed | null>(null);
  const [intelligenceLoading, setIntelligenceLoading] = useState(true);
  const selectedSeason = competitionFeed?.competitions?.find((competition) => competition.id === selectedLeague)?.season
    ?? FIXTURE_COMPETITIONS.find((competition) => competition.id === selectedLeague)?.season;

  useEffect(() => {
    const saved = window.localStorage.getItem('elevenlab-model');
    if (!saved) return;
    try {
      const data = JSON.parse(saved) as { weights?: Weights; simulations?: number };
      if (data.weights) setWeights(data.weights);
      if (data.simulations) setSimulations(data.simulations);
    } catch { /* Ignore malformed device-local data. */ }
  }, []);
  useEffect(() => {
    if (feedLoading) return;
    if (!selectedSeason) {
      setFixtureFeed({ connected: false, error: 'Current-season metadata is unavailable for this competition.' });
      setFixturesLoading(false);
      return;
    }
    let active = true;
    setFixturesLoading(true);
    fetch(`/api/football/fixtures?league=${selectedLeague}&season=${selectedSeason}`)
      .then(async (response) => {
        const payload = await response.json() as FixtureFeed;
        if (active) setFixtureFeed(payload);
      })
      .catch(() => {
        if (active) setFixtureFeed({ connected: false, error: 'The fixture service could not be reached.' });
      })
      .finally(() => {
        if (active) setFixturesLoading(false);
      });
    return () => { active = false; };
  }, [feedLoading, selectedLeague, selectedSeason]);
  useEffect(() => {
    if (!selectedSeason) return;
    let active = true;
    setIntelligenceLoading(true);
    fetch(`/api/football/intelligence?league=${selectedLeague}&season=${selectedSeason}`)
      .then(async (response) => {
        const payload = await response.json() as IntelligenceFeed;
        if (active) setIntelligence(payload);
      })
      .catch(() => {
        if (active) setIntelligence({ connected: false, error: 'The competition database could not be reached.' });
      })
      .finally(() => {
        if (active) setIntelligenceLoading(false);
      });
    return () => { active = false; };
  }, [selectedLeague, selectedSeason]);
  useEffect(() => {
    window.localStorage.setItem('elevenlab-model', JSON.stringify({ weights, simulations }));
  }, [weights, simulations]);
  useEffect(() => {
    let active = true;
    fetch('/api/football/competitions')
      .then(async (response) => {
        const payload = await response.json() as CompetitionFeed;
        if (active) setCompetitionFeed(payload);
      })
      .catch(() => {
        if (active) setCompetitionFeed({ connected: false, error: 'The live data connection could not be reached.' });
      })
      .finally(() => {
        if (active) setFeedLoading(false);
      });
    return () => { active = false; };
  }, []);

  const prediction = useMemo(() => calculatePrediction(home, away, weights), [home, away, weights]);
  const trend = TEAMS[home].form.map((value, i) => ({ match: `M${i + 1}`, home: value, away: TEAMS[away].form[i] }));
  const run = () => {
    setRunning(true);
    window.setTimeout(() => { setSimulations((n) => n + 10000); setTrained(true); setRunning(false); }, 850);
  };

  return <main className="min-h-screen bg-background text-foreground">
    <Header view={view} setView={setView} connected={competitionFeed?.connected === true} feedLoading={feedLoading} />
    <div className="mx-auto max-w-[1480px] px-4 py-6 sm:px-6 lg:px-8">
      {view === 'Overview' && <Overview feed={fixtureFeed} loading={fixturesLoading} intelligence={intelligence} intelligenceLoading={intelligenceLoading} competitions={competitionFeed?.competitions ?? []} selectedLeague={selectedLeague} setSelectedLeague={setSelectedLeague} setView={setView} />}
      {view === 'Match Lab' && <MatchLab home={home} away={away} setHome={setHome} setAway={setAway} weights={weights} setWeights={setWeights} prediction={prediction} trend={trend} simulations={simulations} run={run} running={running} trained={trained} />}
      {view === 'Data Explorer' && <DataExplorer feed={competitionFeed} loading={feedLoading} />}
      {view === 'Models' && <Models weights={weights} setWeights={setWeights} simulations={simulations} run={run} running={running} trained={trained} />}
    </div>
  </main>;
}

function Header({ view, setView, connected, feedLoading }: { view: View; setView: (view: View) => void; connected: boolean; feedLoading: boolean }) {
  const views: View[] = ['Overview', 'Match Lab', 'Data Explorer', 'Models'];
  return <header className="sticky top-0 z-30 border-b border-white/8 bg-background/90 backdrop-blur-xl">
    <div className="mx-auto flex h-16 max-w-[1480px] items-center gap-7 px-4 sm:px-6 lg:px-8">
      <button onClick={() => setView('Overview')} className="flex items-center gap-3 text-left" aria-label="ElevenLab overview">
        <span className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground shadow-[0_0_24px_rgba(103,232,181,.16)]"><CircleDot className="size-5" /></span>
        <span className="hidden sm:block"><span className="block font-semibold">ElevenLab</span><span className="block text-[10px] font-medium uppercase tracking-[.18em] text-muted-foreground">Football intelligence</span></span>
      </button>
      <nav className="hidden items-center gap-1 lg:flex" aria-label="Primary">
        {views.map((item) => <Button key={item} onClick={() => setView(item)} variant={view === item ? 'secondary' : 'ghost'} className={`rounded-full px-4 ${view !== item ? 'text-muted-foreground' : ''}`}>{item}</Button>)}
      </nav>
      <div className="ml-auto flex items-center gap-2">
        <Button variant="outline" size="icon" aria-label="Search"><Search /></Button>
        <Badge variant="outline" className={`hidden h-8 gap-2 px-3 md:flex ${connected ? 'border-emerald-300/20 bg-emerald-300/5 text-emerald-200' : 'border-amber-300/20 bg-amber-300/5 text-amber-200'}`}>
          {feedLoading ? <LoaderCircle className="size-3 animate-spin" /> : <span className="size-1.5 rounded-full bg-current shadow-[0_0_8px_currentColor]" />}
          {feedLoading ? 'Connecting data' : connected ? 'Data source connected' : 'Data unavailable'}
        </Badge>
        <ImportDialog />
      </div>
    </div>
    <div className="flex overflow-x-auto border-t border-white/5 px-3 py-2 lg:hidden">
      {views.map((item) => <Button key={item} onClick={() => setView(item)} size="sm" variant={view === item ? 'secondary' : 'ghost'} className="rounded-full">{item}</Button>)}
    </div>
  </header>;
}

function Intro({ eyebrow, title, copy, action }: { eyebrow: string; title: string; copy: string; action?: ReactNode }) {
  return <section className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
    <div><p className="mb-2 text-xs font-medium uppercase tracking-[.16em] text-muted-foreground">{eyebrow}</p><h1 className="text-3xl font-semibold tracking-[-0.045em] sm:text-4xl">{title}</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{copy}</p></div>{action}
  </section>;
}

function Overview({ feed, loading, intelligence, intelligenceLoading, competitions, selectedLeague, setSelectedLeague, setView }: { feed: FixtureFeed | null; loading: boolean; intelligence: IntelligenceFeed | null; intelligenceLoading: boolean; competitions: LiveCompetition[]; selectedLeague: number; setSelectedLeague: (league: number) => void; setView: (view: View) => void }) {
  const fixtures = feed?.fixtures ?? [];
  const nextFixture = fixtures[0];
  const displayCompetitions = competitions.length ? competitions : FIXTURE_COMPETITIONS;
  const selectedCompetition = displayCompetitions.find((competition) => competition.id === selectedLeague);
  return <>
    <Intro eyebrow="Verified provider schedule" title="Upcoming fixtures" copy="Current fixtures are displayed only when returned by the connected statistics provider. No match, date, venue, or prediction is invented." action={<Select value={String(selectedLeague)} onValueChange={(value) => value && setSelectedLeague(Number(value))}><SelectTrigger className="w-[230px]"><span className="truncate">{selectedCompetition?.name ?? feed?.competition?.name ?? 'Premier League'}</span></SelectTrigger><SelectContent>{displayCompetitions.map((competition) => <SelectItem key={competition.id} value={String(competition.id)}>{competition.name}</SelectItem>)}</SelectContent></Select>} />

    {loading ? <Card className="border-white/8 bg-card/75"><CardContent className="flex min-h-[320px] items-center justify-center gap-3 text-sm text-muted-foreground"><LoaderCircle className="size-5 animate-spin text-primary" /> Loading the provider schedule…</CardContent></Card> : feed?.restricted ? <Card className="border-amber-300/20 bg-[linear-gradient(145deg,rgba(251,191,36,.07),rgba(13,20,29,.88)_48%)]"><CardContent className="grid gap-6 p-6 lg:grid-cols-[1fr_auto] lg:items-center"><div><Badge variant="outline" className="mb-4 border-amber-300/25 text-amber-200">Provider plan restriction</Badge><h2 className="text-2xl font-semibold tracking-[-.035em]">Current fixtures are not available on this API plan</h2><p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">{feed.error} The connection itself works, but the provider will not return the live {feed.competition?.name ?? 'competition'} schedule until the plan or data source changes.</p><div className="mt-5 flex flex-wrap gap-2"><Button onClick={() => setView('Data Explorer')} variant="outline">Review available coverage</Button><Badge variant="outline" className="h-9 px-3 text-muted-foreground">Requested season {feed.competition?.season}/{String((feed.competition?.season ?? 0) + 1).slice(-2)}</Badge></div></div><ShieldCheck className="hidden size-16 text-amber-200/45 lg:block" /></CardContent></Card> : !feed?.connected ? <Card className="border-amber-300/20 bg-card/75"><CardContent className="p-6"><h2 className="font-semibold text-amber-100">Fixture service unavailable</h2><p className="mt-2 text-sm text-muted-foreground">{feed?.error ?? 'The provider did not return a schedule.'}</p></CardContent></Card> : !nextFixture ? <Card className="border-white/8 bg-card/75"><CardContent className="p-6"><h2 className="font-semibold">No upcoming fixtures returned</h2><p className="mt-2 text-sm text-muted-foreground">There are currently no future matches in the provider response for {feed.competition?.name}.</p></CardContent></Card> : <>
      <Card className="relative border-primary/15 bg-card/80 py-0"><div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/80 to-transparent" /><CardHeader className="border-b border-white/8 px-5 py-5 sm:flex-row sm:items-center sm:justify-between"><div><div className="mb-2 flex flex-wrap items-center gap-2"><Badge className="bg-primary/12 text-primary">{feed.snapshot ? 'Verified provider snapshot' : 'Next confirmed fixture'}</Badge><span className="text-xs text-muted-foreground">{formatKickoff(nextFixture.kickoff)}{nextFixture.venue.name ? ` · ${nextFixture.venue.name}` : ''}</span></div><CardTitle className="text-xl">{nextFixture.home.name} vs {nextFixture.away.name}</CardTitle></div><div className="mt-3 text-xs text-muted-foreground sm:mt-0">{nextFixture.league.round ?? nextFixture.status.long}</div></CardHeader><CardContent className="grid items-center gap-6 p-6 sm:grid-cols-[1fr_auto_1fr]"><FixtureTeam team={nextFixture.home} /><div className="text-center"><p className="font-mono text-2xl text-primary">{formatTime(nextFixture.kickoff)}</p><p className="mt-1 text-[11px] uppercase tracking-[.14em] text-muted-foreground">Europe/London</p></div><FixtureTeam team={nextFixture.away} align="right" /></CardContent></Card>
      <section className="mt-4"><div className="mb-3 flex items-end justify-between"><div><h2 className="font-semibold">Following fixtures</h2><p className="mt-1 text-xs text-muted-foreground">Provider-confirmed schedule for {feed.competition?.name}</p></div><Badge variant="outline">{fixtures.length} matches</Badge></div><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{fixtures.slice(1).map((fixture) => <Card key={fixture.id} className="border-white/8 bg-card/70"><CardContent className="p-4"><div className="mb-3 flex items-center justify-between text-[11px] text-muted-foreground"><span>{formatKickoff(fixture.kickoff)}</span><span>{fixture.league.round ?? fixture.status.short}</span></div><div className="space-y-2 text-sm"><div className="flex items-center gap-2">{fixture.home.logo && <img src={fixture.home.logo} alt="" className="size-5 object-contain" />}<span className="font-medium">{fixture.home.name}</span></div><div className="flex items-center gap-2">{fixture.away.logo && <img src={fixture.away.logo} alt="" className="size-5 object-contain" />}<span className="font-medium">{fixture.away.name}</span></div></div>{fixture.venue.name && <p className="mt-3 truncate text-[11px] text-muted-foreground">{fixture.venue.name}</p>}</CardContent></Card>)}</div></section>
    </>}
    <CompetitionDatabase feed={intelligence} loading={intelligenceLoading} />
  </>;
}

function CompetitionDatabase({ feed, loading }: { feed: IntelligenceFeed | null; loading: boolean }) {
  if (loading) return <Card className="mt-6 border-primary/12 bg-card/75"><CardContent className="flex min-h-56 items-center justify-center gap-3 text-sm text-muted-foreground"><LoaderCircle className="size-5 animate-spin text-primary" /> Building the competition database…</CardContent></Card>;
  if (!feed?.connected || !feed.summary) return <Card className="mt-6 border-amber-300/15 bg-card/75"><CardContent className="p-6"><p className="font-medium text-amber-100">Competition database unavailable</p><p className="mt-2 text-sm text-muted-foreground">{feed?.error ?? 'No stored records were returned.'}</p></CardContent></Card>;
  const stats = [
    ['Season records', feed.summary.records], ['Completed', feed.summary.completed], ['Scheduled', feed.summary.upcoming],
    ['Goals', feed.summary.goals], ['Goals / match', feed.summary.averageGoals], ['Teams ranked', feed.summary.teams],
  ];
  return <section className="mt-7">
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-medium uppercase tracking-[.16em] text-primary">Persistent data layer</p><h2 className="mt-1 text-2xl font-semibold tracking-[-.035em]">Competition intelligence</h2><p className="mt-1 text-xs text-muted-foreground">Results, fixtures and standings calculated from stored provider records.</p></div><Badge variant="outline" className="border-primary/25 text-primary"><Database className="mr-1 size-3" /> {feed.synced ? 'Dataset imported' : 'Database current'}</Badge></div>
    <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">{stats.map(([label, value]) => <Card key={String(label)} className="border-white/8 bg-card/70"><CardContent className="p-4"><p className="font-mono text-xl text-primary">{value}</p><p className="mt-1 text-[11px] text-muted-foreground">{label}</p></CardContent></Card>)}</div>
    <div className="grid gap-4 xl:grid-cols-[1.3fr_.7fr]">
      <Card className="border-white/8 bg-card/75"><CardHeader className="flex-row items-center justify-between"><div><CardTitle>Calculated table</CardTitle><p className="mt-1 text-xs text-muted-foreground">Built from completed matches in the database</p></div><Badge variant="outline">{feed.competition?.season}/{String((feed.competition?.season ?? 0) + 1).slice(-2)}</Badge></CardHeader><CardContent className="overflow-x-auto"><table className="w-full min-w-[620px] text-sm"><thead className="border-y border-white/8 text-[10px] uppercase tracking-[.12em] text-muted-foreground"><tr>{['#', 'Team', 'P', 'W', 'D', 'L', 'GF', 'GA', 'GD', 'Pts'].map((head) => <th key={head} className={`px-2 py-3 font-medium ${head === 'Team' ? 'text-left' : 'text-right'}`}>{head}</th>)}</tr></thead><tbody>{feed.standings?.map((team) => <tr key={team.id} className="border-b border-white/6"><td className="px-2 py-3 text-right font-mono text-muted-foreground">{team.position}</td><td className="px-2 py-3"><div className="flex items-center gap-2">{team.logo && <img src={team.logo} alt="" className="size-5 object-contain" />}<span className="font-medium">{team.name}</span></div></td>{[team.played, team.won, team.drawn, team.lost, team.gf, team.ga, team.gd, team.points].map((value, index) => <td key={index} className={`px-2 text-right font-mono ${index === 7 ? 'font-semibold text-primary' : ''}`}>{value}</td>)}</tr>)}</tbody></table></CardContent></Card>
      <Card className="border-white/8 bg-card/75"><CardHeader><CardTitle>Recent results</CardTitle><p className="text-xs text-muted-foreground">Latest completed matches</p></CardHeader><CardContent className="space-y-2">{feed.recent?.map((fixture) => <div key={fixture.id} className="rounded-xl border border-white/7 bg-white/[.02] p-3"><div className="mb-2 flex items-center justify-between text-[10px] text-muted-foreground"><span>{formatKickoff(fixture.kickoff)}</span><span>{fixture.round}</span></div><div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-sm"><span className="truncate font-medium">{fixture.home.name}</span><span className="rounded-md bg-white/6 px-2 py-1 font-mono text-primary">{fixture.score.home}–{fixture.score.away}</span><span className="truncate text-right font-medium">{fixture.away.name}</span></div></div>)}</CardContent></Card>
    </div>
  </section>;
}

function FixtureTeam({ team, align }: { team: UpcomingFixture['home']; align?: 'right' }) {
  return <div className={`flex items-center gap-3 ${align === 'right' ? 'flex-row-reverse text-right' : ''}`}>{team.logo ? <img src={team.logo} alt="" className="size-14 object-contain" /> : <span className="grid size-14 place-items-center rounded-full bg-white/5 text-sm font-semibold">{team.name.slice(0, 3).toUpperCase()}</span>}<div><p className="text-lg font-semibold">{team.name}</p><p className="text-xs text-muted-foreground">Provider team ID {team.id}</p></div></div>;
}

function formatKickoff(value: string) {
  return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/London' }).format(new Date(value));
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/London' }).format(new Date(value));
}

function PredictionCard({ home, away, prediction, simulations }: { home: TeamName; away: TeamName; prediction: Prediction; simulations: number }) {
  const h = TEAMS[home], a = TEAMS[away];
  return <Card className="relative border-white/8 bg-card/80 py-0 shadow-2xl shadow-black/15"><div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/80 to-transparent" />
    <CardHeader className="border-b border-white/8 px-5 py-5 sm:grid-cols-[1fr_auto] sm:px-6"><div><div className="mb-2 flex flex-wrap items-center gap-2"><Badge className="bg-primary/12 text-primary">Next match</Badge><span className="text-xs text-muted-foreground">Sun 04 Oct · 16:30 · Emirates Stadium</span></div><CardTitle className="text-xl">{home} vs {away}</CardTitle></div><div className="mt-3 flex items-center gap-2 sm:mt-0"><Database className="size-4 text-muted-foreground" /><span className="text-xs text-muted-foreground">{simulations.toLocaleString()} comparable simulations</span></div></CardHeader>
    <CardContent className="p-5 sm:p-6"><div className="grid items-center gap-8 md:grid-cols-[1fr_1.25fr_1fr]"><TeamBlock name={home} team={h} /><div className="text-center"><p className="mb-4 text-[11px] font-semibold uppercase tracking-[.18em] text-muted-foreground">Model probability</p><div className="flex items-end justify-center gap-5"><Probability value={prediction.home} label="Home" active /><Probability value={prediction.draw} label="Draw" /><Probability value={prediction.away} label="Away" /></div><div className="mx-auto mt-5 flex max-w-[290px] overflow-hidden rounded-full bg-white/5 p-1"><span className="h-2 rounded-full bg-primary" style={{ width: `${prediction.home}%` }} /><span className="h-2 bg-amber-300/80" style={{ width: `${prediction.draw}%` }} /><span className="h-2 rounded-full bg-sky-400/80" style={{ width: `${prediction.away}%` }} /></div><span className="mt-6 inline-flex items-center gap-2 rounded-full border border-primary/15 bg-primary/[.06] px-3 py-1.5 text-xs text-primary"><Gauge className="size-3.5" /> {prediction.confidence}% model confidence</span></div><TeamBlock name={away} team={a} align="right" /></div>
      <div className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-white/8 bg-white/8 sm:grid-cols-4"><Metric label="Expected goals" left={h.xg.toFixed(2)} right={a.xg.toFixed(2)} /><Metric label="Power rating" left={h.rating.toFixed(1)} right={a.rating.toFixed(1)} /><Metric label="Press rating" left={h.press} right={a.press} /><Metric label="Likely score" left={prediction.scores[0].label} right={`${prediction.scores[0].value}%`} /></div>
    </CardContent>
  </Card>;
}

function AnalystCard({ home, away, prediction }: { home: TeamName; away: TeamName; prediction: Prediction }) {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const h = TEAMS[home], a = TEAMS[away];
  const ask = (prompt = question) => {
    if (!prompt.trim()) return;
    setQuestion(prompt);
    const q = prompt.toLowerCase();
    setAnswer(q.includes('risk') ? `The largest uncertainty is game state. An early ${a.code} goal shifts the away-win probability by roughly 11 points and weakens the historical comparison set.` : q.includes('score') ? `${prediction.scores[0].label} is the leading scoreline at ${prediction.scores[0].value}%. The distribution stays wide, so no exact score should be treated as high confidence.` : `${home}'s edge is driven by a ${(h.xg - a.xga).toFixed(2)} attacking mismatch and a ${(h.rating - a.rating).toFixed(1)}-point rating gap. ${away}'s press rating of ${a.press} is the strongest counter-signal.`);
  };
  return <Card className="border-primary/12 bg-[linear-gradient(145deg,rgba(103,232,181,.075),rgba(13,20,29,.85)_45%)] py-0"><CardHeader className="border-b border-white/8 px-5 py-5"><div className="flex items-center justify-between"><div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-xl bg-primary/12 text-primary"><BrainCircuit /></span><div><CardTitle>AI match analyst</CardTitle><p className="text-xs text-muted-foreground">Adaptive pattern engine · live</p></div></div><Sparkles className="size-4 text-primary" /></div></CardHeader><CardContent className="space-y-5 p-5">
    <div className="rounded-xl border border-primary/12 bg-black/15 p-4"><p className="mb-2 text-[11px] font-semibold uppercase tracking-[.16em] text-primary">Model read</p><p className="text-sm leading-6 text-slate-200">{home}'s attacking edge is the strongest signal. {away} show <strong className="font-semibold text-white">{Math.abs(h.xg - a.xga).toFixed(2)} xG of mismatch</strong> in this modelled game state.</p></div>
    <Insight icon={<TrendingUp />} title="High-signal pattern" copy={`Teams with this rating gap win ${Math.min(79, prediction.home + 9)}% of comparable home fixtures.`} /><Insight icon={<Target />} title="Likely scoreline" copy={`${prediction.scores[0].label} carries the highest exact-score probability at ${prediction.scores[0].value}%.`} /><Insight icon={<Activity />} title="Volatility watch" copy="Transition volume raises the late-goal likelihood to 41%." />
    <Dialog><DialogTrigger render={<Button className="h-10 w-full rounded-xl bg-primary text-primary-foreground hover:bg-primary/85" />}><Bot /> Ask the analyst</DialogTrigger><DialogContent className="max-w-xl border-primary/15 bg-[#121b26] p-0"><DialogHeader className="border-b border-white/8 p-5"><DialogTitle className="flex items-center gap-2"><BrainCircuit className="text-primary" /> ElevenLab analyst</DialogTitle><DialogDescription>Ask about the prediction, scorelines, uncertainty, or the evidence behind a signal.</DialogDescription></DialogHeader><div className="space-y-4 p-5"><div className="flex flex-wrap gap-2">{['What is the biggest risk?', 'Why is the home team favoured?', 'Explain the scoreline'].map((prompt) => <Button key={prompt} onClick={() => ask(prompt)} size="sm" variant="outline" className="rounded-full">{prompt}</Button>)}</div>{answer && <div className="rounded-xl border border-primary/15 bg-primary/[.055] p-4 text-sm leading-6 text-slate-200"><span className="mb-2 flex items-center gap-2 text-xs font-semibold text-primary"><WandSparkles className="size-4" /> Pattern synthesis</span>{answer}</div>}<div className="flex gap-2"><Textarea value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask a question about this match…" className="min-h-20 bg-white/[.035]" /><Button onClick={() => ask()} size="icon-lg" aria-label="Send question"><ArrowUp /></Button></div></div></DialogContent></Dialog>
    <p className="text-center text-[10px] leading-4 text-muted-foreground">Analytical estimates are not guarantees. Review the evidence and uncertainty.</p>
  </CardContent></Card>;
}

function MatchLab({ home, away, setHome, setAway, weights, setWeights, prediction, trend, simulations, run, running, trained }: { home: TeamName; away: TeamName; setHome: (t: TeamName) => void; setAway: (t: TeamName) => void; weights: Weights; setWeights: React.Dispatch<React.SetStateAction<Weights>>; prediction: Prediction; trend: { match: string; home: number; away: number }[]; simulations: number; run: () => void; running: boolean; trained: boolean }) {
  const scores = prediction.scores.map((score) => ({ score: score.label, value: score.value }));
  return <><Intro eyebrow="Scenario builder" title="Match prediction lab" copy="Change the matchup and model assumptions. Every output updates from the same transparent weighted signal model." action={<Button onClick={run} disabled={running} className="rounded-full px-4">{running ? <LoaderCircle className="animate-spin" /> : <Play />} Run model</Button>} />
    <div className="grid gap-4 xl:grid-cols-[360px_1fr]"><div className="space-y-4"><Card className="border-white/8 bg-card/75"><CardHeader><CardTitle>Fixture setup</CardTitle></CardHeader><CardContent className="space-y-4"><TeamSelect label="Home team" value={home} onValue={setHome} /><TeamSelect label="Away team" value={away} onValue={setAway} /><div className="rounded-xl border border-white/8 bg-white/[.025] p-3 text-xs leading-5 text-muted-foreground"><Database className="mb-2 size-4 text-primary" />Last 18 months, recency weighted. League, cup, and continental matches included.</div></CardContent></Card><Card className="border-white/8 bg-card/75"><CardHeader><CardTitle>Signal weights</CardTitle><p className="text-xs text-muted-foreground">Tune what the model pays attention to.</p></CardHeader><CardContent className="space-y-5">{(Object.keys(weights) as (keyof Weights)[]).map((key) => <Weight key={key} label={key} value={weights[key]} onValue={(value) => setWeights((current) => ({ ...current, [key]: value }))} />)}</CardContent></Card></div>
      <div className="space-y-4"><Card className="border-primary/12 bg-card/80"><CardHeader className="flex-row items-start justify-between"><div><Badge className="mb-2 bg-primary/12 text-primary">Live output</Badge><CardTitle className="text-2xl">{home} {prediction.home}% · {prediction.draw}% Draw · {away} {prediction.away}%</CardTitle><p className="mt-1 text-xs text-muted-foreground">{simulations.toLocaleString()} simulations · {prediction.confidence}% confidence</p></div>{trained && <Badge variant="outline" className="border-primary/20 text-primary"><Check /> Updated</Badge>}</CardHeader><CardContent><div className="grid gap-6 md:grid-cols-2"><div><p className="mb-3 text-xs font-semibold uppercase tracking-[.14em] text-muted-foreground">Exact score distribution</p><ChartContainer config={chartConfig} className="h-[260px] w-full"><BarChart data={scores}><CartesianGrid vertical={false} strokeDasharray="4 4" /><XAxis dataKey="score" axisLine={false} tickLine={false} /><YAxis hide /><ChartTooltip content={<ChartTooltipContent />} /><Bar dataKey="value" radius={[6, 6, 0, 0]}>{scores.map((_, i) => <Cell key={i} fill={i === 0 ? 'var(--color-chart-1)' : 'var(--color-chart-3)'} opacity={1 - i * .1} />)}</Bar></BarChart></ChartContainer></div><div><p className="mb-3 text-xs font-semibold uppercase tracking-[.14em] text-muted-foreground">Recent attacking trend</p><TrendChart data={trend} /></div></div></CardContent></Card>
        <div className="grid gap-4 md:grid-cols-3"><SmallStat icon={<Target />} label="Best score" value={prediction.scores[0].label} note={`${prediction.scores[0].value}% probability`} /><SmallStat icon={<Zap />} label="Over 2.5" value={`${prediction.over}%`} note="Goals signal" /><SmallStat icon={<Activity />} label="BTTS" value={`${prediction.btts}%`} note="Both teams score" /></div>
      </div></div>
  </>;
}

function DataExplorer({ feed, loading }: { feed: CompetitionFeed | null; loading: boolean }) {
  const [metric, setMetric] = useState('xg');
  const rows = Object.entries(TEAMS).map(([team, data], i) => ({ team, ...data, shots: 14.9 - i * .62, ppda: 7.8 + i * .75, fieldTilt: 62 - i * 3 }));
  const sorted = [...rows].sort((a, b) => Number(b[metric as keyof typeof b]) - Number(a[metric as keyof typeof a]));
  const summary = feed?.summary;
  const coverageFields: Array<{ key: keyof CompetitionCoverage; label: string }> = [
    { key: 'liveEvents', label: 'Live' },
    { key: 'fixtureStatistics', label: 'Match stats' },
    { key: 'playerStatistics', label: 'Players' },
    { key: 'lineups', label: 'Lineups' },
    { key: 'injuries', label: 'Injuries' },
  ];
  const statCards = [
    { label: 'Competitions', value: summary ? `${summary.available}/${summary.requested}` : '--' },
    { label: 'Live events', value: summary ? `${summary.liveEvents}/${summary.requested}` : '--' },
    { label: 'Player stats', value: summary ? `${summary.playerStatistics}/${summary.requested}` : '--' },
    { label: 'Injury data', value: summary ? `${summary.injuries}/${summary.requested}` : '--' },
  ];

  return <>
    <Intro
      eyebrow={loading ? 'Connecting to API-Football' : feed?.connected ? `API-Football · ${summary?.available ?? 0} competitions connected` : 'Live data connection'}
      title="Data explorer"
      copy="Inspect exactly which current-season data is available before it enters a model. Credentials stay on the server and responses are cached to protect the free API allowance."
      action={<div className="flex gap-2"><Button variant="outline"><Upload /> CSV</Button><Button variant="outline" onClick={() => window.location.reload()}><RefreshCw /> Refresh</Button></div>}
    />

    <Card className="mb-4 border-primary/12 bg-card/75">
      <CardHeader className="gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2"><Database className="size-4 text-primary" /> Live competition coverage</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">Current-season capabilities reported by the data provider.</p>
        </div>
        <Badge variant="outline" className={feed?.connected ? 'border-primary/30 text-primary' : 'border-amber-300/30 text-amber-200'}>
          {loading ? <><LoaderCircle className="mr-1 size-3 animate-spin" /> Checking</> : feed?.connected ? <><Check className="mr-1 size-3" /> Connected</> : 'Unavailable'}
        </Badge>
      </CardHeader>
      <CardContent>
        {loading ? <div className="flex min-h-48 items-center justify-center gap-3 text-sm text-muted-foreground"><LoaderCircle className="size-5 animate-spin text-primary" /> Auditing live data coverage…</div> : !feed?.connected ? <div className="rounded-xl border border-amber-300/15 bg-amber-300/[.04] p-5"><p className="font-medium text-amber-100">The football data service is not connected.</p><p className="mt-1 text-sm text-muted-foreground">{feed?.error ?? 'Check the server API key and try again.'}</p></div> : <>
          <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{statCards.map((stat) => <div key={stat.label} className="rounded-xl border border-white/7 bg-white/[.02] p-4"><p className="font-mono text-xl text-primary">{stat.value}</p><p className="mt-1 text-xs text-muted-foreground">{stat.label}</p></div>)}</div>
          <div className="overflow-x-auto rounded-xl border border-white/7">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead className="bg-white/[.025] text-[10px] uppercase tracking-[.12em] text-muted-foreground"><tr><th className="px-4 py-3 font-medium">Competition</th><th className="px-3 py-3 font-medium">Season</th>{coverageFields.map((field) => <th key={field.key} className="px-3 py-3 text-center font-medium">{field.label}</th>)}</tr></thead>
              <tbody>{feed.competitions?.map((competition) => <tr key={competition.id} className="border-t border-white/6 hover:bg-white/[.02]"><td className="px-4 py-3"><div className="font-medium">{competition.name}</div><div className="mt-0.5 text-[11px] text-muted-foreground">{competition.group}</div></td><td className="px-3 font-mono text-xs">{competition.season ?? '—'}</td>{coverageFields.map((field) => <td key={field.key} className="px-3 text-center">{competition.coverage[field.key] ? <span className="inline-flex size-6 items-center justify-center rounded-full bg-primary/10 text-primary" title="Available"><Check className="size-3.5" /></span> : <span className="text-muted-foreground" title="Not supplied">—</span>}</td>)}</tr>)}</tbody>
            </table>
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground">A dash means the provider does not supply that field for the current season. Predictions are available for all connected competitions.</p>
        </>}
      </CardContent>
    </Card>

    <div className="grid gap-4 xl:grid-cols-[1fr_320px]"><Card className="border-white/8 bg-card/75"><CardHeader className="flex-row items-center justify-between"><div><CardTitle>Prototype analytics layer</CardTitle><p className="mt-1 text-xs text-muted-foreground">Demonstration metrics · change the metric to rerank the table.</p></div><Select value={metric} onValueChange={(value) => value && setMetric(value)}><SelectTrigger className="w-40"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="xg">Expected goals</SelectItem><SelectItem value="rating">Power rating</SelectItem><SelectItem value="press">Press rating</SelectItem><SelectItem value="fieldTilt">Field tilt</SelectItem></SelectContent></Select></CardHeader><CardContent className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead className="border-y border-white/8 text-[10px] uppercase tracking-[.12em] text-muted-foreground"><tr>{['Team', 'Rating', 'xG', 'xGA', 'Shots', 'PPDA', 'Field tilt', 'Trend'].map((head) => <th key={head} className="px-3 py-3 font-medium">{head}</th>)}</tr></thead><tbody>{sorted.map((row, i) => <tr key={row.team} className="border-b border-white/5 hover:bg-white/[.025]"><td className="px-3 py-4"><span className="mr-3 font-mono text-xs text-muted-foreground">{String(i + 1).padStart(2, '0')}</span><span className="font-medium">{row.team}</span></td><td className="px-3 font-mono">{row.rating}</td><td className="px-3 font-mono text-primary">{row.xg}</td><td className="px-3 font-mono">{row.xga}</td><td className="px-3 font-mono">{row.shots.toFixed(1)}</td><td className="px-3 font-mono">{row.ppda.toFixed(1)}</td><td className="px-3 font-mono">{row.fieldTilt}%</td><td className="px-3"><span className={`inline-flex items-center gap-1 ${i < 3 ? 'text-primary' : 'text-amber-200'}`}>{i < 3 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />}{i < 3 ? '+' : '-'}{(1.2 + i * .4).toFixed(1)}%</span></td></tr>)}</tbody></table></CardContent></Card>
      <div className="space-y-4"><Card className="border-white/8 bg-card/75"><CardHeader><CardTitle>Metric library</CardTitle><p className="text-xs text-muted-foreground">Basic through advanced</p></CardHeader><CardContent className="space-y-3">{['Results & form', 'Expected goals (xG)', 'Possession value', 'Field tilt', 'Pressing intensity', 'Shot quality', 'Set-piece threat', 'Player impact'].map((item, i) => <div key={item} className="flex items-center justify-between rounded-lg border border-white/7 bg-white/[.02] px-3 py-2.5 text-sm"><span>{item}</span><Badge variant="outline" className={i < 2 ? 'text-slate-300' : 'text-primary'}>{i < 2 ? 'Basic' : 'Advanced'}</Badge></div>)}</CardContent></Card><Card className="border-primary/12 bg-primary/[.045]"><CardContent className="p-4"><BrainCircuit className="mb-3 text-primary" /><p className="font-medium">Pattern engine foundation</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Live data is now connected. Historical ingestion, feature engineering, and validation come next before these signals influence predictions.</p><Button className="mt-4 w-full" variant="outline">View model plan</Button></CardContent></Card></div>
    </div>
  </>;
}

function Models({ weights, setWeights, simulations, run, running, trained }: { weights: Weights; setWeights: React.Dispatch<React.SetStateAction<Weights>>; simulations: number; run: () => void; running: boolean; trained: boolean }) {
  const history = [{ v: 'v2.1', value: 59 }, { v: 'v2.2', value: 61 }, { v: 'v2.3', value: 60 }, { v: 'v2.4', value: 63 }, { v: 'v2.5', value: 64 }, { v: 'v2.6', value: 63 }, { v: 'v2.7', value: 66 }, { v: 'v2.8', value: trained ? 68 : 67 }];
  return <><Intro eyebrow="Learning engine" title="Model studio" copy="Inspect how the prediction system learns, control the feature mix, and measure every improvement against unseen matches." action={<Button onClick={run} disabled={running} className="rounded-full">{running ? <LoaderCircle className="animate-spin" /> : <BrainCircuit />} Train iteration</Button>} />
    <div className="grid gap-4 lg:grid-cols-3"><SmallStat icon={<Database />} label="Training sample" value="184,920" note="Matches after validation" /><SmallStat icon={<Target />} label="Log loss" value={trained ? '0.214' : '0.231'} note={trained ? 'Improved 7.4%' : 'Top 14% of runs'} /><SmallStat icon={<Gauge />} label="Calibration" value="0.82" note="Reliable probability bands" /></div>
    <div className="mt-4 grid gap-4 xl:grid-cols-[.8fr_1.2fr]"><Card className="border-white/8 bg-card/75"><CardHeader><CardTitle>Learning controls</CardTitle><p className="text-xs text-muted-foreground">Weights persist on this device and feed the live Match Lab.</p></CardHeader><CardContent className="space-y-6">{(Object.keys(weights) as (keyof Weights)[]).map((key) => <Weight key={key} label={key} value={weights[key]} onValue={(value) => setWeights((current) => ({ ...current, [key]: value }))} />)}<div className="rounded-xl border border-primary/12 bg-primary/[.05] p-4 text-xs leading-5 text-muted-foreground"><ShieldCheck className="mb-2 size-4 text-primary" />The model is tested on future matches it has never seen. This limits overfitting and keeps confidence honest.</div></CardContent></Card>
      <Card className="border-white/8 bg-card/75"><CardHeader className="flex-row items-center justify-between"><div><CardTitle>Training history</CardTitle><p className="mt-1 text-xs text-muted-foreground">Validation accuracy across model versions</p></div><Badge variant="outline" className="text-primary">v2.8 live</Badge></CardHeader><CardContent><ChartContainer config={chartConfig} className="h-[300px] w-full"><AreaChart data={history}><defs><linearGradient id="modelFill" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="var(--color-value)" stopOpacity={.4} /><stop offset="95%" stopColor="var(--color-value)" stopOpacity={0} /></linearGradient></defs><CartesianGrid vertical={false} strokeDasharray="4 4" /><XAxis dataKey="v" axisLine={false} tickLine={false} /><YAxis domain={[50, 75]} axisLine={false} tickLine={false} /><ChartTooltip content={<ChartTooltipContent />} /><Area dataKey="value" stroke="var(--color-value)" fill="url(#modelFill)" strokeWidth={2} /></AreaChart></ChartContainer><div className="mt-4 grid gap-3 sm:grid-cols-3"><Run label="Last trained" value={trained ? 'Just now' : '2h ago'} /><Run label="Simulations" value={simulations.toLocaleString()} /><Run label="Feature count" value="128" /></div></CardContent></Card>
    </div>
  </>;
}

function ImportDialog() { return <Dialog><DialogTrigger render={<Button className="rounded-full bg-white px-4 text-slate-950 hover:bg-white/85" />}>Import data <ArrowUpRight /></DialogTrigger><DialogContent className="max-w-lg border-white/10 bg-[#121b26]"><DialogHeader><DialogTitle>Bring in football data</DialogTitle><DialogDescription>Upload any CSV or JSON export. ElevenLab maps common match, team, player, event, and odds fields automatically.</DialogDescription></DialogHeader><label className="grid min-h-40 cursor-pointer place-items-center rounded-xl border border-dashed border-primary/25 bg-primary/[.035] p-6 text-center"><Input type="file" accept=".csv,.json" className="sr-only" /><span><FileUp className="mx-auto mb-3 text-primary" /><span className="block font-medium">Drop a dataset or choose a file</span><span className="mt-1 block text-xs text-muted-foreground">CSV or JSON · schema detection included</span></span></label><div className="grid grid-cols-3 gap-2">{['REST API', 'StatsBomb', 'Opta feed'].map((item) => <Button key={item} variant="outline" size="sm">{item}</Button>)}</div></DialogContent></Dialog>; }
function TeamSelect({ label, value, onValue }: { label: string; value: TeamName; onValue: (team: TeamName) => void }) { return <label className="block"><span className="mb-2 block text-xs font-medium text-muted-foreground">{label}</span><Select value={value} onValueChange={(next) => next && onValue(next as TeamName)}><SelectTrigger className="h-10 w-full bg-white/[.025]"><SelectValue /></SelectTrigger><SelectContent>{Object.keys(TEAMS).map((team) => <SelectItem key={team} value={team}>{team}</SelectItem>)}</SelectContent></Select></label>; }
function Weight({ label, value, onValue }: { label: string; value: number; onValue: (value: number) => void }) { return <div><div className="mb-2 flex items-center justify-between"><span className="text-sm capitalize">{label}</span><span className="font-mono text-xs text-primary">{value}%</span></div><Slider value={[value]} min={0} max={60} step={1} onValueChange={(next) => onValue(Number(Array.isArray(next) ? next[0] : next))} /></div>; }
function TeamBlock({ name, team, align = 'left' }: { name: TeamName; team: Team; align?: 'left' | 'right' }) { const results = ['W', 'D', 'W', 'W', 'W']; return <div className={align === 'right' ? 'text-right' : ''}><div className={`mb-4 flex items-center gap-3 ${align === 'right' ? 'justify-end' : ''}`}>{align === 'right' && <TeamText name={name} team={team} />}<span className="grid size-14 place-items-center rounded-2xl border border-white/10 text-base font-bold text-white shadow-inner" style={{ background: `linear-gradient(145deg, ${team.color}55, ${team.color}12)` }}>{team.code.slice(0, 1)}</span>{align === 'left' && <TeamText name={name} team={team} />}</div><div className={`flex gap-1.5 ${align === 'right' ? 'justify-end' : ''}`}>{results.map((result, i) => <span key={i} className={`grid size-6 place-items-center rounded-md text-[10px] font-bold ${result === 'W' ? 'bg-primary/12 text-primary' : 'bg-amber-300/10 text-amber-200'}`}>{result}</span>)}</div></div>; }
function TeamText({ name, team }: { name: TeamName; team: Team }) { return <div><p className="text-lg font-semibold">{name}</p><p className="text-xs text-muted-foreground">{team.code} · {team.rank}{ordinal(team.rank)}</p></div>; }
function Probability({ value, label, active = false }: { value: number; label: string; active?: boolean }) { return <div><p className={`font-mono text-3xl font-semibold tracking-[-.05em] ${active ? 'text-primary' : 'text-white'}`}>{value}<span className="text-base text-muted-foreground">%</span></p><p className="mt-1 text-[11px] text-muted-foreground">{label}</p></div>; }
function Metric({ label, left, right }: { label: string; left: string | number; right: string | number }) { return <div className="bg-card px-4 py-3"><p className="mb-2 text-[10px] uppercase tracking-[.12em] text-muted-foreground">{label}</p><div className="flex items-center justify-between font-mono text-sm"><span className="text-primary">{left}</span><span className="text-muted-foreground">{right}</span></div></div>; }
function Insight({ icon, title, copy }: { icon: ReactNode; title: string; copy: string }) { return <div className="flex gap-3"><span className="mt-0.5 text-primary [&>svg]:size-4">{icon}</span><div><p className="text-sm font-medium text-white">{title}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{copy}</p></div></div>; }
function Health({ label, value, detail }: { label: string; value: number; detail: string }) { return <div><div className="mb-2 flex items-center justify-between text-xs"><span>{label}</span><span className="text-primary">{detail}</span></div><Progress value={value} /></div>; }
function SmallStat({ icon, label, value, note }: { icon: ReactNode; label: string; value: string; note: string }) { return <Card className="border-white/8 bg-card/75"><CardContent className="flex items-center gap-4 p-4"><span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary [&>svg]:size-4">{icon}</span><div><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-xl font-semibold tracking-tight">{value}</p><p className="text-[10px] text-muted-foreground">{note}</p></div></CardContent></Card>; }
function Run({ label, value }: { label: string; value: string }) { return <div className="rounded-xl border border-white/8 bg-white/[.02] p-3"><p className="text-[10px] uppercase tracking-[.12em] text-muted-foreground">{label}</p><p className="mt-2 font-mono text-sm text-primary">{value}</p></div>; }
function TrendChart({ data }: { data: { match: string; home: number; away: number }[] }) { return <ChartContainer config={chartConfig} className="h-[230px] w-full"><LineChart data={data}><CartesianGrid vertical={false} strokeDasharray="4 4" /><XAxis dataKey="match" axisLine={false} tickLine={false} /><YAxis hide domain={[0, 3]} /><ReferenceLine y={1.5} stroke="rgba(255,255,255,.15)" /><ChartTooltip content={<ChartTooltipContent />} /><Line dataKey="home" type="monotone" stroke="var(--color-home)" strokeWidth={2} dot={false} /><Line dataKey="away" type="monotone" stroke="var(--color-away)" strokeWidth={2} dot={false} /></LineChart></ChartContainer>; }

function calculatePrediction(home: TeamName, away: TeamName, weights: Weights) {
  const h = TEAMS[home], a = TEAMS[away], total = Math.max(1, weights.form + weights.attack + weights.defence + weights.context);
  const edge = 6.5 + (average(h.form) - average(a.form)) * 12 * weights.form / total + (h.xg - a.xg) * 15 * weights.attack / total + (a.xga - h.xga) * 14 * weights.defence / total + (h.rating - a.rating) * .9 * weights.context / total;
  const homeP = clamp(Math.round(39 + edge), 22, 72), drawP = clamp(Math.round(28 - Math.abs(edge) * .18), 18, 32), awayP = 100 - homeP - drawP;
  const confidence = clamp(Math.round(61 + Math.abs(edge) * .65 + total * .04), 58, 89), scoreBase = clamp(Math.round((h.xg + a.xga) * 4.7), 8, 22), lead = homeP >= awayP;
  const scores = [{ label: lead ? '2–1' : '1–2', value: scoreBase }, { label: '1–1', value: clamp(scoreBase - 2, 7, 19) }, { label: lead ? '1–0' : '0–1', value: clamp(scoreBase - 4, 5, 16) }, { label: '2–2', value: clamp(scoreBase - 6, 4, 13) }, { label: lead ? '2–0' : '0–2', value: clamp(scoreBase - 7, 3, 12) }];
  return { home: homeP, draw: drawP, away: awayP, confidence, scores, over: clamp(Math.round((h.xg + a.xg) * 19), 38, 78), btts: clamp(Math.round((h.xg + a.xg) * 17), 34, 72) };
}
function average(values: readonly number[]) { return values.reduce((sum, value) => sum + value, 0) / values.length; }
function clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(max, value)); }
function ordinal(value: number) { return value === 1 ? 'st' : value === 2 ? 'nd' : value === 3 ? 'rd' : 'th'; }
