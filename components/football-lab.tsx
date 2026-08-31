'use client';

import { createElement, useEffect, useState, type Key, type ReactNode } from 'react';
import {
  Activity, ArrowUpRight, BrainCircuit, Check, CircleDot, Database, Gauge,
  LineChart as LineIcon, LoaderCircle, RefreshCw, Search, ShieldCheck, Target,
  Upload, Zap,
} from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ReferenceLine, XAxis, YAxis } from 'recharts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

type View = 'Overview' | 'Live Centre' | 'Match Lab' | 'Imports' | 'Data Explorer' | 'Models';
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
type TeamAnalysis = { connected: boolean; team?: { id: number; name: string; logo: string | null }; season?: number; overall?: TeamSplit; home?: TeamSplit; away?: TeamSplit; form?: Array<{ id: number; kickoff: string; opponent: string; location: string; gf: number; ga: number; result: string }>; next?: { id: number; kickoff: string; opponent: string; location: string; venue: string | null } | null; error?: string };
type TeamSplit = { played: number; won: number; drawn: number; lost: number; gf: number; ga: number; cleanSheets: number; btts: number; over25: number };
type MatchAnalysis = { connected: boolean; match?: StoredFixture & { round: string | null }; form?: { home: Array<{ opponent: string; gf: number; ga: number; result: string }>; away: Array<{ opponent: string; gf: number; ga: number; result: string }> }; h2h?: Array<{ id: number; home_name: string; away_name: string; home_goals: number; away_goals: number }>; statistics?: Array<{ team: { id: number; name?: string; logo?: string | null }; statistics: Array<{ type: string; value: string | number | null }> }>; statisticsSource?: 'stored' | 'provider' | null; lineups?: Array<{ teamId: number; formation: string | null; coach: string | null; starters: Array<{ name: string; number: number | null; position: string | null }>; substitutes: Array<{ name: string }> }>; odds?: Array<{ bookmakerId: number; bookmaker: string; prices: { home: number | null; draw: number | null; away: number | null; over25: number | null; under25: number | null; bttsYes: number | null; bttsNo: number | null } }>; market?: { bookmakers: number; overround: number; probabilities: { home: number; draw: number; away: number } } | null; error?: string };
type BaselinePrediction = {
  connected: boolean;
  fixture?: { id: number; competition: string; season: number; kickoff: string; round: string | null; venue: string | null; home: StoredFixture['home']; away: StoredFixture['away'] };
  model?: { name: string; version: string; trainedThrough: string | null; trainingMatches: number; usesFutureData: boolean };
  probabilities?: { home: number; draw: number; away: number };
  expectedGoals?: { home: number; away: number };
  markets?: { over25: number; btts: number };
  scorelines?: Array<{ score: string; probability: number }>;
  evidence?: { homeElo: number; awayElo: number; homeMatches: number; awayMatches: number; leagueHomeGoals: number; leagueAwayGoals: number; homeAttack: number; awayAttack: number; homeDefence: number; awayDefence: number };
  validation?: { matches: number; accuracy: number; brier: number | null; logLoss: number | null; methodology: string };
  market?: { bookmakers: number; overround: number; probabilities: { home: number; draw: number; away: number } } | null;
  confidence?: number;
  sampleWarning?: string;
  error?: string;
};
type HistoricalImport = { connected: boolean; records?: number; imported?: number; seasons?: Array<{ season: number; records: number; status: string }>; error?: string };
type ImportSeasonStatus = {
  competitionId: number;
  season: number;
  name: string;
  country: string | null;
  logo: string | null;
  records: number;
  lastUpdatedAt: string;
  sync: { status: string; records: number; error: string | null; startedAt: string; finishedAt: string | null } | null;
};
type ImportStatusFeed = {
  connected: boolean;
  seasons?: ImportSeasonStatus[];
  quota?: { current: number; limit: number; remaining: number; plan: string | null; active: boolean | null } | null;
  summary?: { records: number; storedSeasons: number; completedSeasons: number; failedSeasons: number };
  checkedAt?: string;
  error?: string;
};
type ModelEvaluationFeed = {
  connected: boolean;
  model?: { name: string; version: string; usesFutureData: boolean };
  summary?: { competitions: number; trainingMatches: number; validationMatches: number; accuracy: number | null; brier: number | null; logLoss: number | null };
  evaluations?: Array<{ competitionId: number; competition: string; latestSeason: number; trainingMatches: number; seasons: number; trainedThrough: string | null; validation: { matches: number; accuracy: number; brier: number | null; logLoss: number | null; methodology: string } }>;
  methodology?: string;
  checkedAt?: string;
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
const EMPTY_FIXTURES: StoredFixture[] = [];

type DetailCoverageFeed = {
  connected: boolean;
  summary?: {
    seasons: number;
    fixtures: number;
    completed: number;
    statistics: { stored: number; of: number };
    lineups: { stored: number; of: number };
    odds: { stored: number; of: number };
  };
  error?: string;
};
type ForecastRecordFeed = {
  connected: boolean;
  model?: { name: string; version: string };
  windowDays?: number;
  coverage?: {
    upcoming: number;
    covered: number;
    byCompetition: Array<{ competitionId: number; competition: string | null; upcoming: number; covered: number }>;
  };
  awaitingResult?: number;
  performance?: ForecastScore;
  marketComparison?: { matches: number; modelBrier: number | null; marketBrier: number | null; brierDifference: number | null; modelLogLoss: number | null; marketLogLoss: number | null; logLossDifference: number | null };
  byCompetition?: Array<ForecastScore & { competitionId: number; competition: string | null }>;
  calibration?: {
    points: number;
    expectedCalibrationError: number | null;
    bins: Array<{ from: number; to: number; count: number; predicted: number; observed: number }>;
  };
  methodology?: string;
  error?: string;
};
type ForecastScore = {
  matches: number;
  accuracy: number | null;
  brier: number | null;
  logLoss: number | null;
  medianLeadHours: number | null;
};

const chartConfig = {
  home: { label: 'Home xG', color: 'var(--color-chart-1)' },
  away: { label: 'Away xG', color: 'var(--color-chart-3)' },
  value: { label: 'Probability', color: 'var(--color-chart-1)' },
  observed: { label: 'Observed frequency', color: 'var(--color-chart-1)' },
} satisfies ChartConfig;

export function FootballLab() {
  const [view, setView] = useState<View>('Overview');
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
    let refreshing = false;
    setIntelligenceLoading(true);
    const refresh = () => {
      if (refreshing) return;
      refreshing = true;
      fetch(`/api/football/intelligence?league=${selectedLeague}&season=${selectedSeason}`, { cache: 'no-store' })
        .then(async (response) => {
          const payload = await response.json() as IntelligenceFeed;
          if (active) setIntelligence(payload);
        })
        .catch(() => {
          if (active) setIntelligence({ connected: false, error: 'The competition database could not be reached.' });
        })
        .finally(() => {
          refreshing = false;
          if (active) setIntelligenceLoading(false);
        });
    };
    const refreshWhenVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    refresh();
    const interval = window.setInterval(refresh, 5 * 60_000);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    window.addEventListener('focus', refresh);
    return () => {
      active = false;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
      window.removeEventListener('focus', refresh);
    };
  }, [selectedLeague, selectedSeason]);
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

  return <main className="min-h-screen bg-background text-foreground">
    <Header view={view} setView={setView} connected={competitionFeed?.connected === true} feedLoading={feedLoading} />
    <div className="mx-auto max-w-[1480px] px-4 py-6 sm:px-6 lg:px-8">
      {view === 'Overview' && <Overview feed={fixtureFeed} loading={fixturesLoading} intelligence={intelligence} intelligenceLoading={intelligenceLoading} competitions={competitionFeed?.competitions ?? []} selectedLeague={selectedLeague} setSelectedLeague={setSelectedLeague} setView={setView} />}
      {view === 'Live Centre' && <LiveCentre competitions={competitionFeed?.competitions ?? []} selectedLeague={selectedLeague} selectedSeason={selectedSeason ?? 2026} setSelectedLeague={setSelectedLeague} />}
      {view === 'Match Lab' && <MatchLab competitions={competitionFeed?.competitions ?? []} selectedLeague={selectedLeague} selectedSeason={selectedSeason ?? 2026} setSelectedLeague={setSelectedLeague} intelligence={intelligence} intelligenceLoading={intelligenceLoading} />}
      {view === 'Imports' && <ImportDashboard competitions={competitionFeed?.competitions ?? []} />}
      {view === 'Data Explorer' && <DataExplorer feed={competitionFeed} loading={feedLoading} />}
      {view === 'Models' && <Models />}
    </div>
  </main>;
}

