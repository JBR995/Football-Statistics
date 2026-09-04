'use client';

import { useEffect, useState } from 'react';
import {
  BrainCircuit,
  CalendarClock,
  CheckCircle2,
  CircleAlert,
  History,
  LoaderCircle,
  RefreshCw,
  Users,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';

type Competition = { id: number; name: string; season: number | null };
type Team = { id: number; name: string; logo: string | null };
type Fixture = { id: number; kickoff: string; status: string; round: string | null; venue: string | null; home: Team; away: Team; score: { home: number | null; away: number | null } };
type IntelligenceFeed = { upcoming?: Fixture[] };
type TeamSplit = { played: number; won: number; drawn: number; lost: number; gf: number; ga: number; cleanSheets: number; btts: number; over25: number };
type TeamAnalysis = { connected: boolean; team?: Team; home?: TeamSplit; away?: TeamSplit; form?: Array<{ id: number; opponent: string; gf: number; ga: number; result: string }>; error?: string };
type PlayerEvidence = {
  teamId: number;
  playerId: number;
  name: string;
  position: string | null;
  matches: number;
  minutes: number;
  totals: { shots: number; shotsOn: number; goals: number; assists: number; foulsCommitted: number; yellowCards: number; redCards: number };
  per90: { shots: number; shotsOn: number; goals: number; assists: number; foulsCommitted: number };
  observedShotMatches: number;
  attackShare: number;
};
type LineupPlayer = { id: number | null; name: string; number: number | null; position: string | null };
type Lineup = { teamId: number; formation: string | null; coach: string | null; starters: LineupPlayer[]; substitutes: LineupPlayer[] };
type Injury = { teamId: number; playerId: number | null; playerName: string; injuryType: string | null; reason: string | null };
type Meeting = { id: number; season: number; kickoff: string; home_team_id: number; home_name: string; away_team_id: number; away_name: string; home_goals: number; away_goals: number };
type MatchAnalysis = {
  connected: boolean;
  form?: { home: Array<{ opponent: string; gf: number; ga: number; result: string }>; away: Array<{ opponent: string; gf: number; ga: number; result: string }> };
  h2h?: Meeting[];
  lineups?: Lineup[];
  availability?: { capturedAt: string; lineups: Lineup[]; injuries: Injury[] } | null;
  playerEvidence?: PlayerEvidence[];
  market?: { bookmakers: number; overround: number; probabilities: Outcome } | null;
  error?: string;
};
type Outcome = { home: number; draw: number; away: number };
type Prediction = {
  connected: boolean;
  model?: { name: string; trainingMatches: number; usesFutureData: boolean };
  probabilities?: Outcome;
  expectedGoals?: { home: number; away: number };
  markets?: { over25: number; btts: number };
  scorelines?: Array<{ score: string; probability: number }>;
  evidence?: { homeElo: number; awayElo: number; homeMatches: number; awayMatches: number; homeAttack: number; awayAttack: number; homeDefence: number; awayDefence: number };
  validation?: { matches: number; brier: number | null; logLoss: number | null };
  market?: MatchAnalysis['market'];
  confidence?: number;
  sampleWarning?: string;
  error?: string;
};
type Scenario = { expectedGoals: { home: number; away: number }; probabilities: Outcome; over25: number; btts: number; homePenalty: number; awayPenalty: number };

const EMPTY_FIXTURES: Fixture[] = [];

export function MatchLabWorkbench({
  competitions,
  selectedLeague,
  selectedSeason,
  setSelectedLeague,
  intelligence,
  intelligenceLoading,
}: {
  competitions: Competition[];
  selectedLeague: number;
  selectedSeason: number;
  setSelectedLeague: (league: number) => void;
  intelligence: IntelligenceFeed | null;
  intelligenceLoading: boolean;
}) {
  const fixtures = intelligence?.upcoming ?? EMPTY_FIXTURES;
  const [fixtureId, setFixtureId] = useState<number | null>(null);
  const [prediction, setPrediction] = useState<Prediction | null>(null);
  const [homeAnalysis, setHomeAnalysis] = useState<TeamAnalysis | null>(null);
  const [awayAnalysis, setAwayAnalysis] = useState<TeamAnalysis | null>(null);
  const [match, setMatch] = useState<MatchAnalysis | null>(null);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [loadedFixtureId, setLoadedFixtureId] = useState<number | null>(null);

  const activeFixtureId = fixtureId && fixtures.some((fixture) => fixture.id === fixtureId) ? fixtureId : fixtures[0]?.id ?? null;
  const fixture = fixtures.find((item) => item.id === activeFixtureId);

  useEffect(() => {
    const selected = fixtures.find((item) => item.id === activeFixtureId);
    if (!selected) return;
    let active = true;
    Promise.all([
      getJson<Prediction>(`/api/football/prediction?fixture=${selected.id}`),
      getJson<TeamAnalysis>(`/api/football/team?team=${selected.home.id}&league=${selectedLeague}&season=${selectedSeason}`),
      getJson<TeamAnalysis>(`/api/football/team?team=${selected.away.id}&league=${selectedLeague}&season=${selectedSeason}`),
      getJson<MatchAnalysis>(`/api/football/match?fixture=${selected.id}`),
    ]).then(([forecast, home, away, analysis]) => {
      if (!active) return;
      setPrediction(forecast);
      setHomeAnalysis(home);
      setAwayAnalysis(away);
      setMatch(analysis);
      setExcluded(providerBaseline(analysis));
    }).catch(() => {
      if (active) setPrediction({ connected: false, error: 'The selected fixture could not be analysed.' });
    }).finally(() => {
      if (active) setLoadedFixtureId(selected.id);
    });
    return () => { active = false; };
  }, [activeFixtureId, fixtures, selectedLeague, selectedSeason]);

  const players = match?.playerEvidence ?? [];
  const homePlayers = fixture ? players.filter((player) => player.teamId === fixture.home.id) : [];
  const awayPlayers = fixture ? players.filter((player) => player.teamId === fixture.away.id) : [];
  const scenario = prediction?.expectedGoals && fixture ? buildScenario(prediction.expectedGoals, homePlayers, awayPlayers, excluded) : null;
  const baseline = match ? providerBaseline(match) : new Set<string>();
  const selectedCompetition = competitions.find((competition) => competition.id === selectedLeague);
  const loading = Boolean(activeFixtureId && loadedFixtureId !== activeFixtureId);

  const togglePlayer = (player: PlayerEvidence, available: boolean) => {
    const key = playerKey(player);
    setExcluded((current) => {
      const next = new Set(current);
      if (available) next.delete(key); else next.add(key);
      return next;
    });
  };

  return <section className="space-y-4">
    <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <p className="mb-2 font-mono text-xs uppercase tracking-[.18em] text-primary">Pre-kickoff evidence · scenario lab</p>
        <h2 className="text-2xl font-semibold tracking-tight">Match prediction lab</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">Compare the teams and their leading players, inspect prior meetings and provider availability, then test how a different attacking line-up changes the probability shape.</p>
      </div>
      <Select value={String(selectedLeague)} onValueChange={(value) => value && setSelectedLeague(Number(value))}>
        <SelectTrigger aria-label="Competition" className="w-full lg:w-[250px]"><span className="truncate">{selectedCompetition?.name ?? 'Competition'}</span></SelectTrigger>
        <SelectContent>{competitions.map((competition) => <SelectItem key={competition.id} value={String(competition.id)}>{competition.name}</SelectItem>)}</SelectContent>
      </Select>
    </div>

    <Card className="border-white/8 bg-card/75">
      <CardContent className="grid gap-4 p-4 md:grid-cols-[1fr_auto] md:items-end">
        <div className="block text-sm font-medium"><span id="upcoming-fixture-label">Upcoming fixture</span>
          <Select value={activeFixtureId ? String(activeFixtureId) : ''} onValueChange={(value) => value && setFixtureId(Number(value))}>
            <SelectTrigger aria-labelledby="upcoming-fixture-label" className="mt-2 w-full bg-white/[.025]"><SelectValue placeholder={intelligenceLoading ? 'Loading fixtures…' : 'Choose a fixture'} /></SelectTrigger>
            <SelectContent>{fixtures.map((item) => <SelectItem key={item.id} value={String(item.id)}>{formatKickoff(item.kickoff)} · {item.home.name} vs {item.away.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <Badge variant="outline" className="h-9 px-3 text-muted-foreground">{fixtures.length} stored upcoming fixtures</Badge>
      </CardContent>
    </Card>

    {intelligenceLoading || loading ? <LoadingState /> : !fixture ? <EmptyState /> : !prediction?.connected || !prediction.probabilities || !prediction.expectedGoals || !scenario ? <ErrorState message={prediction?.error} /> : <>
      <ForecastHeader fixture={fixture} prediction={prediction} scenario={scenario} hasChanges={excluded.size > 0} />

      <div className="grid gap-4 xl:grid-cols-[1.15fr_.85fr]">
        <ScenarioWorkshop
          fixture={fixture}
          prediction={prediction}
          scenario={scenario}
          excluded={excluded}
          baseline={baseline}
          homePlayers={homePlayers}
          awayPlayers={awayPlayers}
          onToggle={togglePlayer}
          onReset={() => setExcluded(new Set(baseline))}
          onFullStrength={() => setExcluded(new Set())}
          onThreatOut={(player) => setExcluded((current) => new Set(current).add(playerKey(player)))}
        />
        <EvidenceTrail fixture={fixture} prediction={prediction} match={match} homeAnalysis={homeAnalysis} awayAnalysis={awayAnalysis} scenario={scenario} excluded={excluded} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <TeamFormCard team={fixture.home} side="Home" data={homeAnalysis} />
        <TeamFormCard team={fixture.away} side="Away" data={awayAnalysis} />
      </div>

      <AvailabilityCard fixture={fixture} match={match} />
      <PreviousMeetings fixture={fixture} meetings={match?.h2h ?? []} />
    </>}
  </section>;
}

function ForecastHeader({ fixture, prediction, scenario, hasChanges }: { fixture: Fixture; prediction: Prediction; scenario: Scenario; hasChanges: boolean }) {
  const probabilities = hasChanges ? scenario.probabilities : prediction.probabilities!;
  const expectedGoals = hasChanges ? scenario.expectedGoals : prediction.expectedGoals!;
  return <Card className="relative overflow-hidden border-primary/18 bg-card/85 py-0">
    <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary to-transparent" />
    <CardHeader className="border-b border-white/8 px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="mb-2 flex flex-wrap gap-2"><Badge className="bg-primary/12 text-primary">{prediction.model?.name}</Badge>{hasChanges && <Badge variant="outline" className="border-amber-300/25 text-amber-100">Scenario active</Badge>}</div>
        <CardTitle className="text-xl">{fixture.home.name} vs {fixture.away.name}</CardTitle>
        <p className="mt-1 text-xs text-muted-foreground">{formatKickoff(fixture.kickoff)} · {fixture.venue ?? fixture.round ?? 'Venue to be confirmed'}</p>
      </div>
      <div className="mt-3 text-left sm:mt-0 sm:text-right"><p className="font-mono text-2xl text-primary">{expectedGoals.home.toFixed(2)} – {expectedGoals.away.toFixed(2)}</p><p className="text-xs text-muted-foreground">scenario expected goals</p></div>
    </CardHeader>
    <CardContent className="grid gap-4 p-5 md:grid-cols-3">
      <Probability label={`${fixture.home.name} win`} value={probabilities.home} baseline={prediction.probabilities!.home} />
      <Probability label="Draw" value={probabilities.draw} baseline={prediction.probabilities!.draw} />
      <Probability label={`${fixture.away.name} win`} value={probabilities.away} baseline={prediction.probabilities!.away} />
    </CardContent>
  </Card>;
}

function ScenarioWorkshop({ fixture, prediction, scenario, excluded, baseline, homePlayers, awayPlayers, onToggle, onReset, onFullStrength, onThreatOut }: {
  fixture: Fixture;
  prediction: Prediction;
  scenario: Scenario;
  excluded: Set<string>;
  baseline: Set<string>;
  homePlayers: PlayerEvidence[];
  awayPlayers: PlayerEvidence[];
  onToggle: (player: PlayerEvidence, available: boolean) => void;
  onReset: () => void;
  onFullStrength: () => void;
  onThreatOut: (player: PlayerEvidence) => void;
}) {
  return <Card className="border-white/8 bg-card/75">
    <CardHeader>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div><CardTitle>Alternative line-up scenario</CardTitle><p className="mt-1 text-sm leading-5 text-muted-foreground">Switch leading contributors in or out of the attacking plan. The probability view updates immediately.</p></div>
        <Badge variant="outline" className="w-fit border-primary/20 text-primary">{excluded.size} adjusted</Badge>
      </div>
      <div className="flex flex-wrap gap-2 pt-2">
        <Button size="sm" variant="secondary" onClick={onReset}><RefreshCw className="size-3.5" /> Provider evidence</Button>
        <Button size="sm" variant="outline" onClick={onFullStrength}><CheckCircle2 className="size-3.5" /> Full strength</Button>
        {homePlayers[0] && <Button size="sm" variant="outline" onClick={() => onThreatOut(homePlayers[0])}>{fixture.home.name} threat out</Button>}
        {awayPlayers[0] && <Button size="sm" variant="outline" onClick={() => onThreatOut(awayPlayers[0])}>{fixture.away.name} threat out</Button>}
      </div>
    </CardHeader>
    <CardContent className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <ImpactMetric team={fixture.home.name} penalty={scenario.homePenalty} baseline={prediction.expectedGoals!.home} adjusted={scenario.expectedGoals.home} />
        <ImpactMetric team={fixture.away.name} penalty={scenario.awayPenalty} baseline={prediction.expectedGoals!.away} adjusted={scenario.expectedGoals.away} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <PlayerComparison team={fixture.home} players={homePlayers} excluded={excluded} baseline={baseline} onToggle={onToggle} />
        <PlayerComparison team={fixture.away} players={awayPlayers} excluded={excluded} baseline={baseline} onToggle={onToggle} />
      </div>
      <p className="rounded-xl border border-amber-300/15 bg-amber-300/[.035] p-3 text-xs leading-5 text-muted-foreground"><CircleAlert className="mr-2 inline size-4 text-amber-100" />Scenario changes are sensitivity tests, not causal injury estimates. Each selected absence discounts 35% of that player&apos;s recorded attacking share, with a 30% team cap, then reruns the same Poisson outcome grid.</p>
    </CardContent>
  </Card>;
}

function PlayerComparison({ team, players, excluded, baseline, onToggle }: { team: Team; players: PlayerEvidence[]; excluded: Set<string>; baseline: Set<string>; onToggle: (player: PlayerEvidence, available: boolean) => void }) {
  return <div className="rounded-2xl border border-white/8 bg-white/[.02] p-4">
    <div className="mb-3 flex items-center justify-between"><div className="flex items-center gap-2">{/* oxlint-disable-next-line next/no-img-element */}{team.logo && <img src={team.logo} alt="" className="size-7 object-contain" />}<h3 className="font-medium">{team.name}</h3></div><span className="text-xs text-muted-foreground">recorded share</span></div>
    {!players.length ? <p className="py-6 text-sm text-muted-foreground">Player evidence is not available for this season yet.</p> : <div className="space-y-2">{players.slice(0, 5).map((player) => {
      const key = playerKey(player);
      const available = !excluded.has(key);
      return <div key={key} className="grid grid-cols-[1fr_auto] gap-3 rounded-xl border border-white/7 p-3">
        <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="truncate text-sm font-medium">{player.name}</p>{baseline.has(key) && <Badge variant="outline" className="border-amber-300/20 px-1.5 py-0 text-[12px] text-amber-100">out of XI</Badge>}</div><p className="mt-1 text-xs text-muted-foreground">{player.position ?? '—'} · {player.matches} apps · {player.minutes.toLocaleString()} min</p><div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 font-mono text-xs text-muted-foreground"><span>{player.per90.shotsOn.toFixed(2)} SOT/90</span><span>{player.totals.goals}G</span><span>{player.totals.assists}A</span><span className="text-primary">{(player.attackShare * 100).toFixed(1)}%</span></div></div>
        <Switch checked={available} onCheckedChange={(checked) => onToggle(player, checked)} aria-label={`${available ? 'Remove' : 'Restore'} ${player.name} in scenario`} />
      </div>;
    })}</div>}
  </div>;
}

function EvidenceTrail({ fixture, prediction, match, homeAnalysis, awayAnalysis, scenario, excluded }: { fixture: Fixture; prediction: Prediction; match: MatchAnalysis | null; homeAnalysis: TeamAnalysis | null; awayAnalysis: TeamAnalysis | null; scenario: Scenario; excluded: Set<string> }) {
  const items = explainEvidence(fixture, prediction, match, homeAnalysis, awayAnalysis, scenario, excluded);
  return <Card className="border-white/8 bg-card/75">
    <CardHeader><CardTitle>What is influencing the forecast</CardTitle><p className="text-sm text-muted-foreground">Every explanation names the stored evidence behind it.</p></CardHeader>
    <CardContent className="space-y-3">{items.map((item) => <div key={item.label} className="rounded-xl border border-white/7 p-4"><div className="flex items-center justify-between gap-3"><p className="text-sm font-medium">{item.label}</p><Badge variant="outline" className={directionClass(item.direction)}>{item.direction}</Badge></div><p className="mt-2 text-sm leading-5 text-muted-foreground">{item.copy}</p></div>)}
      <div className="rounded-xl border border-primary/12 bg-primary/[.025] p-4 text-xs leading-5 text-muted-foreground"><BrainCircuit className="mb-2 size-4 text-primary" />Only fixtures before kickoff contribute to Elo, form, player records, head-to-head evidence and validation. Scenario adjustments remain separate from the stored baseline forecast.</div>
    </CardContent>
  </Card>;
}

function TeamFormCard({ team, side, data }: { team: Team; side: 'Home' | 'Away'; data: TeamAnalysis | null }) {
  const split = side === 'Home' ? data?.home : data?.away;
  return <Card className="border-white/8 bg-card/75"><CardHeader className="flex-row items-center gap-3">{/* oxlint-disable-next-line next/no-img-element */}{team.logo && <img src={team.logo} alt="" className="size-10 object-contain" />}<div><CardTitle>{team.name}</CardTitle><p className="mt-1 text-sm text-muted-foreground">{side} split and last-six form</p></div></CardHeader><CardContent>{!data?.connected || !split ? <p className="text-sm text-muted-foreground">Team evidence is unavailable.</p> : <><div className="grid grid-cols-4 gap-2"><MiniMetric label="Played" value={split.played} /><MiniMetric label="Won" value={split.won} /><MiniMetric label="GF" value={split.gf} /><MiniMetric label="GA" value={split.ga} /></div><div className="mt-4 flex flex-wrap gap-2">{data.form?.map((game) => <Badge key={game.id} variant="outline" className={game.result === 'W' ? 'text-primary' : game.result === 'D' ? 'text-amber-200' : 'text-red-200'}>{game.result} {game.gf}–{game.ga} · {game.opponent}</Badge>)}</div><p className="mt-4 text-xs text-muted-foreground">{split.cleanSheets} clean sheets · {split.btts} BTTS · {split.over25} over 2.5</p></>}</CardContent></Card>;
}

function AvailabilityCard({ fixture, match }: { fixture: Fixture; match: MatchAnalysis | null }) {
  const availability = match?.availability;
  const lineups = availability?.lineups.length ? availability.lineups : match?.lineups ?? [];
  const injuries = availability?.injuries ?? [];
  return <Card className="border-white/8 bg-card/75">
    <CardHeader className="sm:flex-row sm:items-start sm:justify-between"><div><CardTitle>Line-up and availability evidence</CardTitle><p className="mt-1 text-sm text-muted-foreground">Provider records captured before kickoff; never inferred from the final result.</p></div>{availability ? <Badge variant="outline" className="mt-2 w-fit border-primary/20 text-primary sm:mt-0"><CalendarClock className="size-3.5" /> {formatDateTime(availability.capturedAt)}</Badge> : <Badge variant="outline" className="mt-2 w-fit text-muted-foreground sm:mt-0">Awaiting provider snapshot</Badge>}</CardHeader>
    <CardContent className="space-y-4">
      {lineups.length ? <div className="grid gap-3 lg:grid-cols-2">{[fixture.home, fixture.away].map((team) => <LineupPanel key={team.id} team={team} lineup={lineups.find((lineup) => lineup.teamId === team.id)} />)}</div> : <div className="rounded-xl border border-white/7 p-4 text-sm text-muted-foreground"><Users className="mb-2 size-4" />Confirmed line-ups have not been released for this fixture. The scenario starts from recorded injuries only, or full strength when no snapshot exists.</div>}
      {injuries.length ? <div><p className="mb-2 text-sm font-medium">Provider-listed absences</p><div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{injuries.map((injury, index) => <div key={`${injury.teamId}:${injury.playerId ?? injury.playerName}:${index}`} className="rounded-xl border border-amber-300/12 bg-amber-300/[.025] p-3"><p className="text-sm font-medium">{injury.playerName}</p><p className="mt-1 text-xs text-muted-foreground">{injury.teamId === fixture.home.id ? fixture.home.name : fixture.away.name} · {injury.reason ?? injury.injuryType ?? 'Unavailable'}</p></div>)}</div></div> : <p className="text-sm text-muted-foreground">No injuries or suspensions were listed in the latest stored snapshot.</p>}
    </CardContent>
  </Card>;
}

function LineupPanel({ team, lineup }: { team: Team; lineup?: Lineup }) {
  return <div className="rounded-2xl border border-white/8 p-4"><div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2">{/* oxlint-disable-next-line next/no-img-element */}{team.logo && <img src={team.logo} alt="" className="size-7 object-contain" />}<p className="font-medium">{team.name}</p></div><span className="font-mono text-sm text-primary">{lineup?.formation ?? '—'}</span></div>{lineup ? <><p className="mt-2 text-xs text-muted-foreground">{lineup.coach ?? 'Coach not recorded'}</p><div className="mt-3 flex flex-wrap gap-1.5">{lineup.starters.map((player) => <Badge key={`${player.id ?? player.name}`} variant="outline" className="font-normal">{player.number ? `${player.number} · ` : ''}{player.name}</Badge>)}</div></> : <p className="mt-3 text-sm text-muted-foreground">No confirmed XI stored.</p>}</div>;
}

function PreviousMeetings({ fixture, meetings }: { fixture: Fixture; meetings: Meeting[] }) {
  return <Card className="border-white/8 bg-card/75"><CardHeader><CardTitle>Previous meetings</CardTitle><p className="text-sm text-muted-foreground">Up to eight stored meetings from the previous five seasons, all before this kickoff.</p></CardHeader><CardContent>{meetings.length ? <div className="grid gap-2 md:grid-cols-2">{meetings.map((meeting) => <div key={meeting.id} className="rounded-xl border border-white/7 p-3"><div className="mb-2 flex items-center justify-between text-xs text-muted-foreground"><span>{formatShortDate(meeting.kickoff)}</span><span>{meeting.season}/{String(meeting.season + 1).slice(-2)}</span></div><div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-sm"><span className={meeting.home_team_id === fixture.home.id ? 'font-medium' : ''}>{meeting.home_name}</span><span className="font-mono text-base text-primary">{meeting.home_goals}–{meeting.away_goals}</span><span className={`text-right ${meeting.away_team_id === fixture.away.id ? 'font-medium' : ''}`}>{meeting.away_name}</span></div></div>)}</div> : <div className="flex items-start gap-3 rounded-xl border border-white/7 p-4 text-sm text-muted-foreground"><History className="mt-0.5 size-4 shrink-0" />No earlier meeting is stored in the five-season comparison window.</div>}</CardContent></Card>;
}

function Probability({ label, value, baseline }: { label: string; value: number; baseline: number }) {
  const delta = Number((value - baseline).toFixed(1));
  return <div className="rounded-2xl border border-white/8 bg-white/[.02] p-4"><div className="flex items-end justify-between gap-3"><p className="text-sm font-medium">{label}</p><p className="font-mono text-2xl text-primary">{value.toFixed(1)}%</p></div><Progress value={value} className="mt-3" /><p className="mt-2 text-xs text-muted-foreground">{delta === 0 ? 'unchanged from baseline' : `${delta > 0 ? '+' : ''}${delta.toFixed(1)} points vs baseline`}</p></div>;
}

function ImpactMetric({ team, penalty, baseline, adjusted }: { team: string; penalty: number; baseline: number; adjusted: number }) {
  return <div className="rounded-xl border border-white/7 p-3"><div className="flex items-center justify-between gap-2"><p className="truncate text-sm font-medium">{team}</p><span className="font-mono text-sm text-primary">{adjusted.toFixed(2)} xG</span></div><Progress value={(1 - penalty) * 100} className="mt-3" /><p className="mt-2 text-xs text-muted-foreground">{Math.round((1 - penalty) * 100)}% attack retained · baseline {baseline.toFixed(2)}</p></div>;
}

function MiniMetric({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded-xl border border-white/7 bg-white/[.02] p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 font-mono text-lg text-primary">{value}</p></div>;
}

function LoadingState() { return <Card className="border-primary/12 bg-card/75"><CardContent className="flex min-h-72 items-center justify-center gap-3 text-sm text-muted-foreground"><LoaderCircle className="size-5 animate-spin text-primary" />Building the stored evidence comparison…</CardContent></Card>; }
function EmptyState() { return <Card className="border-amber-300/15 bg-card/75"><CardContent className="p-6"><p className="font-medium text-amber-100">No stored upcoming fixture is available.</p><p className="mt-2 text-sm text-muted-foreground">Choose another competition or refresh its current-season dataset from Overview.</p></CardContent></Card>; }
function ErrorState({ message }: { message?: string }) { return <Card className="border-amber-300/15 bg-card/75"><CardContent className="p-6"><p className="font-medium text-amber-100">Prediction evidence is unavailable.</p><p className="mt-2 text-sm text-muted-foreground">{message ?? 'The model did not return a forecast for this fixture.'}</p></CardContent></Card>; }

function explainEvidence(fixture: Fixture, prediction: Prediction, match: MatchAnalysis | null, home: TeamAnalysis | null, away: TeamAnalysis | null, scenario: Scenario, excluded: Set<string>) {
  const items: Array<{ label: string; direction: 'home' | 'away' | 'neutral'; copy: string }> = [];
  const eloGap = (prediction.evidence?.homeElo ?? 0) - (prediction.evidence?.awayElo ?? 0);
  items.push({ label: 'Team strength', direction: eloGap > 35 ? 'home' : eloGap < -35 ? 'away' : 'neutral', copy: `Pre-kickoff Elo is ${prediction.evidence?.homeElo ?? '—'} for ${fixture.home.name} and ${prediction.evidence?.awayElo ?? '—'} for ${fixture.away.name}. The ${Math.abs(eloGap).toFixed(0)}-point gap is ${Math.abs(eloGap) > 35 ? 'material to the baseline' : 'small enough to treat as broadly balanced'}.` });
  const homeWins = home?.form?.filter((game) => game.result === 'W').length ?? 0;
  const awayWins = away?.form?.filter((game) => game.result === 'W').length ?? 0;
  items.push({ label: 'Recent form', direction: homeWins > awayWins ? 'home' : awayWins > homeWins ? 'away' : 'neutral', copy: `${fixture.home.name} have ${homeWins} wins in the stored last six; ${fixture.away.name} have ${awayWins}. Form is descriptive and remains secondary to the full historical strength model.` });
  const meetings = match?.h2h ?? [];
  const homeH2hWins = meetings.filter((game) => winnerId(game) === fixture.home.id).length;
  const awayH2hWins = meetings.filter((game) => winnerId(game) === fixture.away.id).length;
  items.push({ label: 'Previous meetings', direction: homeH2hWins > awayH2hWins ? 'home' : awayH2hWins > homeH2hWins ? 'away' : 'neutral', copy: meetings.length ? `${fixture.home.name} won ${homeH2hWins}, ${fixture.away.name} won ${awayH2hWins}, and ${meetings.length - homeH2hWins - awayH2hWins} were drawn across ${meetings.length} stored meetings.` : 'No prior meeting is stored in the five-season window, so head-to-head evidence has no influence.' });
  const homeDrop = Math.round(scenario.homePenalty * 100);
  const awayDrop = Math.round(scenario.awayPenalty * 100);
  items.push({ label: 'Line-up scenario', direction: homeDrop > awayDrop ? 'away' : awayDrop > homeDrop ? 'home' : 'neutral', copy: excluded.size ? `${excluded.size} player selections reduce the home attacking input by ${homeDrop}% and the away input by ${awayDrop}% before the outcome grid is rerun.` : 'No player is removed, so the scenario matches the unadjusted expected-goals baseline.' });
  const market = match?.market ?? prediction.market;
  items.push({ label: 'Market benchmark', direction: 'neutral', copy: market ? `${market.bookmakers} bookmaker${market.bookmakers === 1 ? '' : 's'} imply ${market.probabilities.home.toFixed(1)}% home, ${market.probabilities.draw.toFixed(1)}% draw and ${market.probabilities.away.toFixed(1)}% away after removing the average margin.` : 'No complete stored 1X2 market is available for this fixture, so the model is not being benchmarked against a price.' });
  return items;
}

function providerBaseline(match: MatchAnalysis) {
  const excluded = new Set<string>();
  const evidence = match.playerEvidence ?? [];
  for (const injury of match.availability?.injuries ?? []) {
    const player = evidence.find((item) => item.teamId === injury.teamId && ((injury.playerId && item.playerId === injury.playerId) || normalize(item.name) === normalize(injury.playerName)));
    if (player) excluded.add(playerKey(player));
  }
  const lineups = match.availability?.lineups.length ? match.availability.lineups : match.lineups ?? [];
  for (const lineup of lineups) {
    if (!lineup.starters.length) continue;
    const starterIds = new Set(lineup.starters.map((player) => player.id).filter((id): id is number => id !== null));
    const starterNames = new Set(lineup.starters.map((player) => normalize(player.name)));
    for (const player of evidence.filter((item) => item.teamId === lineup.teamId).slice(0, 5)) {
      if (!starterIds.has(player.playerId) && !starterNames.has(normalize(player.name))) excluded.add(playerKey(player));
    }
  }
  return excluded;
}

function buildScenario(base: { home: number; away: number }, homePlayers: PlayerEvidence[], awayPlayers: PlayerEvidence[], excluded: Set<string>): Scenario {
  const penalty = (players: PlayerEvidence[]) => Math.min(0.3, players.filter((player) => excluded.has(playerKey(player))).reduce((sum, player) => sum + player.attackShare * 0.35, 0));
  const homePenalty = penalty(homePlayers);
  const awayPenalty = penalty(awayPlayers);
  const expectedGoals = { home: round(base.home * (1 - homePenalty), 3), away: round(base.away * (1 - awayPenalty), 3) };
  return { expectedGoals, ...poisson(expectedGoals.home, expectedGoals.away), homePenalty, awayPenalty };
}

function poisson(homeXg: number, awayXg: number) {
  let home = 0, draw = 0, away = 0, over25 = 0, btts = 0, mass = 0;
  for (let hg = 0; hg <= 8; hg++) for (let ag = 0; ag <= 8; ag++) {
    const probability = poissonMass(homeXg, hg) * poissonMass(awayXg, ag);
    mass += probability;
    if (hg > ag) home += probability; else if (hg === ag) draw += probability; else away += probability;
    if (hg + ag > 2) over25 += probability;
    if (hg > 0 && ag > 0) btts += probability;
  }
  return { probabilities: { home: percent(home / mass), draw: percent(draw / mass), away: percent(away / mass) }, over25: percent(over25 / mass), btts: percent(btts / mass) };
}

function poissonMass(lambda: number, goals: number) { return Math.exp(-lambda) * Math.pow(lambda, goals) / factorial(goals); }
function factorial(value: number) { let result = 1; for (let index = 2; index <= value; index++) result *= index; return result; }
function playerKey(player: Pick<PlayerEvidence, 'teamId' | 'playerId'>) { return `${player.teamId}:${player.playerId}`; }
function winnerId(meeting: Meeting) { return meeting.home_goals === meeting.away_goals ? null : meeting.home_goals > meeting.away_goals ? meeting.home_team_id : meeting.away_team_id; }
function normalize(value: string) { return value.trim().toLocaleLowerCase('en-GB'); }
function directionClass(direction: 'home' | 'away' | 'neutral') { return direction === 'neutral' ? 'text-muted-foreground' : direction === 'home' ? 'border-primary/20 text-primary' : 'border-sky-300/20 text-sky-200'; }
function percent(value: number) { return round(value * 100, 1); }
function round(value: number, places: number) { return Number(value.toFixed(places)); }
async function getJson<T>(url: string) { const response = await fetch(url); if (!response.ok) throw new Error(`Request failed with ${response.status}`); return await response.json() as T; }
function formatKickoff(value: string) { return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/London' }).format(new Date(value)); }
function formatDateTime(value: string) { return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/London' }).format(new Date(value)); }
function formatShortDate(value: string) { return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Europe/London' }).format(new Date(value)); }
