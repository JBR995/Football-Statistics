'use client';
/* oxlint-disable react/react-compiler */

import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, CheckCircle2, Database, Download, LoaderCircle, Search, ShieldAlert, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

type Kind = 'players' | 'teams';
type Direction = 'asc' | 'desc';
type Competition = { id: number; name: string; season: number | null };
type ExplorerFeed = { connected: boolean; competitions?: Competition[] } | null;
type Page = { page: number; limit: number; total: number; pages: number };
type StatRow = {
  id: number; name: string; teamId?: number; team?: string; competitionId: number; competition: string; season: number;
  position?: string | null; matches: number; minutes?: number; goals: number | null; assists?: number | null;
  shots: number | null; shotsOnTarget: number | null; foulsCommitted: number | null; foulsDrawn?: number | null;
  yellowCards: number | null; redCards: number | null; homeMatches: number; awayMatches: number;
  per90?: Record<string, number | null>; perMatch?: Record<string, number | null>;
};
type MatchRow = {
  fixtureId: number; kickoff: string; round: string | null; competition: string; season: number; venue: string;
  opponent: string; score: string; minutes: number | null; goals: number | null; assists: number | null;
  shots: number | null; shotsOnTarget: number | null; foulsCommitted: number | null; foulsDrawn: number | null;
  yellowCards: number | null; redCards: number | null;
};
type ExplorerResponse = { connected: boolean; rows?: StatRow[]; pagination?: Page; error?: string };
type FieldQuality = { present: number; missing: number; zero: number; of: number };
type QualitySet = { rows: number; shots: FieldQuality; shotsOnTarget: FieldQuality; foulsCommitted: FieldQuality; foulsDrawn?: FieldQuality; yellowCards: FieldQuality; redCards: FieldQuality };
type Reconciled = { comparable: number; exact: number; different: number };
type Coverage = {
  connected: boolean;
  seasons?: Array<{ competitionId: number; competition: string; season: number; completed: number; statistics: number; players: number }>;
  summary?: { seasons: number; fixtures: number; completed: number; statistics: { stored: number; of: number }; players: { stored: number; of: number } };
  fields?: { player: { rows: number }; team: { rows: number } };
  quality?: {
    team: QualitySet; player: QualitySet;
    reconciliation: { groups: number; shots: Reconciled; shotsOnTarget: Reconciled; fouls: Reconciled; yellowCards: Reconciled; redCards: Reconciled };
    importOutcomes: Array<{ detailClass: string; status: string; count: number }>;
    failedFixtures: Array<{ fixtureId: number; detailClass: string; message: string | null; attemptedAt: string; competition: string; season: number; match: string }>;
  };
  error?: string;
};

const SEASONS = [2026, 2025, 2024, 2023, 2022, 2021];
const FIELD_LABELS: Array<[keyof QualitySet, string]> = [
  ['shots', 'Shots'], ['shotsOnTarget', 'Shots on target'], ['foulsCommitted', 'Fouls committed'],
  ['foulsDrawn', 'Fouls drawn'], ['yellowCards', 'Yellow cards'], ['redCards', 'Red cards'],
];