function Header({ view, setView, connected, feedLoading }: { view: View; setView: (view: View) => void; connected: boolean; feedLoading: boolean }) {
  const views: View[] = ['Overview', 'Live Centre', 'Match Lab', 'Imports', 'Data Explorer', 'Models'];
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
        <Button onClick={() => setView('Imports')} className="rounded-full bg-white px-4 text-slate-950 hover:bg-white/85">Manage imports <ArrowUpRight /></Button>
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

function LiveCentre({ competitions, selectedLeague, selectedSeason, setSelectedLeague }: { competitions: LiveCompetition[]; selectedLeague: number; selectedSeason: number; setSelectedLeague: (league: number) => void }) {
  const displayCompetitions = competitions.length ? competitions : FIXTURE_COMPETITIONS;
  const selectedCompetition = displayCompetitions.find((competition) => competition.id === selectedLeague);
  useEffect(() => {
    if (document.querySelector('script[data-api-sports-widgets]')) return;
    const script = document.createElement('script');
    script.type = 'module';
    script.crossOrigin = 'anonymous';
    script.src = 'https://widgets.api-sports.io/3.1.0/widgets.js';
    script.dataset.apiSportsWidgets = 'true';
    document.head.appendChild(script);
  }, []);
  const widget = (type: string, props: Record<string, string> = {}) => createElement('api-sports-widget', { 'data-type': type, ...props });
  const context = { 'data-league': String(selectedLeague), 'data-season': String(selectedSeason) };
  return <>
    <Intro eyebrow="Provider-powered widgets" title="Live centre" copy="Live schedules, standings, match events, line-ups, statistics, teams and players are linked in one workspace. Select a match to open its live detail view." action={<Select value={String(selectedLeague)} onValueChange={(value) => value && setSelectedLeague(Number(value))}><SelectTrigger className="w-[230px]"><span className="truncate">{selectedCompetition?.name ?? 'Premier League'}</span></SelectTrigger><SelectContent>{displayCompetitions.map((competition) => <SelectItem key={competition.id} value={String(competition.id)}>{competition.name}</SelectItem>)}</SelectContent></Select>} />
    <div className="mb-4 flex items-start gap-3 rounded-xl border border-primary/15 bg-primary/[.035] p-4 text-xs leading-5 text-muted-foreground"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" /><p>The widgets use ElevenLab’s cached server gateway, so the provider key is never embedded in the page. Live views refresh once per minute to control quota usage.</p></div>
    <div key={`${selectedLeague}-${selectedSeason}`} className="grid gap-4 xl:grid-cols-[.9fr_1.2fr_.9fr] [&_api-sports-widget]:block [&_api-sports-widget]:min-h-[420px] [&_api-sports-widget]:overflow-hidden [&_api-sports-widget]:rounded-xl">
      {widget('config', { 'data-key': '', 'data-url-football': '/api/football/widget/', 'data-sport': 'football', 'data-lang': 'en', 'data-theme': 'dark', 'data-show-errors': 'true', 'data-show-logos': 'true', 'data-refresh': '60', 'data-favorite': 'true', 'data-player-injuries': 'true', 'data-team-squad': 'true', 'data-team-statistics': 'true', 'data-player-statistics': 'true', 'data-game-tab': 'statistics', 'data-standings': 'true', 'data-target-game': '#widget-game', 'data-target-team': 'modal', 'data-target-player': 'modal', ...context })}
      <Card className="border-white/8 bg-card/75"><CardHeader><CardTitle>Fixtures & live scores</CardTitle><p className="text-xs text-muted-foreground">{selectedCompetition?.name} · click a match for detail</p></CardHeader><CardContent className="p-2">{widget('games', { ...context, 'data-target-game': '#widget-game', 'data-standings': 'true' })}</CardContent></Card>
      <Card className="border-primary/12 bg-card/75"><CardHeader><CardTitle>Match detail</CardTitle><p className="text-xs text-muted-foreground">Events, line-ups and provider statistics</p></CardHeader><CardContent id="widget-game" className="min-h-[460px] p-2"><div className="grid min-h-[420px] place-items-center rounded-xl border border-dashed border-white/10 p-8 text-center text-sm text-muted-foreground"><span><Target className="mx-auto mb-3 size-7 text-primary/60" />Select a fixture in the live schedule</span></div></CardContent></Card>
      <Card className="border-white/8 bg-card/75"><CardHeader><CardTitle>Standings</CardTitle><p className="text-xs text-muted-foreground">Provider table and team drill-downs</p></CardHeader><CardContent id="widget-standings" className="p-2">{widget('standings', context)}</CardContent></Card>
    </div>
  </>;
}

function CompetitionDatabase({ feed, loading }: { feed: IntelligenceFeed | null; loading: boolean }) {
  const [teamAnalysis, setTeamAnalysis] = useState<TeamAnalysis | null>(null);
  const [teamLoading, setTeamLoading] = useState(false);
  const [teamOpen, setTeamOpen] = useState(false);
  const [matchAnalysis, setMatchAnalysis] = useState<MatchAnalysis | null>(null);
  const [matchLoading, setMatchLoading] = useState(false);
  const [matchOpen, setMatchOpen] = useState(false);
  const [prediction, setPrediction] = useState<BaselinePrediction | null>(null);
  const [predictionLoading, setPredictionLoading] = useState(false);
  const [predictionOpen, setPredictionOpen] = useState(false);
  const [historyImport, setHistoryImport] = useState<HistoricalImport | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyProgress, setHistoryProgress] = useState('');
  const loadTeam = (teamId: number) => {
    if (!feed?.competition) return;
    setTeamOpen(true); setTeamLoading(true); setTeamAnalysis(null);
    fetch(`/api/football/team?team=${teamId}&league=${feed.competition.id}&season=${feed.competition.season}`).then(async (response) => await response.json() as TeamAnalysis).then((data) => setTeamAnalysis(data)).catch(() => setTeamAnalysis({ connected: false, error: 'Team analysis could not be reached.' })).finally(() => setTeamLoading(false));
  };
  const loadMatch = (fixtureId: number) => {
    setMatchOpen(true); setMatchLoading(true); setMatchAnalysis(null);
    fetch(`/api/football/match?fixture=${fixtureId}`).then(async (response) => await response.json() as MatchAnalysis).then((data) => setMatchAnalysis(data)).catch(() => setMatchAnalysis({ connected: false, error: 'Match analysis could not be reached.' })).finally(() => setMatchLoading(false));
  };
  const loadPrediction = (fixtureId: number) => {
    setPredictionOpen(true); setPredictionLoading(true); setPrediction(null);
    fetch(`/api/football/prediction?fixture=${fixtureId}`).then(async (response) => await response.json() as BaselinePrediction).then((data) => setPrediction(data)).catch(() => setPrediction({ connected: false, error: 'The prediction model could not be reached.' })).finally(() => setPredictionLoading(false));
  };
  const importHistory = async () => {
    if (!feed?.competition) return;
    const seasons = Array.from({ length: 5 }, (_, index) => feed.competition!.season - 5 + index);
    setHistoryLoading(true); setHistoryImport(null);
    const importedSeasons: NonNullable<HistoricalImport['seasons']> = [];
    try {
      for (let index = 0; index < seasons.length; index++) {
        const season = seasons[index];
        setHistoryProgress(`Importing ${season}/${String(season + 1).slice(-2)} · ${index + 1} of ${seasons.length}`);
        let result: HistoricalImport | null = null;
        for (let attempt = 0; attempt < 4; attempt++) {
          const response = await fetch('/api/football/history', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ league: feed.competition.id, seasons: [season] }) });
          result = await response.json() as HistoricalImport;
          if (result.connected || !result.error?.toLowerCase().includes('too many requests')) break;
          setHistoryProgress(`Provider limit reached · retrying ${season} shortly`);
          await new Promise((resolve) => window.setTimeout(resolve, 20_000));
        }
        if (!result?.connected || !result.seasons?.[0]) throw new Error(result?.error ?? `Season ${season} could not be imported.`);
        importedSeasons.push(result.seasons[0]);
        if (index < seasons.length - 1) await new Promise((resolve) => window.setTimeout(resolve, 7_000));
      }
      setHistoryImport({ connected: true, seasons: importedSeasons, imported: importedSeasons.filter((season) => season.status === 'imported').length, records: importedSeasons.reduce((sum, season) => sum + season.records, 0) });
    } catch (error) {
      setHistoryImport({ connected: false, seasons: importedSeasons, records: importedSeasons.reduce((sum, season) => sum + season.records, 0), error: error instanceof Error ? error.message : 'The historical import could not be reached.' });
    } finally {
      setHistoryProgress(''); setHistoryLoading(false);
    }
  };
  if (loading) return <Card className="mt-6 border-primary/12 bg-card/75"><CardContent className="flex min-h-56 items-center justify-center gap-3 text-sm text-muted-foreground"><LoaderCircle className="size-5 animate-spin text-primary" /> Building the competition database…</CardContent></Card>;
  if (!feed?.connected || !feed.summary) return <Card className="mt-6 border-amber-300/15 bg-card/75"><CardContent className="p-6"><p className="font-medium text-amber-100">Competition database unavailable</p><p className="mt-2 text-sm text-muted-foreground">{feed?.error ?? 'No stored records were returned.'}</p></CardContent></Card>;
  const stats = [
    ['Season records', feed.summary.records], ['Completed', feed.summary.completed], ['Scheduled', feed.summary.upcoming],
    ['Goals', feed.summary.goals], ['Goals / match', feed.summary.averageGoals], ['Teams ranked', feed.summary.teams],
  ];
  return <><section className="mt-7">
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-medium uppercase tracking-[.16em] text-primary">Persistent data layer</p><h2 className="mt-1 text-2xl font-semibold tracking-[-.035em]">Competition intelligence</h2><p className="mt-1 text-xs text-muted-foreground">Results, fixtures and standings calculated from stored provider records.</p></div><div className="flex flex-wrap items-center gap-2"><Badge variant="outline" className="border-primary/25 text-primary"><Database className="mr-1 size-3" /> {feed.lastSyncedAt ? `Updated ${formatDateTime(feed.lastSyncedAt)}` : feed.synced ? 'Dataset imported' : 'Database connected'}</Badge><Button onClick={importHistory} disabled={historyLoading} variant="outline" size="sm">{historyLoading ? <LoaderCircle className="animate-spin" /> : <Upload />} {historyLoading ? historyProgress || 'Preparing history…' : 'Import five-season history'}</Button></div></div>
    {historyImport && <div className={`mb-4 rounded-xl border p-4 text-sm ${historyImport.connected ? 'border-primary/15 bg-primary/[.035]' : 'border-amber-300/15 bg-amber-300/[.035]'}`}><p className="font-medium">{historyImport.connected ? `${historyImport.records?.toLocaleString()} historical fixtures are stored across ${historyImport.seasons?.length} seasons.` : 'Historical import failed'}</p><p className="mt-1 text-xs text-muted-foreground">{historyImport.connected ? 'Future forecasts now train on these earlier seasons automatically.' : historyImport.error}</p></div>}
    <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">{stats.map(([label, value]) => <Card key={String(label)} className="border-white/8 bg-card/70"><CardContent className="p-4"><p className="font-mono text-xl text-primary">{value}</p><p className="mt-1 text-[11px] text-muted-foreground">{label}</p></CardContent></Card>)}</div>
    <div className="grid gap-4 xl:grid-cols-[1.3fr_.7fr]">
      <Card className="border-white/8 bg-card/75"><CardHeader className="flex-row items-center justify-between"><div><CardTitle>Calculated table</CardTitle><p className="mt-1 text-xs text-muted-foreground">Select a team for form and split analysis</p></div><Badge variant="outline">{feed.competition?.season}/{String((feed.competition?.season ?? 0) + 1).slice(-2)}</Badge></CardHeader><CardContent className="overflow-x-auto"><table className="w-full min-w-[620px] text-sm"><thead className="border-y border-white/8 text-[10px] uppercase tracking-[.12em] text-muted-foreground"><tr>{['#', 'Team', 'P', 'W', 'D', 'L', 'GF', 'GA', 'GD', 'Pts'].map((head) => <th key={head} className={`px-2 py-3 font-medium ${head === 'Team' ? 'text-left' : 'text-right'}`}>{head}</th>)}</tr></thead><tbody>{feed.standings?.map((team) => <tr key={team.id} className="border-b border-white/6"><td className="px-2 py-3 text-right font-mono text-muted-foreground">{team.position}</td><td className="px-2 py-3"><button onClick={() => loadTeam(team.id)} className="flex items-center gap-2 text-left hover:text-primary">{team.logo && <img src={team.logo} alt="" className="size-5 object-contain" />}<span className="font-medium">{team.name}</span></button></td>{[team.played, team.won, team.drawn, team.lost, team.gf, team.ga, team.gd, team.points].map((value, index) => <td key={index} className={`px-2 text-right font-mono ${index === 7 ? 'font-semibold text-primary' : ''}`}>{value}</td>)}</tr>)}</tbody></table></CardContent></Card>
      <Card className="border-white/8 bg-card/75"><CardHeader><CardTitle>Recent results</CardTitle><p className="text-xs text-muted-foreground">Select a result for match analysis</p></CardHeader><CardContent className="space-y-2">{feed.recent?.map((fixture) => <button key={fixture.id} onClick={() => loadMatch(fixture.id)} className="block w-full rounded-xl border border-white/7 bg-white/[.02] p-3 text-left hover:border-primary/25 hover:bg-primary/[.035]"><div className="mb-2 flex items-center justify-between text-[10px] text-muted-foreground"><span>{formatKickoff(fixture.kickoff)}</span><span>{fixture.round}</span></div><div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-sm"><span className="truncate font-medium">{fixture.home.name}</span><span className="rounded-md bg-white/6 px-2 py-1 font-mono text-primary">{fixture.score.home}–{fixture.score.away}</span><span className="truncate text-right font-medium">{fixture.away.name}</span></div></button>)}</CardContent></Card>
    </div>
    <Card className="mt-4 border-primary/12 bg-[linear-gradient(145deg,rgba(103,232,181,.045),rgba(13,20,29,.82)_50%)]"><CardHeader className="flex-row items-start justify-between"><div><Badge variant="outline" className="mb-3 border-primary/25 text-primary"><BrainCircuit className="mr-1 size-3" /> Baseline v1</Badge><CardTitle>Evidence-based predictions</CardTitle><p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">Elo team strength and a Bayesian-smoothed Poisson goal model. Every forecast uses only results available before kickoff and includes walk-forward validation.</p></div><ShieldCheck className="hidden size-8 text-primary/45 sm:block" /></CardHeader><CardContent>{feed.upcoming?.length ? <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{feed.upcoming.slice(0, 6).map((fixture) => <button key={fixture.id} onClick={() => loadPrediction(fixture.id)} className="rounded-xl border border-white/8 bg-white/[.025] p-4 text-left transition-colors hover:border-primary/30 hover:bg-primary/[.045]"><div className="mb-3 flex items-center justify-between text-[10px] text-muted-foreground"><span>{formatKickoff(fixture.kickoff)}</span><ArrowUpRight className="size-3" /></div><div className="space-y-2 text-sm"><div className="flex items-center gap-2">{fixture.home.logo && <img src={fixture.home.logo} alt="" className="size-5 object-contain" />}<span className="font-medium">{fixture.home.name}</span></div><div className="flex items-center gap-2">{fixture.away.logo && <img src={fixture.away.logo} alt="" className="size-5 object-contain" />}<span className="font-medium">{fixture.away.name}</span></div></div><p className="mt-3 text-[11px] text-primary">Generate auditable forecast</p></button>)}</div> : <p className="text-sm text-muted-foreground">Predictions will appear when the stored provider dataset contains upcoming fixtures.</p>}</CardContent></Card>
  </section><TeamAnalysisDialog open={teamOpen} onOpenChange={setTeamOpen} data={teamAnalysis} loading={teamLoading} /><MatchAnalysisDialog open={matchOpen} onOpenChange={setMatchOpen} data={matchAnalysis} loading={matchLoading} /><PredictionDialog open={predictionOpen} onOpenChange={setPredictionOpen} data={prediction} loading={predictionLoading} /></>;
}

function TeamAnalysisDialog({ open, onOpenChange, data, loading }: { open: boolean; onOpenChange: (open: boolean) => void; data: TeamAnalysis | null; loading: boolean }) {
  const splitCards = data?.overall ? [['Overall', data.overall], ['Home', data.home!], ['Away', data.away!]] as const : [];
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto border-primary/15 bg-[#111a24] sm:max-w-3xl"><DialogHeader><DialogTitle className="flex items-center gap-3">{data?.team?.logo && <img src={data.team.logo} alt="" className="size-9 object-contain" />}{data?.team?.name ?? 'Team analysis'}</DialogTitle><DialogDescription>Database-derived form, scoring and home/away splits.</DialogDescription></DialogHeader>{loading ? <div className="flex min-h-52 items-center justify-center"><LoaderCircle className="animate-spin text-primary" /></div> : !data?.connected ? <p className="text-sm text-amber-100">{data?.error}</p> : <div className="space-y-5"><div className="grid gap-3 sm:grid-cols-3">{splitCards.map(([label, split]) => <div key={label} className="rounded-xl border border-white/8 bg-white/[.025] p-4"><p className="mb-3 text-xs font-semibold uppercase tracking-[.14em] text-primary">{label}</p><div className="grid grid-cols-4 gap-2 text-center"><MiniNumber label="P" value={split.played} /><MiniNumber label="W" value={split.won} /><MiniNumber label="D" value={split.drawn} /><MiniNumber label="L" value={split.lost} /></div><p className="mt-3 text-xs text-muted-foreground">{split.gf} scored · {split.ga} conceded · {split.cleanSheets} clean sheets</p></div>)}</div><div><p className="mb-3 text-xs font-semibold uppercase tracking-[.14em] text-muted-foreground">Last six</p><div className="grid gap-2 sm:grid-cols-2">{data.form?.map((match) => <div key={match.id} className="flex items-center justify-between rounded-lg border border-white/7 px-3 py-2 text-sm"><span><Badge className={`mr-2 ${match.result === 'W' ? 'bg-primary/15 text-primary' : match.result === 'D' ? 'bg-amber-300/15 text-amber-200' : 'bg-red-300/10 text-red-200'}`}>{match.result}</Badge>{match.location} vs {match.opponent}</span><span className="font-mono">{match.gf}–{match.ga}</span></div>)}</div></div>{data.next && <div className="rounded-xl border border-primary/15 bg-primary/[.045] p-4 text-sm"><span className="text-primary">Next:</span> {data.next.location} vs {data.next.opponent} · {formatKickoff(data.next.kickoff)}</div>}</div>}</DialogContent></Dialog>;
}

function MatchAnalysisDialog({ open, onOpenChange, data, loading }: { open: boolean; onOpenChange: (open: boolean) => void; data: MatchAnalysis | null; loading: boolean }) {
  const match = data?.match;
  const statTypes = ['Shots on Goal', 'Ball Possession', 'Total passes', 'Passes accurate', 'Corner Kicks', 'Fouls', 'Yellow Cards'];
  const stat = (teamIndex: number, type: string) => data?.statistics?.[teamIndex]?.statistics.find((item) => item.type === type)?.value ?? '—';
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto border-primary/15 bg-[#111a24] sm:max-w-3xl"><DialogHeader><DialogTitle>{match ? `${match.home.name} ${match.score.home}–${match.score.away} ${match.away.name}` : 'Match analysis'}</DialogTitle><DialogDescription>{match ? `${formatKickoff(match.kickoff)} · ${match.venue ?? match.round ?? ''}` : 'Loading stored match evidence.'}</DialogDescription></DialogHeader>{loading ? <div className="flex min-h-52 items-center justify-center"><LoaderCircle className="animate-spin text-primary" /></div> : !data?.connected || !match ? <p className="text-sm text-amber-100">{data?.error}</p> : <div className="grid gap-5 md:grid-cols-2"><div><p className="mb-3 text-xs font-semibold uppercase tracking-[.14em] text-muted-foreground">Recent form before kickoff</p>{(['home', 'away'] as const).map((side) => <div key={side} className="mb-4 rounded-xl border border-white/8 p-3"><p className="mb-2 font-medium">{match[side].name}</p><div className="flex flex-wrap gap-2">{data.form?.[side].map((item, index) => <Badge key={index} variant="outline" className={item.result === 'W' ? 'text-primary' : item.result === 'D' ? 'text-amber-200' : 'text-red-200'}>{item.result} {item.gf}–{item.ga} {item.opponent}</Badge>)}</div></div>)}</div><div><div className="mb-3 flex items-center justify-between gap-2"><p className="text-xs font-semibold uppercase tracking-[.14em] text-muted-foreground">Match statistics</p>{data.statisticsSource && <Badge variant="outline" className={data.statisticsSource === 'stored' ? 'border-primary/25 text-primary' : 'text-amber-200'}>{data.statisticsSource === 'stored' ? 'From the database' : 'Live from provider'}</Badge>}</div><div className="rounded-xl border border-white/8">{statTypes.map((type) => <div key={type} className="grid grid-cols-[1fr_1.6fr_1fr] border-b border-white/6 px-3 py-2 text-sm last:border-0"><span className="text-left font-mono text-primary">{stat(0, type)}</span><span className="text-center text-xs text-muted-foreground">{type}</span><span className="text-right font-mono text-sky-300">{stat(1, type)}</span></div>)}</div>{!data.statistics?.length && <p className="mt-2 text-[11px] text-muted-foreground">No match statistics are stored for this fixture, and the provider supplied none.</p>}
      {Boolean(data.lineups?.length) && <div className="mt-4"><p className="mb-2 text-xs font-semibold uppercase tracking-[.14em] text-muted-foreground">Line-ups</p><div className="grid grid-cols-2 gap-2">{data.lineups?.map((lineup) => <div key={lineup.teamId} className="rounded-xl border border-white/8 p-3"><p className="font-mono text-sm text-primary">{lineup.formation ?? '—'}</p><p className="mt-0.5 text-[10px] text-muted-foreground">{lineup.coach ?? 'Coach not recorded'} · {lineup.starters.length} started, {lineup.substitutes.length} on the bench</p></div>)}</div></div>}
      {data.market && <div className="mt-4"><p className="mb-2 text-xs font-semibold uppercase tracking-[.14em] text-muted-foreground">Market price</p><div className="rounded-xl border border-white/8 p-3"><div className="grid grid-cols-3 gap-2 text-center">{([['Home', data.market.probabilities.home], ['Draw', data.market.probabilities.draw], ['Away', data.market.probabilities.away]] as const).map(([label, value]) => <div key={label}><p className="font-mono text-lg text-primary">{value}%</p><p className="text-[10px] text-muted-foreground">{label}</p></div>)}</div><p className="mt-2 text-[10px] leading-4 text-muted-foreground">Averaged across {data.market.bookmakers} bookmaker{data.market.bookmakers === 1 ? '' : 's'} with the {Math.round((data.market.overround - 1) * 1000) / 10}% margin divided out. This is the benchmark the model has to beat, not a second opinion.</p></div></div>}</div></div>}</DialogContent></Dialog>;
}

function PredictionDialog({ open, onOpenChange, data, loading }: { open: boolean; onOpenChange: (open: boolean) => void; data: BaselinePrediction | null; loading: boolean }) {
  const fixture = data?.fixture;
  const probabilities = data?.probabilities;
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto border-primary/15 bg-[#111a24] sm:max-w-4xl"><DialogHeader><DialogTitle>{fixture ? `${fixture.home.name} vs ${fixture.away.name}` : 'Baseline prediction'}</DialogTitle><DialogDescription>{fixture ? `${formatKickoff(fixture.kickoff)} · ${fixture.competition} · ${fixture.round ?? 'Scheduled fixture'}` : 'Calculating probabilities from stored pre-match evidence.'}</DialogDescription></DialogHeader>{loading ? <div className="flex min-h-64 items-center justify-center gap-3 text-sm text-muted-foreground"><LoaderCircle className="animate-spin text-primary" /> Running leakage-safe model…</div> : !data?.connected || !fixture || !probabilities || !data.expectedGoals || !data.evidence || !data.validation ? <p className="text-sm text-amber-100">{data?.error ?? 'Prediction evidence was not returned.'}</p> : <div className="space-y-5"><div className="grid gap-3 sm:grid-cols-3"><ForecastProbability label={`${fixture.home.name} win`} value={probabilities.home} /><ForecastProbability label="Draw" value={probabilities.draw} /><ForecastProbability label={`${fixture.away.name} win`} value={probabilities.away} /></div><div className="grid gap-4 lg:grid-cols-[1.1fr_.9fr]"><div className="rounded-xl border border-white/8 bg-white/[.02] p-4"><div className="mb-4 flex items-center justify-between"><div><p className="text-sm font-semibold">Goal outlook</p><p className="text-[11px] text-muted-foreground">Independent Poisson score simulation</p></div><Badge variant="outline" className="text-primary">{data.confidence}% evidence confidence</Badge></div><div className="mb-5 grid grid-cols-2 gap-3"><MiniMetric label={`${fixture.home.name} xG`} value={data.expectedGoals.home.toFixed(2)} /><MiniMetric label={`${fixture.away.name} xG`} value={data.expectedGoals.away.toFixed(2)} /><MiniMetric label="Over 2.5" value={`${data.markets?.over25 ?? 0}%`} /><MiniMetric label="Both score" value={`${data.markets?.btts ?? 0}%`} /></div><p className="mb-2 text-[10px] uppercase tracking-[.13em] text-muted-foreground">Most likely scores</p><div className="grid grid-cols-2 gap-2 sm:grid-cols-5">{data.scorelines?.map((score) => <div key={score.score} className="rounded-lg border border-white/7 p-2 text-center"><p className="font-mono text-sm text-primary">{score.score}</p><p className="mt-1 text-[10px] text-muted-foreground">{score.probability}%</p></div>)}</div></div><div className="rounded-xl border border-white/8 bg-white/[.02] p-4"><p className="text-sm font-semibold">Model evidence</p><p className="mt-1 text-[11px] text-muted-foreground">{data.model?.name} · {data.model?.trainingMatches} prior matches</p><div className="mt-4 grid grid-cols-2 gap-2"><MiniMetric label={`${fixture.home.name} Elo`} value={data.evidence.homeElo} /><MiniMetric label={`${fixture.away.name} Elo`} value={data.evidence.awayElo} /><MiniMetric label="Home attack index" value={data.evidence.homeAttack.toFixed(2)} /><MiniMetric label="Away attack index" value={data.evidence.awayAttack.toFixed(2)} /><MiniMetric label="Home matches" value={data.evidence.homeMatches} /><MiniMetric label="Away matches" value={data.evidence.awayMatches} /></div></div></div><div className="grid gap-3 md:grid-cols-[1fr_auto]"><div className="rounded-xl border border-amber-300/15 bg-amber-300/[.035] p-4"><p className="text-xs font-semibold text-amber-100">Sample-size check</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{data.sampleWarning}</p></div><div className="grid grid-cols-3 gap-2 md:min-w-[300px]"><MiniMetric label="Backtest matches" value={data.validation.matches} /><MiniMetric label="Accuracy" value={`${data.validation.accuracy}%`} /><MiniMetric label="Brier score" value={data.validation.brier ?? '—'} /></div></div><p className="text-[10px] leading-4 text-muted-foreground">{data.validation.methodology} This statistical baseline is for analysis, not a guarantee of results or betting profit.</p></div>}</DialogContent></Dialog>;
}

function ForecastProbability({ label, value }: { label: string; value: number }) { return <div className="rounded-xl border border-primary/12 bg-primary/[.035] p-4"><div className="mb-3 flex items-center justify-between"><p className="text-xs text-muted-foreground">{label}</p><p className="font-mono text-xl text-primary">{value}%</p></div><Progress value={value} /></div>; }
function MiniMetric({ label, value }: { label: string; value: string | number }) { return <div className="rounded-lg border border-white/7 bg-black/10 p-3"><p className="font-mono text-sm text-primary">{value}</p><p className="mt-1 text-[10px] text-muted-foreground">{label}</p></div>; }
function MarketBenchmark({ market }: { market: NonNullable<BaselinePrediction['market']> }) { return <div className="rounded-xl border border-primary/15 bg-primary/[.035] p-4"><div className="mb-3 flex flex-wrap items-baseline justify-between gap-2"><p className="text-sm font-medium">Market benchmark</p><p className="text-[10px] text-muted-foreground">{market.bookmakers} bookmaker{market.bookmakers === 1 ? '' : 's'} · margin removed</p></div><div className="grid grid-cols-3 gap-2"><MiniMetric label="Home" value={`${market.probabilities.home}%`} /><MiniMetric label="Draw" value={`${market.probabilities.draw}%`} /><MiniMetric label="Away" value={`${market.probabilities.away}%`} /></div></div>; }

function MiniNumber({ label, value }: { label: string; value: number }) { return <div><p className="font-mono text-lg">{value}</p><p className="text-[10px] text-muted-foreground">{label}</p></div>; }

function FixtureTeam({ team, align }: { team: UpcomingFixture['home']; align?: 'right' }) {
  return <div className={`flex items-center gap-3 ${align === 'right' ? 'flex-row-reverse text-right' : ''}`}>{team.logo ? <img src={team.logo} alt="" className="size-14 object-contain" /> : <span className="grid size-14 place-items-center rounded-full bg-white/5 text-sm font-semibold">{team.name.slice(0, 3).toUpperCase()}</span>}<div><p className="text-lg font-semibold">{team.name}</p><p className="text-xs text-muted-foreground">Provider team ID {team.id}</p></div></div>;
}

function formatKickoff(value: string) {
  return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/London' }).format(new Date(value));
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/London' }).format(new Date(value));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/London' }).format(new Date(value));
}

function seasonLabel(season: number) {
  return `${season}/${String(season + 1).slice(-2)}`;
}

function wait(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function MatchLab({ competitions, selectedLeague, selectedSeason, setSelectedLeague, intelligence, intelligenceLoading }: { competitions: LiveCompetition[]; selectedLeague: number; selectedSeason: number; setSelectedLeague: (league: number) => void; intelligence: IntelligenceFeed | null; intelligenceLoading: boolean }) {
  const fixtures = intelligence?.upcoming ?? EMPTY_FIXTURES;
  const [fixtureId, setFixtureId] = useState<number | null>(null);
  const [prediction, setPrediction] = useState<BaselinePrediction | null>(null);
  const [homeAnalysis, setHomeAnalysis] = useState<TeamAnalysis | null>(null);
  const [awayAnalysis, setAwayAnalysis] = useState<TeamAnalysis | null>(null);
  const [matchAnalysis, setMatchAnalysis] = useState<MatchAnalysis | null>(null);
  const [loading, setLoading] = useState(false);

  const activeFixtureId = fixtureId && fixtures.some((fixture) => fixture.id === fixtureId) ? fixtureId : fixtures[0]?.id ?? null;

  useEffect(() => {
    const fixture = fixtures.find((item) => item.id === activeFixtureId);
    if (!fixture) return;
    let active = true;
    setLoading(true); setPrediction(null); setHomeAnalysis(null); setAwayAnalysis(null); setMatchAnalysis(null);
    Promise.all([
      fetch(`/api/football/prediction?fixture=${fixture.id}`).then(async (response) => await response.json() as BaselinePrediction),
      fetch(`/api/football/team?team=${fixture.home.id}&league=${selectedLeague}&season=${selectedSeason}`).then(async (response) => await response.json() as TeamAnalysis),
      fetch(`/api/football/team?team=${fixture.away.id}&league=${selectedLeague}&season=${selectedSeason}`).then(async (response) => await response.json() as TeamAnalysis),
      fetch(`/api/football/match?fixture=${fixture.id}`).then(async (response) => await response.json() as MatchAnalysis),
    ]).then(([forecast, homeTeam, awayTeam, match]) => {
      if (!active) return;
      setPrediction(forecast); setHomeAnalysis(homeTeam); setAwayAnalysis(awayTeam); setMatchAnalysis(match);
    }).catch(() => {
      if (active) setPrediction({ connected: false, error: 'The selected fixture could not be analysed.' });
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [activeFixtureId, fixtures, selectedLeague, selectedSeason]);

  const displayCompetitions = competitions.length ? competitions : FIXTURE_COMPETITIONS;
  const selectedCompetition = displayCompetitions.find((competition) => competition.id === selectedLeague);
  const fixture = fixtures.find((item) => item.id === activeFixtureId);
  const scores = prediction?.scorelines?.map((score) => ({ score: score.score, value: score.probability })) ?? [];

  return <>
    <Intro eyebrow="Stored evidence · real fixtures" title="Match prediction lab" copy="Select any upcoming stored fixture to compare form, team records, Elo strength, expected goals and leakage-safe model probabilities." action={<Select value={String(selectedLeague)} onValueChange={(value) => value && setSelectedLeague(Number(value))}><SelectTrigger className="w-[230px]"><span className="truncate">{selectedCompetition?.name ?? 'Competition'}</span></SelectTrigger><SelectContent>{displayCompetitions.map((competition) => <SelectItem key={competition.id} value={String(competition.id)}>{competition.name}</SelectItem>)}</SelectContent></Select>} />
    <Card className="mb-4 border-white/8 bg-card/75"><CardContent className="grid gap-4 p-4 md:grid-cols-[1fr_auto] md:items-end"><div><span className="mb-2 block text-xs font-medium text-muted-foreground">Upcoming fixture</span><Select value={activeFixtureId ? String(activeFixtureId) : ''} onValueChange={(value) => value && setFixtureId(Number(value))}><SelectTrigger aria-label="Upcoming fixture" className="w-full bg-white/[.025]"><SelectValue placeholder={intelligenceLoading ? 'Loading fixtures…' : 'Choose a fixture'} /></SelectTrigger><SelectContent>{fixtures.map((item) => <SelectItem key={item.id} value={String(item.id)}>{formatKickoff(item.kickoff)} · {item.home.name} vs {item.away.name}</SelectItem>)}</SelectContent></Select></div><Badge variant="outline" className="h-9 px-3 text-muted-foreground">{fixtures.length} stored upcoming fixtures</Badge></CardContent></Card>
    {intelligenceLoading || loading ? <Card className="border-primary/12 bg-card/75"><CardContent className="flex min-h-72 items-center justify-center gap-3 text-sm text-muted-foreground"><LoaderCircle className="size-5 animate-spin text-primary" /> Building the real match comparison…</CardContent></Card> : !fixture ? <Card className="border-amber-300/15 bg-card/75"><CardContent className="p-6"><p className="font-medium text-amber-100">No stored upcoming fixture is available.</p><p className="mt-2 text-sm text-muted-foreground">Choose another competition or refresh its current-season dataset from Overview.</p></CardContent></Card> : !prediction?.connected || !prediction.probabilities || !prediction.expectedGoals || !prediction.evidence || !prediction.validation ? <Card className="border-amber-300/15 bg-card/75"><CardContent className="p-6"><p className="font-medium text-amber-100">Prediction evidence is unavailable.</p><p className="mt-2 text-sm text-muted-foreground">{prediction?.error ?? 'The model did not return a forecast for this fixture.'}</p></CardContent></Card> : <div className="space-y-4">
      <Card className="relative border-primary/15 bg-card/80 py-0"><div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/80 to-transparent" /><CardHeader className="border-b border-white/8 px-5 py-5 sm:flex-row sm:items-center sm:justify-between"><div><Badge className="mb-2 bg-primary/12 text-primary">{prediction.model?.name}</Badge><CardTitle className="text-xl">{fixture.home.name} vs {fixture.away.name}</CardTitle><p className="mt-1 text-xs text-muted-foreground">{formatKickoff(fixture.kickoff)} · {fixture.venue ?? fixture.round ?? 'Venue to be confirmed'}</p></div><Badge variant="outline" className="mt-3 border-primary/25 text-primary sm:mt-0">{prediction.confidence}% evidence confidence</Badge></CardHeader><CardContent className="grid gap-3 p-5 md:grid-cols-3"><ForecastProbability label={`${fixture.home.name} win`} value={prediction.probabilities.home} /><ForecastProbability label="Draw" value={prediction.probabilities.draw} /><ForecastProbability label={`${fixture.away.name} win`} value={prediction.probabilities.away} /></CardContent></Card>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><SmallStat icon={<Target />} label="Expected goals" value={`${prediction.expectedGoals.home} – ${prediction.expectedGoals.away}`} note={`${fixture.home.name} · ${fixture.away.name}`} /><SmallStat icon={<Zap />} label="Over 2.5" value={`${prediction.markets?.over25 ?? 0}%`} note="Poisson total-goals probability" /><SmallStat icon={<Activity />} label="Both teams score" value={`${prediction.markets?.btts ?? 0}%`} note="BTTS probability" /><SmallStat icon={<Database />} label="Training evidence" value={(prediction.model?.trainingMatches ?? 0).toLocaleString()} note="Earlier fixtures only" /></div>
      {prediction.market && <MarketBenchmark market={prediction.market} />}
      <div className="grid gap-4 xl:grid-cols-2"><TeamEvidenceCard data={homeAnalysis} side="Home" /><TeamEvidenceCard data={awayAnalysis} side="Away" /></div>
      <div className="grid gap-4 xl:grid-cols-[1.1fr_.9fr]"><Card className="border-white/8 bg-card/75"><CardHeader><CardTitle>Exact-score distribution</CardTitle><p className="text-xs text-muted-foreground">Top outcomes from the current Poisson grid</p></CardHeader><CardContent><ChartContainer config={chartConfig} className="h-[280px] w-full"><BarChart data={scores}><CartesianGrid vertical={false} strokeDasharray="4 4" /><XAxis dataKey="score" axisLine={false} tickLine={false} /><YAxis hide /><ChartTooltip content={<ChartTooltipContent />} /><Bar dataKey="value" radius={[6, 6, 0, 0]}>{scores.map((_, index) => <Cell key={index} fill={index === 0 ? 'var(--color-chart-1)' : 'var(--color-chart-3)'} opacity={1 - index * .1} />)}</Bar></BarChart></ChartContainer></CardContent></Card><Card className="border-white/8 bg-card/75"><CardHeader><CardTitle>Model evidence</CardTitle><p className="text-xs text-muted-foreground">Auditable inputs available before kickoff</p></CardHeader><CardContent className="space-y-3"><div className="grid grid-cols-2 gap-2"><MiniMetric label={`${fixture.home.name} Elo`} value={prediction.evidence.homeElo} /><MiniMetric label={`${fixture.away.name} Elo`} value={prediction.evidence.awayElo} /><MiniMetric label="Home attack index" value={prediction.evidence.homeAttack} /><MiniMetric label="Away attack index" value={prediction.evidence.awayAttack} /><MiniMetric label="Backtest matches" value={prediction.validation.matches} /><MiniMetric label="Brier score" value={prediction.validation.brier ?? '—'} /></div><div className="rounded-xl border border-amber-300/15 bg-amber-300/[.035] p-4 text-xs leading-5 text-muted-foreground"><ShieldCheck className="mb-2 size-4 text-amber-100" />{prediction.sampleWarning}</div><p className="text-[10px] leading-4 text-muted-foreground">Line-up and injury effects are shown in Live Centre when the provider releases them; they are not invented or backfilled here.</p></CardContent></Card></div>
      {matchAnalysis?.h2h?.length ? <Card className="border-white/8 bg-card/75"><CardHeader><CardTitle>Previous meetings</CardTitle><p className="text-xs text-muted-foreground">Stored head-to-head results before this kickoff</p></CardHeader><CardContent className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">{matchAnalysis.h2h.slice(0, 6).map((meeting) => <div key={meeting.id} className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 rounded-xl border border-white/7 p-3 text-sm"><span className="truncate">{meeting.home_name}</span><span className="font-mono text-primary">{meeting.home_goals}–{meeting.away_goals}</span><span className="truncate text-right">{meeting.away_name}</span></div>)}</CardContent></Card> : null}
    </div>}
  </>;
}

function TeamEvidenceCard({ data, side }: { data: TeamAnalysis | null; side: 'Home' | 'Away' }) {
  const split = side === 'Home' ? data?.home : data?.away;
  return <Card className="border-white/8 bg-card/75"><CardHeader className="flex-row items-center gap-3">{data?.team?.logo && <img src={data.team.logo} alt="" className="size-10 object-contain" />}<div><CardTitle>{data?.team?.name ?? `${side} team`}</CardTitle><p className="mt-1 text-xs text-muted-foreground">{side} split and last-six form</p></div></CardHeader><CardContent>{!data?.connected || !split ? <p className="text-sm text-muted-foreground">Team evidence is unavailable.</p> : <><div className="mb-4 grid grid-cols-4 gap-2"><MiniMetric label="Played" value={split.played} /><MiniMetric label="Won" value={split.won} /><MiniMetric label="GF" value={split.gf} /><MiniMetric label="GA" value={split.ga} /></div><div className="flex flex-wrap gap-2">{data.form?.map((match) => <Badge key={match.id} variant="outline" className={match.result === 'W' ? 'text-primary' : match.result === 'D' ? 'text-amber-200' : 'text-red-200'}>{match.result} {match.gf}–{match.ga} · {match.opponent}</Badge>)}</div><p className="mt-4 text-[11px] text-muted-foreground">{split.cleanSheets} clean sheets · {split.btts} BTTS · {split.over25} over 2.5</p></>}</CardContent></Card>;
}

function ImportDashboard({ competitions }: { competitions: LiveCompetition[] }) {
  const [status, setStatus] = useState<ImportStatusFeed | null>(null);
  const [loading, setLoading] = useState(true);
  const [queueRunning, setQueueRunning] = useState(false);
  const [queueDone, setQueueDone] = useState(0);
  const [queueTotal, setQueueTotal] = useState(0);
  const [queueLabel, setQueueLabel] = useState('');
  const [queueError, setQueueError] = useState<string | null>(null);

  const loadStatus = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/football/imports', { cache: 'no-store' });
      const payload = await response.json() as ImportStatusFeed;
      setStatus(payload);
    } catch {
      setStatus({ connected: false, error: 'The import dashboard could not be reached.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadStatus(); }, []);

  const availableCompetitions = (competitions.length ? competitions : FIXTURE_COMPETITIONS.map((competition) => ({
    ...competition,
    group: '', providerName: competition.name, logo: null, available: true,
    coverage: { liveEvents: false, fixtureStatistics: false, playerStatistics: false, lineups: false, predictions: true, injuries: false },
  }))).map((competition) => ({
    ...competition,
    season: competition.season ?? FIXTURE_COMPETITIONS.find((fallback) => fallback.id === competition.id)?.season ?? 2026,
  }));
  const storedBySeason = new Map((status?.seasons ?? []).map((season) => [`${season.competitionId}:${season.season}`, season]));
  const rows = availableCompetitions.map((competition) => {
    const currentSeason = competition.season ?? 2026;
    const seasons = Array.from({ length: 5 }, (_, index) => currentSeason - 5 + index).map((season) => {
      const stored = storedBySeason.get(`${competition.id}:${season}`);
      const state = stored?.sync?.status === 'complete' ? 'complete' : stored?.sync?.status === 'failed' ? 'failed' : stored?.records ? 'incomplete' : 'missing';
      return { season, stored, state } as const;
    });
    const completed = seasons.filter((season) => season.state === 'complete').length;
    const records = seasons.reduce((sum, season) => sum + (season.stored?.records ?? 0), 0);
    const lastSuccess = seasons
      .map((season) => season.stored?.sync?.status === 'complete' ? season.stored.sync.finishedAt ?? season.stored.lastUpdatedAt : null)
      .filter((date): date is string => Boolean(date))
      .sort()
      .at(-1) ?? null;
    return { competition, seasons, completed, records, lastSuccess };
  });
  const targets = rows.flatMap((row) => row.seasons.filter((season) => season.state !== 'complete').map((season) => ({
    league: row.competition.id,
    name: row.competition.name,
    season: season.season,
  })));
  const completedCount = rows.reduce((sum, row) => sum + row.completed, 0);
  const expectedCount = rows.length * 5;
  const failedCount = rows.reduce((sum, row) => sum + row.seasons.filter((season) => season.state === 'failed' || season.state === 'incomplete').length, 0);
  const storedRecords = rows.reduce((sum, row) => sum + row.records, 0);

  const runQueue = async (items: Array<{ league: number; name: string; season: number }>) => {
    if (!items.length || queueRunning) return;
    setQueueRunning(true); setQueueDone(0); setQueueTotal(items.length); setQueueError(null);
    try {
      for (let index = 0; index < items.length; index++) {
        const item = items[index];
        setQueueLabel(`${item.name} · ${seasonLabel(item.season)}`);
        let result: HistoricalImport | null = null;
        for (let attempt = 0; attempt < 4; attempt++) {
          const response = await fetch('/api/football/history', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ league: item.league, seasons: [item.season] }),
          });
          result = await response.json() as HistoricalImport;
          if (result.connected || !result.error?.toLowerCase().includes('too many requests')) break;
          setQueueLabel(`${item.name} · provider limit reached, retrying`);
          await wait(20_000);
        }
        if (!result?.connected) throw new Error(result?.error ?? `${item.name} ${seasonLabel(item.season)} could not be imported.`);
        setQueueDone(index + 1);
        if (index < items.length - 1) await wait(7_000);
      }
      setQueueLabel('Queue complete');
    } catch (error) {
      setQueueError(error instanceof Error ? error.message : 'The import queue stopped unexpectedly.');
    } finally {
      setQueueRunning(false);
      await loadStatus();
    }
  };

  return <>
    <Intro
      eyebrow="Historical data operations"
      title="Import dashboard"
      copy="Track the five completed seasons behind every competition model, repair incomplete datasets, and run one quota-aware import queue. Existing complete seasons are skipped automatically."
      action={<div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => void loadStatus()} disabled={loading || queueRunning}><RefreshCw className={loading ? 'animate-spin' : ''} /> Refresh</Button><Button onClick={() => void runQueue(targets)} disabled={!targets.length || queueRunning}>{queueRunning ? <LoaderCircle className="animate-spin" /> : <Upload />} {queueRunning ? `${queueDone}/${queueTotal} imported` : targets.length ? `Import all · ${targets.length} seasons` : 'History complete'}</Button></div>}
    />

    {queueRunning && <Card className="mb-4 border-primary/18 bg-primary/[.045]"><CardContent className="p-4"><div className="mb-2 flex items-center justify-between gap-4 text-xs"><span className="font-medium text-primary">{queueLabel}</span><span className="font-mono text-muted-foreground">{queueDone} of {queueTotal}</span></div><Progress value={queueTotal ? queueDone / queueTotal * 100 : 0} /><p className="mt-2 text-[11px] text-muted-foreground">Imports are spaced to protect the provider allowance. You can continue using this page while the queue runs.</p></CardContent></Card>}
    {queueError && <div className="mb-4 rounded-xl border border-amber-300/20 bg-amber-300/[.04] p-4 text-sm"><p className="font-medium text-amber-100">The queue paused after an import failed.</p><p className="mt-1 text-xs text-muted-foreground">{queueError} Refresh the status, then retry the remaining seasons.</p></div>}

    <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <SmallStat icon={<Database />} label="Historical records" value={storedRecords.toLocaleString()} note="Fixtures in the five-season windows" />
      <SmallStat icon={<Check />} label="Complete seasons" value={`${completedCount}/${expectedCount}`} note={`${targets.length} still queued or missing`} />
      <SmallStat icon={<Activity />} label="Needs attention" value={String(failedCount)} note="Failed or incomplete seasons" />
      <SmallStat icon={<Gauge />} label="Provider allowance" value={status?.quota ? status.quota.remaining.toLocaleString() : '—'} note={status?.quota ? `${status.quota.current.toLocaleString()} of ${status.quota.limit.toLocaleString()} used today` : 'Quota status unavailable'} />
    </div>

    <Card className="border-white/8 bg-card/75">
      <CardHeader className="gap-2 sm:flex-row sm:items-center sm:justify-between"><div><CardTitle>Competition history</CardTitle><p className="mt-1 text-xs text-muted-foreground">Five completed seasons per competition · green is ready for modelling.</p></div>{status?.quota?.plan && <Badge variant="outline" className="border-primary/25 text-primary">{status.quota.plan} plan · {status.quota.active === false ? 'inactive' : 'active'}</Badge>}</CardHeader>
      <CardContent className="overflow-x-auto">
        {loading && !status ? <div className="flex min-h-56 items-center justify-center gap-3 text-sm text-muted-foreground"><LoaderCircle className="size-5 animate-spin text-primary" /> Reading import history…</div> : !status?.connected ? <div className="rounded-xl border border-amber-300/15 bg-amber-300/[.04] p-5"><p className="font-medium text-amber-100">Import status is unavailable.</p><p className="mt-1 text-sm text-muted-foreground">{status?.error ?? 'The database did not return import records.'}</p></div> : <table className="w-full min-w-[980px] text-left text-sm">
          <thead className="border-y border-white/8 text-[10px] uppercase tracking-[.12em] text-muted-foreground"><tr><th className="px-3 py-3 font-medium">Competition</th><th className="px-3 py-3 font-medium">Season coverage</th><th className="px-3 py-3 text-right font-medium">Records</th><th className="px-3 py-3 font-medium">Last success</th><th className="px-3 py-3 text-right font-medium">Action</th></tr></thead>
          <tbody>{rows.map((row) => {
            const missing = row.seasons.filter((season) => season.state !== 'complete').map((season) => ({ league: row.competition.id, name: row.competition.name, season: season.season }));
            return <tr key={row.competition.id} className="border-b border-white/6 align-middle hover:bg-white/[.02]"><td className="px-3 py-4"><div className="flex items-center gap-3">{row.competition.logo ? <img src={row.competition.logo} alt="" className="size-7 object-contain" /> : <span className="grid size-7 place-items-center rounded-lg bg-white/5 text-[10px] font-bold">{row.competition.name.slice(0, 2).toUpperCase()}</span>}<div><p className="font-medium">{row.competition.name}</p><p className="mt-0.5 text-[10px] text-muted-foreground">{row.completed}/5 seasons ready</p></div></div></td><td className="px-3"><div className="flex gap-1.5">{row.seasons.map((season) => <span key={season.season} title={season.stored?.sync?.error ?? `${seasonLabel(season.season)} · ${season.state}`} className={`rounded-md border px-2 py-1 font-mono text-[10px] ${season.state === 'complete' ? 'border-primary/20 bg-primary/10 text-primary' : season.state === 'failed' ? 'border-red-300/20 bg-red-300/[.06] text-red-200' : season.state === 'incomplete' ? 'border-amber-300/20 bg-amber-300/[.06] text-amber-200' : 'border-white/8 text-muted-foreground'}`}>{String(season.season).slice(-2)}/{String(season.season + 1).slice(-2)}</span>)}</div></td><td className="px-3 text-right font-mono text-xs">{row.records.toLocaleString()}</td><td className="px-3 text-xs text-muted-foreground">{row.lastSuccess ? formatDateTime(row.lastSuccess) : 'Never'}</td><td className="px-3 text-right"><Button variant="outline" size="sm" disabled={!missing.length || queueRunning} onClick={() => void runQueue(missing)}>{missing.length ? `Import ${missing.length}` : <><Check /> Ready</>}</Button></td></tr>;
          })}</tbody>
        </table>}
      </CardContent>
    </Card>
    <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-[10px] text-muted-foreground"><span><span className="mr-1.5 inline-block size-2 rounded-full bg-primary" />Complete</span><span><span className="mr-1.5 inline-block size-2 rounded-full bg-amber-200" />Incomplete</span><span><span className="mr-1.5 inline-block size-2 rounded-full bg-red-200" />Failed</span><span><span className="mr-1.5 inline-block size-2 rounded-full bg-white/20" />Missing</span></div>
  </>;
}

function DataExplorer({ feed, loading }: { feed: CompetitionFeed | null; loading: boolean }) {
  const [coverage, setCoverage] = useState<DetailCoverageFeed | null>(null);
  useEffect(() => {
    fetch('/api/football/history/coverage', { cache: 'no-store' })
      .then(async (response) => await response.json() as DetailCoverageFeed)
      .then(setCoverage)
      .catch(() => setCoverage({ connected: false, error: 'Stored coverage could not be read.' }));
  }, []);
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
      copy="Inspect exactly which provider fields are available and whether each data class is already stored or remains live-only. No demonstration metrics are shown."
      action={<Button variant="outline" onClick={() => window.location.reload()}><RefreshCw /> Refresh</Button>}
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
          <p className="mt-3 text-[11px] text-muted-foreground">A dash means the provider does not supply that field for the current season. Availability does not mean the field is already retained historically.</p>
        </>}
      </CardContent>
    </Card>
    <Card className="border-white/8 bg-card/75"><CardHeader><CardTitle>Historical storage readiness</CardTitle><p className="text-xs text-muted-foreground">What the research database can query today versus what remains available only in Live Centre. Counts are read from the database, not assumed.</p></CardHeader><CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{readinessRows(coverage).map((row) => <div key={row.label} className="rounded-xl border border-white/7 bg-white/[.02] p-4"><div className="mb-3 flex items-center justify-between gap-3"><p className="font-medium">{row.label}</p><Badge variant="outline" className={row.state === 'Live only' || row.state === 'Not stored' ? 'text-amber-200' : 'border-primary/25 text-primary'}>{row.state}</Badge></div><p className="text-xs leading-5 text-muted-foreground">{row.copy}</p></div>)}</CardContent></Card>
  </>;
}

