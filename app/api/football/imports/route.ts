import { ensureFootballSchema } from '@/db/football';

const STATUS_URL = 'https://v3.football.api-sports.io/status';
const QUOTA_CACHE_MS = 60_000;

type StoredSeason = {
  competition_id: number;
  season: number;
  name: string;
  country: string | null;
  logo: string | null;
  records: number;
  updated_at: string;
};

type SyncRun = {
  competition_id: number;
  season: number;
  status: string;
  records: number;
  error: string | null;
  started_at: string;
  finished_at: string | null;
};

type Quota = {
  current: number;
  limit: number;
  remaining: number;
  plan: string | null;
  active: boolean | null;
};

let quotaCache: { expiresAt: number; value: Quota | null } | null = null;

export async function GET() {
  try {
    const db = await ensureFootballSchema();
    const [storedResult, syncResult, quota] = await Promise.all([
      db.prepare(`
        SELECT c.id AS competition_id, c.season, c.name, c.country, c.logo,
          COUNT(f.id) AS records, MAX(f.updated_at) AS updated_at
        FROM competitions c
        LEFT JOIN fixtures f ON f.competition_id = c.id AND f.season = c.season
        GROUP BY c.id, c.season, c.name, c.country, c.logo
        ORDER BY c.id, c.season DESC
      `).all<StoredSeason>(),
      db.prepare(`
        SELECT competition_id, season, status, records, error, started_at, finished_at
        FROM sync_runs
        ORDER BY id DESC
      `).all<SyncRun>(),
      getQuota(),
    ]);

    const latestSync = new Map<string, SyncRun>();
    for (const run of syncResult.results) {
      const key = `${run.competition_id}:${run.season}`;
      if (!latestSync.has(key)) latestSync.set(key, run);
    }

    const seasons = storedResult.results.map((row) => {
      const sync = latestSync.get(`${row.competition_id}:${row.season}`);
      return {
        competitionId: row.competition_id,
        season: row.season,
        name: row.name,
        country: row.country,
        logo: row.logo,
        records: Number(row.records),
        lastUpdatedAt: row.updated_at,
        sync: sync ? {
          status: sync.status,
          records: sync.records,
          error: sync.error,
          startedAt: sync.started_at,
          finishedAt: sync.finished_at,
        } : null,
      };
    });
    const storedKeys = new Set(seasons.map((season) => `${season.competitionId}:${season.season}`));
    for (const [key, sync] of latestSync) {
      if (storedKeys.has(key)) continue;
      seasons.push({
        competitionId: sync.competition_id,
        season: sync.season,
        name: '',
        country: null,
        logo: null,
        records: 0,
        lastUpdatedAt: sync.finished_at ?? sync.started_at,
        sync: {
          status: sync.status,
          records: sync.records,
          error: sync.error,
          startedAt: sync.started_at,
          finishedAt: sync.finished_at,
        },
      });
    }

    return Response.json({
      connected: true,
      seasons,
      quota,
      summary: {
        records: seasons.reduce((sum, season) => sum + season.records, 0),
        storedSeasons: seasons.length,
        completedSeasons: seasons.filter((season) => season.sync?.status === 'complete').length,
        failedSeasons: seasons.filter((season) => season.sync?.status === 'failed').length,
      },
      checkedAt: new Date().toISOString(),
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({
      connected: false,
      error: error instanceof Error ? error.message : 'Import status could not be loaded.',
    }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}

async function getQuota(): Promise<Quota | null> {
  const now = Date.now();
  if (quotaCache && quotaCache.expiresAt > now) return quotaCache.value;
  const apiKey = process.env.API_FOOTBALL_KEY;
  if (!apiKey) return null;

  try {
    const response = await fetch(STATUS_URL, { headers: { 'x-apisports-key': apiKey } });
    if (!response.ok) return null;
    const payload = await response.json() as {
      response?: {
        subscription?: { plan?: string; active?: boolean | string };
        requests?: { current?: number; limit_day?: number };
      };
    };
    const current = Number(payload.response?.requests?.current ?? 0);
    const limit = Number(payload.response?.requests?.limit_day ?? 0);
    const activeValue = payload.response?.subscription?.active;
    const value = limit > 0 ? {
      current,
      limit,
      remaining: Math.max(0, limit - current),
      plan: payload.response?.subscription?.plan ?? null,
      active: typeof activeValue === 'boolean' ? activeValue : typeof activeValue === 'string' ? activeValue.toLowerCase() === 'true' : null,
    } : null;
    quotaCache = { expiresAt: now + QUOTA_CACHE_MS, value };
    return value;
  } catch {
    return null;
  }
}