export function StatisticsExplorer({ feed, loading: feedLoading }: { feed: ExplorerFeed; loading: boolean }) {
  const [kind, setKind] = useState<Kind>('players');
  const [league, setLeague] = useState('');
  const [season, setSeason] = useState('');
  const [venue, setVenue] = useState('all');
  const [recent, setRecent] = useState('0');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('minutes');
  const [direction, setDirection] = useState<Direction>('desc');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ExplorerResponse | null>(null);
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<StatRow | null>(null);
  const [matches, setMatches] = useState<MatchRow[] | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => { setQuery(search); setPage(1); }, 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let active = true;
    fetch('/api/football/history/coverage', { cache: 'no-store' })
      .then(async (response) => await response.json() as Coverage)
      .then((payload) => { if (active) setCoverage(payload); })
      .catch(() => { if (active) setCoverage({ connected: false, error: 'The quality audit could not be read.' }); });
    return () => { active = false; };
  }, []);

  const searchParams = useMemo(() => {
    const params = new URLSearchParams({ kind, venue, recent, search: query, sort, direction, page: String(page), limit: '25' });
    if (league) params.set('league', league);
    if (season) params.set('season', season);
    return params;
  }, [kind, league, season, venue, recent, query, sort, direction, page]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    fetch(`/api/football/statistics?${searchParams}`, { cache: 'no-store', signal: controller.signal })
      .then(async (response) => await response.json() as ExplorerResponse)
      .then(setData)
      .catch((error) => { if (error.name !== 'AbortError') setData({ connected: false, error: 'Statistics could not be read.' }); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [searchParams]);

  useEffect(() => {
    setSelected(null); setMatches(null); setPage(1); setSort(kind === 'players' ? 'minutes' : 'matches'); setDirection('desc');
  }, [kind]);

  const inspect = (row: StatRow) => {
    setSelected(row); setMatches(null);
    const params = new URLSearchParams({ kind, id: String(row.id), league: String(row.competitionId), season: String(row.season), venue, recent });
    if (row.teamId) params.set('team', String(row.teamId));
    fetch(`/api/football/statistics?${params}`, { cache: 'no-store' })
      .then(async (response) => await response.json() as { rows?: MatchRow[] })
      .then((payload) => setMatches(payload.rows ?? []))
      .catch(() => setMatches([]));
  };

  const changeSort = (key: string) => {
    if (sort === key) setDirection((value) => value === 'desc' ? 'asc' : 'desc');
    else { setSort(key); setDirection('desc'); }
    setPage(1);
  };

  const exportData = (format: 'csv' | 'json') => {
    const params = new URLSearchParams(searchParams);
    params.set('format', format); params.set('download', '1'); params.set('limit', '25000'); params.delete('page');
    window.location.assign(`/api/football/statistics?${params}`);
  };

  const outcome = (status: string) => coverage?.quality?.importOutcomes.find((row) => row.detailClass === 'players' && row.status === status)?.count ?? 0;
  const completed = coverage?.summary?.players.of ?? 0;
  const stored = coverage?.summary?.players.stored ?? 0;
  const actionable = Math.max(0, completed - stored - outcome('empty'));

  return <div className="space-y-5">
    <section className="grid gap-5 py-3 lg:grid-cols-[1fr_auto] lg:items-end">
      <div><Badge variant="outline" className="mb-3 border-primary/30 text-primary"><Database /> Research database</Badge><h1 className="text-3xl font-semibold tracking-[-.045em] sm:text-4xl">Team & player statistics</h1><p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">Search every stored appearance, compare season totals and rate statistics, inspect individual matches, and audit exactly where the evidence is complete, zero, missing, empty or failed.</p></div>
      <div className="flex gap-2"><Button variant="outline" onClick={() => exportData('csv')}><Download /> CSV</Button><Button variant="outline" onClick={() => exportData('json')}><Download /> JSON</Button></div>
    </section>

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Metric label="Completed fixtures" value={completed.toLocaleString()} note={`${coverage?.summary?.seasons ?? 0} competition-seasons`} />
      <Metric label="Player coverage" value={`${stored.toLocaleString()} / ${completed.toLocaleString()}`} note={`${coverage?.fields?.player.rows.toLocaleString() ?? 0} appearance rows`} progress={completed ? stored / completed * 100 : 0} />
      <Metric label="Still actionable" value={actionable.toLocaleString()} note="Excludes confirmed provider-empty fixtures" />
      <Metric label="Import outcomes" value={`${outcome('empty')} empty · ${outcome('failed')} failed`} note={feedLoading ? 'Checking provider capabilities' : feed?.connected ? 'Provider connected' : 'Provider unavailable'} />
    </div>

    <Card className="border-primary/12 bg-card/80">
      <CardHeader className="gap-4 xl:flex-row xl:items-center xl:justify-between"><div><CardTitle>Statistics explorer</CardTitle><p className="mt-1 text-xs text-muted-foreground">Totals use stored values only. A dash is missing data; a displayed zero is a genuine provider value.</p></div><Tabs value={kind} onValueChange={(value) => setKind(value as Kind)}><TabsList><TabsTrigger value="players"><Users /> Players</TabsTrigger><TabsTrigger value="teams"><ShieldAlert /> Teams</TabsTrigger></TabsList></Tabs></CardHeader>
      <CardContent>
        <div className="mb-4 grid gap-2 md:grid-cols-2 xl:grid-cols-[minmax(220px,1fr)_180px_150px_140px_140px]">
          <div className="relative"><Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" /><Input aria-label="Search players or teams" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={kind === 'players' ? 'Search player or club…' : 'Search club…'} className="h-9 pl-9" /></div>
          <NativeSelect className="w-full" value={league} onChange={(event) => { setLeague(event.target.value); setPage(1); }} aria-label="Competition"><NativeSelectOption value="">All competitions</NativeSelectOption>{feed?.competitions?.map((competition) => <NativeSelectOption key={competition.id} value={String(competition.id)}>{competition.name}</NativeSelectOption>)}</NativeSelect>
          <NativeSelect className="w-full" value={season} onChange={(event) => { setSeason(event.target.value); setPage(1); }} aria-label="Season"><NativeSelectOption value="">All seasons</NativeSelectOption>{SEASONS.map((value) => <NativeSelectOption key={value} value={String(value)}>{value}/{String(value + 1).slice(-2)}</NativeSelectOption>)}</NativeSelect>
          <NativeSelect className="w-full" value={venue} onChange={(event) => { setVenue(event.target.value); setPage(1); }} aria-label="Venue split"><NativeSelectOption value="all">Home & away</NativeSelectOption><NativeSelectOption value="home">Home only</NativeSelectOption><NativeSelectOption value="away">Away only</NativeSelectOption></NativeSelect>
          <NativeSelect className="w-full" value={recent} onChange={(event) => { setRecent(event.target.value); setPage(1); }} aria-label="Recent form"><NativeSelectOption value="0">Full season</NativeSelectOption><NativeSelectOption value="5">Last 5</NativeSelectOption><NativeSelectOption value="10">Last 10</NativeSelectOption></NativeSelect>
        </div>
        {loading ? <Loading copy="Calculating filtered totals…" /> : !data?.connected ? <ErrorState copy={data?.error ?? 'No statistics were returned.'} /> : <>
          <Table className="min-w-[1050px]"><TableHeader><TableRow><Sortable label={kind === 'players' ? 'Player' : 'Team'} field="name" sort={sort} direction={direction} onSort={changeSort} /><TableHead>Competition</TableHead><Sortable label={kind === 'players' ? 'Apps / min' : 'Matches'} field={kind === 'players' ? 'minutes' : 'matches'} sort={sort} direction={direction} onSort={changeSort} /><Sortable label="Goals" field="goals" sort={sort} direction={direction} onSort={changeSort} /><Sortable label="Shots" field="shots" sort={sort} direction={direction} onSort={changeSort} /><Sortable label="On target" field="shotsOnTarget" sort={sort} direction={direction} onSort={changeSort} /><Sortable label="Fouls" field="foulsCommitted" sort={sort} direction={direction} onSort={changeSort} /><Sortable label="Cards" field="yellowCards" sort={sort} direction={direction} onSort={changeSort} /><TableHead className="text-right">Matches</TableHead></TableRow></TableHeader>
            <TableBody>{data.rows?.map((row) => { const rate = row.per90 ?? row.perMatch; return <TableRow key={`${row.id}:${row.teamId ?? ''}:${row.competitionId}:${row.season}`}><TableCell><div className="font-medium">{row.name}</div><div className="text-xs text-muted-foreground">{row.team ?? row.position ?? 'Team total'} · {row.homeMatches}H/{row.awayMatches}A</div></TableCell><TableCell><div>{row.competition}</div><div className="font-mono text-xs text-muted-foreground">{row.season}/{String(row.season + 1).slice(-2)}</div></TableCell><TableCell>{kind === 'players' ? <><b>{row.matches}</b><span className="text-muted-foreground"> / {row.minutes ?? '—'}</span></> : row.matches}</TableCell><RateCell total={row.goals} rate={rate?.goals} /><RateCell total={row.shots} rate={rate?.shots} /><RateCell total={row.shotsOnTarget} rate={rate?.shotsOnTarget} /><RateCell total={row.foulsCommitted} rate={rate?.foulsCommitted} /><TableCell>{value(row.yellowCards)} <span className="text-muted-foreground">/</span> {value(row.redCards)}</TableCell><TableCell className="text-right"><Button size="sm" variant={selected?.id === row.id && selected?.teamId === row.teamId ? 'secondary' : 'ghost'} onClick={() => inspect(row)}>Inspect</Button></TableCell></TableRow>; })}</TableBody></Table>
          {!data.rows?.length && <div className="py-12 text-center text-sm text-muted-foreground">No stored rows match these filters yet.</div>}
          <div className="mt-4 flex items-center justify-between gap-3 text-xs text-muted-foreground"><span>{(data.pagination?.total ?? 0).toLocaleString()} result rows</span><div className="flex items-center gap-2"><Button size="sm" variant="outline" disabled={(data.pagination?.page ?? 1) <= 1} onClick={() => setPage((value) => value - 1)}>Previous</Button><span className="font-mono">{data.pagination?.page ?? 1} / {data.pagination?.pages ?? 1}</span><Button size="sm" variant="outline" disabled={(data.pagination?.page ?? 1) >= (data.pagination?.pages ?? 1)} onClick={() => setPage((value) => value + 1)}>Next</Button></div></div>
        </>}
      </CardContent>
    </Card>

    {selected && <Card className="border-primary/15 bg-card/80"><CardHeader><CardTitle>{selected.name} · match log</CardTitle><p className="text-xs text-muted-foreground">{selected.team ? `${selected.team} · ` : ''}{selected.competition} {selected.season}/{String(selected.season + 1).slice(-2)} · newest first</p></CardHeader><CardContent>{matches === null ? <Loading copy="Reading match records…" /> : !matches.length ? <p className="py-8 text-center text-sm text-muted-foreground">No match records are available for this selection.</p> : <Table className="min-w-[900px]"><TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Venue</TableHead><TableHead>Opponent</TableHead><TableHead>Score</TableHead>{kind === 'players' && <TableHead>Minutes</TableHead>}<TableHead>Goals</TableHead><TableHead>Shots</TableHead><TableHead>On target</TableHead><TableHead>Fouls</TableHead><TableHead>Cards</TableHead></TableRow></TableHeader><TableBody>{matches.map((match) => <TableRow key={match.fixtureId}><TableCell>{new Date(match.kickoff).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</TableCell><TableCell>{match.venue}</TableCell><TableCell>{match.opponent}</TableCell><TableCell className="font-mono">{match.score}</TableCell>{kind === 'players' && <TableCell>{value(match.minutes)}</TableCell>}<TableCell>{value(match.goals)}</TableCell><TableCell>{value(match.shots)}</TableCell><TableCell>{value(match.shotsOnTarget)}</TableCell><TableCell>{value(match.foulsCommitted)}{kind === 'players' ? ` / ${value(match.foulsDrawn)} drawn` : ''}</TableCell><TableCell>{value(match.yellowCards)}Y · {value(match.redCards)}R</TableCell></TableRow>)}</TableBody></Table>}</CardContent></Card>}

    <QualityAudit coverage={coverage} />
  </div>;
}

function QualityAudit({ coverage }: { coverage: Coverage | null }) {
  if (!coverage) return <Card className="border-white/8 bg-card/75"><CardContent><Loading copy="Auditing stored data…" /></CardContent></Card>;
  if (!coverage.connected || !coverage.quality) return <Card className="border-amber-300/15 bg-card/75"><CardContent className="p-5"><ErrorState copy={coverage.error ?? 'The quality audit is unavailable.'} /></CardContent></Card>;
  const reconciliation = coverage.quality.reconciliation;
  return <div className="space-y-4">
    <Card className="border-white/8 bg-card/75"><CardHeader><CardTitle>Missing values versus genuine zeroes</CardTitle><p className="text-xs text-muted-foreground">Nulls are retained as missing; zeroes remain measurable zero events. Counts update as the backfill advances.</p></CardHeader><CardContent className="grid gap-3 lg:grid-cols-2"><QualityTable title="Player appearances" data={coverage.quality.player} /><QualityTable title="Team match rows" data={coverage.quality.team} /></CardContent></Card>
    <div className="grid gap-4 xl:grid-cols-[1.15fr_.85fr]">
      <Card className="border-white/8 bg-card/75"><CardHeader><CardTitle>Player-to-team reconciliation</CardTitle><p className="text-xs text-muted-foreground">Exact sums among fixture-team groups where both sides supplied a value.</p></CardHeader><CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{([['shots', 'Shots'], ['shotsOnTarget', 'On target'], ['fouls', 'Fouls'], ['yellowCards', 'Yellow'], ['redCards', 'Red']] as const).map(([key, label]) => { const item = reconciliation[key]; const share = item.comparable ? item.exact / item.comparable * 100 : 0; return <div key={key} className="rounded-xl border border-white/7 bg-white/[.02] p-4"><div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">{label}</span><span className="font-mono text-xs text-primary">{share.toFixed(1)}%</span></div><Progress value={share} className="mt-3" /><p className="mt-2 text-xs text-muted-foreground">{item.exact.toLocaleString()} exact · {item.different.toLocaleString()} different</p></div>; })}</CardContent></Card>
      <Card className="border-white/8 bg-card/75"><CardHeader><CardTitle>Provider outcomes</CardTitle><p className="text-xs text-muted-foreground">Durable empty and failure records from new importer runs.</p></CardHeader><CardContent><div className="grid grid-cols-3 gap-2">{['stored', 'empty', 'failed'].map((status) => <div key={status} className="rounded-xl border border-white/7 bg-white/[.02] p-3 text-center"><p className="font-mono text-lg">{coverage.quality?.importOutcomes.filter((row) => row.status === status).reduce((sum, row) => sum + row.count, 0).toLocaleString()}</p><p className="text-xs capitalize text-muted-foreground">{status}</p></div>)}</div>{coverage.quality.failedFixtures.length ? <div className="mt-4 space-y-2">{coverage.quality.failedFixtures.slice(0, 5).map((item) => <div key={`${item.fixtureId}:${item.detailClass}`} className="rounded-lg border border-red-300/10 bg-red-300/[.03] p-3 text-xs"><p className="font-medium">{item.match}</p><p className="mt-1 text-muted-foreground">{item.detailClass} · {item.message ?? 'Unspecified provider failure'}</p></div>)}</div> : <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground"><CheckCircle2 className="size-4 text-primary" /> No failed fixtures are recorded.</p>}</CardContent></Card>
    </div>
    <Card className="border-white/8 bg-card/75"><CardHeader><CardTitle>Coverage by competition and season</CardTitle><p className="text-xs text-muted-foreground">Stored fixture-level team and player statistics against completed matches.</p></CardHeader><CardContent><div className="max-h-[520px] overflow-auto rounded-xl border border-white/7"><Table className="min-w-[720px]"><TableHeader className="sticky top-0 bg-card"><TableRow><TableHead>Competition</TableHead><TableHead>Season</TableHead><TableHead className="text-right">Completed</TableHead><TableHead className="text-right">Team stats</TableHead><TableHead className="text-right">Player stats</TableHead><TableHead>Player coverage</TableHead></TableRow></TableHeader><TableBody>{coverage.seasons?.map((row) => { const share = row.completed ? row.players / row.completed * 100 : 0; return <TableRow key={`${row.competitionId}:${row.season}`}><TableCell>{row.competition}</TableCell><TableCell className="font-mono">{row.season}/{String(row.season + 1).slice(-2)}</TableCell><TableCell className="text-right font-mono">{row.completed.toLocaleString()}</TableCell><TableCell className="text-right font-mono">{row.statistics.toLocaleString()}</TableCell><TableCell className="text-right font-mono">{row.players.toLocaleString()}</TableCell><TableCell><div className="flex min-w-32 items-center gap-2"><Progress value={share} className="flex-1" /><span className="w-12 text-right font-mono text-xs">{share.toFixed(1)}%</span></div></TableCell></TableRow>; })}</TableBody></Table></div></CardContent></Card>
  </div>;
}

function QualityTable({ title, data }: { title: string; data: QualitySet }) {
  return <div className="rounded-xl border border-white/7 bg-white/[.02] p-4"><div className="mb-3 flex items-center justify-between"><p className="font-medium">{title}</p><Badge variant="outline">{data.rows.toLocaleString()} rows</Badge></div><div className="space-y-2">{FIELD_LABELS.map(([key, label]) => { const field = data[key] as FieldQuality | undefined; if (!field) return null; return <div key={key} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 text-xs"><span className="text-muted-foreground">{label}</span><span className="font-mono text-primary">{field.zero.toLocaleString()} zero</span><span className={field.missing ? 'font-mono text-amber-200' : 'font-mono text-muted-foreground'}>{field.missing.toLocaleString()} missing</span></div>; })}</div></div>;
}

function Sortable({ label, field, sort, direction, onSort }: { label: string; field: string; sort: string; direction: Direction; onSort: (field: string) => void }) {
  const Icon = sort === field ? direction === 'desc' ? ArrowDown : ArrowUp : ArrowUpDown;
  return <TableHead><button className="inline-flex items-center gap-1.5 hover:text-primary" onClick={() => onSort(field)}>{label}<Icon className="size-3" /></button></TableHead>;
}

function RateCell({ total, rate }: { total: number | null; rate: number | null | undefined }) {
  return <TableCell><span>{value(total)}</span><span className="ml-1.5 text-xs text-muted-foreground">{rate === null || rate === undefined ? '—' : rate.toFixed(2)} rate</span></TableCell>;
}

function Metric({ label, value: metric, note, progress }: { label: string; value: string; note: string; progress?: number }) {
  return <Card className="border-white/8 bg-card/75"><CardContent className="p-4"><p className="font-mono text-xl text-primary">{metric}</p><p className="mt-1 text-xs font-medium">{label}</p>{progress !== undefined && <Progress value={progress} className="mt-3" />}<p className="mt-2 text-xs text-muted-foreground">{note}</p></CardContent></Card>;
}

function Loading({ copy }: { copy: string }) { return <div className="flex min-h-28 items-center justify-center gap-3 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin text-primary" />{copy}</div>; }
function ErrorState({ copy }: { copy: string }) { return <div className="rounded-xl border border-amber-300/15 bg-amber-300/[.04] p-4 text-sm text-amber-100">{copy}</div>; }
function value(input: number | null | undefined) { return input === null || input === undefined ? '—' : input.toLocaleString(); }