// The readiness panel reports the database. A class with nothing stored says
// so plainly rather than describing an intention.
function readinessRows(coverage: DetailCoverageFeed | null) {
  const summary = coverage?.summary;
  const share = (stored: number | undefined, of: number | undefined) =>
    stored && of ? `${stored.toLocaleString()} of ${of.toLocaleString()} matches` : 'nothing stored yet';
  const stored = (count: number | undefined) => (count ?? 0) > 0;

  return [
    {
      label: 'Fixtures, results and scores',
      state: stored(summary?.fixtures) ? 'Stored' : 'Not stored',
      copy: summary
        ? `${summary.fixtures.toLocaleString()} fixtures across ${summary.seasons} competition-seasons, ${summary.completed.toLocaleString()} of them played.`
        : 'Competition, season, kickoff, venue, teams and final scores are retained.',
    },
    {
      label: 'Standings and team form',
      state: 'Calculated',
      copy: 'Tables, home/away splits and last-six form are derived from stored results.',
    },
    {
      label: 'Baseline predictions',
      state: 'Calculated',
      copy: 'Elo, Bayesian attack/defence and Poisson outputs use stored pre-kickoff evidence. Forecasts recorded before kickoff are scored in Models.',
    },
    {
      label: 'Shots, possession and passing',
      state: stored(summary?.statistics.stored) ? 'Stored' : 'Live only',
      copy: stored(summary?.statistics.stored)
        ? `Shot, possession, passing and card counts for ${share(summary?.statistics.stored, summary?.statistics.of)}, with expected goals where the provider supplies them.`
        : 'Available in provider match views. Run the match-detail importer to retain them across seasons.',
    },
    {
      label: 'Line-ups and formations',
      state: stored(summary?.lineups.stored) ? 'Stored' : 'Live only',
      copy: stored(summary?.lineups.stored)
        ? `Starting elevens, substitutes, formation and coach for ${share(summary?.lineups.stored, summary?.lineups.of)}. No model reads them yet.`
        : 'Visible when supplied by the provider; run the match-detail importer to retain them.',
    },
    {
      label: 'Bookmaker odds',
      state: stored(summary?.odds.stored) ? 'Stored' : 'Live only',
      copy: stored(summary?.odds.stored)
        ? `1X2, over/under 2.5 and both-teams-to-score prices for ${share(summary?.odds.stored, summary?.odds.of)}, shown with the margin divided out.`
        : 'Not yet retained. Odds are the benchmark the model should be judged against, so this is the gap that matters most.',
    },
    {
      label: 'Injuries, suspensions and events',
      state: 'Live only',
      copy: 'Not stored. Injuries are reported as a current state rather than a historical record, so a match-time snapshot has to be captured before kickoff to be usable.',
    },
  ];
}

function Models() {
  const [feed, setFeed] = useState<ModelEvaluationFeed | null>(null);
  const [loading, setLoading] = useState(true);
  const load = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/football/models', { cache: 'no-store' });
      setFeed(await response.json() as ModelEvaluationFeed);
    } catch { setFeed({ connected: false, error: 'Model evaluation could not be reached.' }); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  const summary = feed?.summary;
  const chartData = (feed?.evaluations ?? []).map((evaluation) => ({ competition: shortCompetition(evaluation.competition), value: evaluation.validation.accuracy }));
  return <><Intro eyebrow="Leakage-safe validation" title="Model laboratory" copy="Review the real Elo and Bayesian-Poisson baseline against unseen matches. Every displayed score is recalculated from stored competition history." action={<Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className={loading ? 'animate-spin' : ''} /> Recalculate</Button>} />
    {loading && !feed ? <Card className="border-primary/12 bg-card/75"><CardContent className="flex min-h-72 items-center justify-center gap-3 text-sm text-muted-foreground"><LoaderCircle className="size-5 animate-spin text-primary" /> Running walk-forward evaluation…</CardContent></Card> : !feed?.connected || !summary ? <Card className="border-amber-300/15 bg-card/75"><CardContent className="p-6"><p className="font-medium text-amber-100">Model evaluation is unavailable.</p><p className="mt-2 text-sm text-muted-foreground">{feed?.error ?? 'No completed match history is available.'}</p></CardContent></Card> : <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5"><SmallStat icon={<Database />} label="Training matches" value={summary.trainingMatches.toLocaleString()} note={`${summary.competitions} competitions`} /><SmallStat icon={<ShieldCheck />} label="Validation matches" value={summary.validationMatches.toLocaleString()} note="Walk-forward holdouts" /><SmallStat icon={<Target />} label="Outcome accuracy" value={summary.accuracy === null ? '—' : `${summary.accuracy}%`} note="Highest-probability result" /><SmallStat icon={<Gauge />} label="Brier score" value={summary.brier?.toFixed(3) ?? '—'} note="Lower is better" /><SmallStat icon={<LineIcon />} label="Log loss" value={summary.logLoss?.toFixed(3) ?? '—'} note="Probability quality" /></div>
      <div className="grid gap-4 xl:grid-cols-[.9fr_1.1fr]"><Card className="border-white/8 bg-card/75"><CardHeader><CardTitle>Accuracy by competition</CardTitle><p className="text-xs text-muted-foreground">Descriptive only; calibration metrics remain the primary model check.</p></CardHeader><CardContent><ChartContainer config={chartConfig} className="h-[320px] w-full"><BarChart data={chartData} layout="vertical"><CartesianGrid horizontal={false} strokeDasharray="4 4" /><XAxis type="number" domain={[0, 100]} hide /><YAxis type="category" dataKey="competition" width={100} axisLine={false} tickLine={false} /><ChartTooltip content={<ChartTooltipContent />} /><Bar dataKey="value" fill="var(--color-chart-1)" radius={[0, 6, 6, 0]} /></BarChart></ChartContainer></CardContent></Card><Card className="border-white/8 bg-card/75"><CardHeader><CardTitle>Evaluation ledger</CardTitle><p className="text-xs text-muted-foreground">Current stored history and out-of-sample performance</p></CardHeader><CardContent className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead className="border-y border-white/8 text-[10px] uppercase tracking-[.12em] text-muted-foreground"><tr>{['Competition', 'Seasons', 'Training', 'Validation', 'Accuracy', 'Brier', 'Log loss'].map((head) => <th key={head} className="px-3 py-3 font-medium">{head}</th>)}</tr></thead><tbody>{feed.evaluations?.map((evaluation) => <tr key={evaluation.competitionId} className="border-b border-white/6"><td className="px-3 py-3 font-medium">{evaluation.competition}</td><td className="px-3 font-mono text-xs">{evaluation.seasons}</td><td className="px-3 font-mono text-xs">{evaluation.trainingMatches.toLocaleString()}</td><td className="px-3 font-mono text-xs">{evaluation.validation.matches}</td><td className="px-3 font-mono text-primary">{evaluation.validation.accuracy}%</td><td className="px-3 font-mono text-xs">{evaluation.validation.brier ?? '—'}</td><td className="px-3 font-mono text-xs">{evaluation.validation.logLoss ?? '—'}</td></tr>)}</tbody></table></CardContent></Card></div>
      <div className="rounded-xl border border-primary/15 bg-primary/[.04] p-4 text-xs leading-5 text-muted-foreground"><ShieldCheck className="mb-2 size-4 text-primary" />{feed.methodology} Accuracy is not used alone: Brier score and log loss measure whether the probabilities themselves are trustworthy.</div>
    </div>}
    <div className="mt-4"><ForecastRecord /></div>
  </>;
}

function ForecastRecord() {
  const [feed, setFeed] = useState<ForecastRecordFeed | null>(null);
  const [loading, setLoading] = useState(true);
  const [recording, setRecording] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/football/predictions/snapshot?withinDays=14', { cache: 'no-store' });
      setFeed(await response.json() as ForecastRecordFeed);
    } catch { setFeed({ connected: false, error: 'The forecast record could not be reached.' }); }
    finally { setLoading(false); }
  };

  const record = async () => {
    setRecording(true); setNotice(null);
    try {
      const response = await fetch('/api/football/predictions/snapshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ withinDays: 14 }),
      });
      const result = await response.json() as { connected: boolean; scanned?: number; stored?: number; withMarket?: number; unchanged?: number; error?: string };
      setNotice(result.connected
        ? `${result.stored ?? 0} new forecast${result.stored === 1 ? '' : 's'} recorded from ${result.scanned ?? 0} upcoming fixture${result.scanned === 1 ? '' : 's'}; ${result.withMarket ?? 0} include a market benchmark and ${result.unchanged ?? 0} were unchanged.`
        : result.error ?? 'Forecasts could not be recorded.');
    } catch { setNotice('Forecasts could not be recorded.'); }
    finally { setRecording(false); await load(); }
  };

  useEffect(() => { void load(); }, []);

  const performance = feed?.performance;
  const calibration = feed?.calibration;
  const bins = (calibration?.bins ?? []).map((bin) => ({
    predicted: Math.round(bin.predicted * 1000) / 10,
    observed: Math.round(bin.observed * 1000) / 10,
    count: bin.count,
  }));
  const uncovered = (feed?.coverage?.upcoming ?? 0) - (feed?.coverage?.covered ?? 0);
  // A band holding two forecasts should not read as loudly as one holding forty.
  const heaviestBin = Math.max(1, ...bins.map((bin) => bin.count));

  return <Card className="border-white/8 bg-card/75">
    <CardHeader className="gap-2 sm:flex sm:flex-row sm:items-center sm:justify-between">
      <div>
        <CardTitle className="flex items-center gap-2"><ShieldCheck className="size-4 text-primary" /> Pre-kickoff forecast record</CardTitle>
        <p className="mt-1 text-xs text-muted-foreground">Forecasts stored before kickoff and scored once the result arrives. Nothing recorded after a kickoff is counted.</p>
      </div>
      <Button variant="outline" size="sm" onClick={() => void record()} disabled={recording || loading}>
        {recording ? <LoaderCircle className="animate-spin" /> : <Upload />} {recording ? 'Recording…' : 'Record forecasts'}
      </Button>
    </CardHeader>
    <CardContent>
      {loading && !feed ? <div className="flex min-h-40 items-center justify-center gap-3 text-sm text-muted-foreground"><LoaderCircle className="size-5 animate-spin text-primary" /> Reading the forecast record…</div>
        : !feed?.connected ? <div className="rounded-xl border border-amber-300/15 bg-amber-300/[.04] p-5"><p className="font-medium text-amber-100">The forecast record is unavailable.</p><p className="mt-1 text-sm text-muted-foreground">{feed?.error ?? 'No prediction snapshots have been stored.'}</p></div>
        : <div className="space-y-4">
          {notice && <p className="rounded-lg border border-primary/15 bg-primary/[.04] px-3 py-2 text-xs text-muted-foreground">{notice}</p>}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MiniMetric label={`Upcoming fixtures covered (${feed.windowDays ?? 14}d)`} value={`${feed.coverage?.covered ?? 0}/${feed.coverage?.upcoming ?? 0}`} />
            <MiniMetric label="Awaiting a result" value={feed.awaitingResult ?? 0} />
            <MiniMetric label="Forecasts scored" value={performance?.matches ?? 0} />
            <MiniMetric label="Median lead time" value={performance?.medianLeadHours === null || performance?.medianLeadHours === undefined ? '—' : `${performance.medianLeadHours}h`} />
          </div>

          {!performance?.matches ? <p className="rounded-xl border border-white/7 bg-white/[.02] p-4 text-xs leading-5 text-muted-foreground">
            No stored forecast has been settled yet{uncovered > 0 ? `, and ${uncovered} upcoming fixture${uncovered === 1 ? ' has' : 's have'} no forecast on record` : ''}. Record forecasts before kickoff, and this panel fills in as those matches finish. Until then the walk-forward figures above are the only evidence available.
          </p> : <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <MiniMetric label="Outcome accuracy" value={performance.accuracy === null ? '—' : `${performance.accuracy}%`} />
              <MiniMetric label="Brier score" value={performance.brier ?? '—'} />
              <MiniMetric label="Log loss" value={performance.logLoss ?? '—'} />
              <MiniMetric label="Calibration error" value={calibration?.expectedCalibrationError ?? '—'} />
            </div>

            <div className="rounded-xl border border-primary/15 bg-primary/[.035] p-4">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2"><p className="text-sm font-medium">Model versus market</p><p className="text-[10px] text-muted-foreground">Same fixtures, lower score wins</p></div>
              {feed.marketComparison?.matches ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <MiniMetric label="Market-matched fixtures" value={feed.marketComparison.matches} />
                <MiniMetric label="Model Brier" value={feed.marketComparison.modelBrier ?? '—'} />
                <MiniMetric label="Market Brier" value={feed.marketComparison.marketBrier ?? '—'} />
                <MiniMetric label="Model minus market" value={feed.marketComparison.brierDifference === null ? '—' : `${feed.marketComparison.brierDifference > 0 ? '+' : ''}${feed.marketComparison.brierDifference}`} />
              </div> : <p className="text-xs leading-5 text-muted-foreground">Market probabilities are now captured with new pre-kickoff forecasts. This comparison fills in after those fixtures settle; historical odds were not available from the provider.</p>}
            </div>

            <div className="grid gap-4 xl:grid-cols-[1.05fr_.95fr]">
              <div className="rounded-xl border border-white/7 bg-white/[.02] p-4">
                <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-medium">Reliability</p>
                  <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
                    <span className="flex items-center gap-1.5"><span className="inline-block h-0.5 w-4 rounded" style={{ background: 'var(--color-chart-1)' }} />Observed</span>
                    <span className="flex items-center gap-1.5"><span className="inline-block h-0 w-4 border-t-2 border-dashed border-muted-foreground/70" />Perfect calibration</span>
                  </div>
                </div>
                <p className="mb-3 text-[11px] text-muted-foreground">How often outcomes given an <em>x</em>% chance actually happened, across {calibration?.points ?? 0} forecast probabilities. Larger points hold more forecasts.</p>
                <ChartContainer config={chartConfig} className="h-[260px] w-full">
                  <LineChart data={bins} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
                    <CartesianGrid strokeDasharray="4 4" />
                    <XAxis type="number" dataKey="predicted" domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={(value: number) => `${value}%`} axisLine={false} tickLine={false} />
                    <YAxis type="number" domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={(value: number) => `${value}%`} width={40} axisLine={false} tickLine={false} />
                    <ReferenceLine segment={[{ x: 0, y: 0 }, { x: 100, y: 100 }]} stroke="var(--muted-foreground)" strokeDasharray="5 5" strokeOpacity={.7} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Line
                      type="linear"
                      dataKey="observed"
                      stroke="var(--color-chart-1)"
                      strokeWidth={2}
                      activeDot={{ r: 7 }}
                      dot={({ key, cx, cy, payload }: { key?: Key | null; cx?: number; cy?: number; payload?: { count?: number } }) =>
                        <circle key={key} cx={cx} cy={cy} r={3 + 4 * Math.sqrt((payload?.count ?? 1) / heaviestBin)} fill="var(--color-chart-1)" stroke="var(--card)" strokeWidth={2} />}
                    />
                  </LineChart>
                </ChartContainer>
                <p className="mt-2 text-[10px] leading-4 text-muted-foreground">On the dashed line, forecasts are honest. Above it the model is underconfident; below it, overconfident.</p>
              </div>

              <div className="overflow-x-auto rounded-xl border border-white/7">
                <table className="w-full min-w-[420px] text-left text-sm">
                  <thead className="bg-white/[.025] text-[10px] uppercase tracking-[.12em] text-muted-foreground"><tr><th className="px-3 py-3 font-medium">Forecast band</th><th className="px-3 py-3 text-right font-medium">Forecasts</th><th className="px-3 py-3 text-right font-medium">Mean forecast</th><th className="px-3 py-3 text-right font-medium">Observed</th></tr></thead>
                  <tbody>{(calibration?.bins ?? []).map((bin) => <tr key={bin.from} className="border-t border-white/6">
                    <td className="px-3 py-2.5 font-mono text-xs">{Math.round(bin.from * 100)}–{Math.round(bin.to * 100)}%</td>
                    <td className="px-3 text-right font-mono text-xs">{bin.count}</td>
                    <td className="px-3 text-right font-mono text-xs">{Math.round(bin.predicted * 1000) / 10}%</td>
                    <td className="px-3 text-right font-mono text-xs text-primary">{Math.round(bin.observed * 1000) / 10}%</td>
                  </tr>)}</tbody>
                </table>
              </div>
            </div>

            {Boolean(feed.byCompetition?.length) && <div className="overflow-x-auto rounded-xl border border-white/7">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="bg-white/[.025] text-[10px] uppercase tracking-[.12em] text-muted-foreground"><tr>{['Competition', 'Scored', 'Accuracy', 'Brier', 'Log loss', 'Lead'].map((head) => <th key={head} className="px-3 py-3 font-medium">{head}</th>)}</tr></thead>
                <tbody>{feed.byCompetition?.map((row) => <tr key={row.competitionId} className="border-t border-white/6">
                  <td className="px-3 py-2.5 font-medium">{row.competition ?? `Competition ${row.competitionId}`}</td>
                  <td className="px-3 font-mono text-xs">{row.matches}</td>
                  <td className="px-3 font-mono text-primary">{row.accuracy === null ? '—' : `${row.accuracy}%`}</td>
                  <td className="px-3 font-mono text-xs">{row.brier ?? '—'}</td>
                  <td className="px-3 font-mono text-xs">{row.logLoss ?? '—'}</td>
                  <td className="px-3 font-mono text-xs">{row.medianLeadHours === null ? '—' : `${row.medianLeadHours}h`}</td>
                </tr>)}</tbody>
              </table>
            </div>}
          </>}
          {feed.methodology && <p className="text-[10px] leading-4 text-muted-foreground">{feed.methodology}</p>}
        </div>}
    </CardContent>
  </Card>;
}

function SmallStat({ icon, label, value, note }: { icon: ReactNode; label: string; value: string; note: string }) { return <Card className="border-white/8 bg-card/75"><CardContent className="flex items-center gap-4 p-4"><span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary [&>svg]:size-4">{icon}</span><div><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-xl font-semibold tracking-tight">{value}</p><p className="text-[10px] text-muted-foreground">{note}</p></div></CardContent></Card>; }

function shortCompetition(name: string) {
  return name.replace('UEFA ', '').replace('EFL ', '').replace(' League', ' Lg').slice(0, 18);
}
