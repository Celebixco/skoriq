import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { count, eq, isNotNull } from "drizzle-orm";
import { loadConfig } from "@sports-data/config";
import {
  RawProviderPayloadRepository,
  SyncJobRepository,
  competitions,
  createDatabase,
  countries,
  footballMatchScores,
  footballStandings,
  matches,
  providerMappings,
  rawProviderPayloads,
  teams
} from "@sports-data/database";
import type { Database } from "@sports-data/database";
import { APIFootballComAdapter, buildProviderFetchResult } from "@sports-data/providers";
import type { ProviderAdapter, ProviderFetchResult, ProviderOperation, ProviderSport } from "@sports-data/providers";
import {
  NormalizerRegistry,
  ProviderIngestionService,
  RawPayloadProcessor,
  createPipelineNormalizers,
  createStaticNormalizerRepositories
} from "@sports-data/pipeline";
import type { ProviderIngestionResult } from "@sports-data/pipeline";
import type { RawPayloadProcessingJobPayload } from "@sports-data/queue";
import type { ProviderEntityType } from "@sports-data/shared";
import { checkDatabaseReadiness, formatDatabaseReadinessResult } from "./db-readiness.js";

const providerName = "apifootball-com";
export interface ManualLeagueReviewConfig {
  provider: typeof providerName;
  sport: "football";
  countryId: string;
  leagueId: string;
  countryName: string;
  leagueName: string;
  enabled: boolean;
  reviewed: boolean;
  dryRunAllowed: boolean;
  priority: "high" | "medium" | "low";
  notes: string;
}

export const manualLeagueConfigs = [
  {
    provider: providerName,
    sport: "football",
    countryId: "4",
    leagueId: "171",
    countryName: "Germany",
    leagueName: "2. Bundesliga",
    enabled: true,
    reviewed: true,
    dryRunAllowed: true,
    priority: "high",
    notes: "Reviewed APIFootball ingestion slice."
  },
  {
    provider: providerName,
    sport: "football",
    countryId: "4",
    leagueId: "175",
    countryName: "Germany",
    leagueName: "Bundesliga",
    enabled: true,
    reviewed: true,
    dryRunAllowed: true,
    priority: "high",
    notes: "Reviewed APIFootball ingestion slice."
  },
  {
    provider: providerName,
    sport: "football",
    countryId: "111",
    leagueId: "322",
    countryName: "Turkey",
    leagueName: "Süper Lig",
    enabled: true,
    reviewed: true,
    dryRunAllowed: true,
    priority: "high",
    notes: "Reviewed via teams/standings/events dry-run; 2 team names enriched from standings, 2 logos missing/non-fatal; execute allowed after this config change."
  },
  {
    provider: providerName,
    sport: "football",
    countryId: "44",
    leagueId: "152",
    countryName: "England",
    leagueName: "Premier League",
    enabled: true,
    reviewed: true,
    dryRunAllowed: true,
    priority: "high",
    notes: "Reviewed via teams/standings/events/scores dry-runs; teams/logos 20/20, standings 20/20, events/scores 10/10, unresolved 0; countries/leagues execute required before data execute."
  },
  {
    provider: providerName,
    sport: "football",
    countryId: "6",
    leagueId: "302",
    countryName: "Spain",
    leagueName: "La Liga",
    enabled: true,
    reviewed: true,
    dryRunAllowed: true,
    priority: "high",
    notes: "Reviewed via teams/standings/events/scores dry-runs; teams/logos 20/20, standings 20/20, upcoming events 10/10, recent finished events/scores 10/10, FT/HT scores 10/10, unresolved 0; countries/leagues execute required before data execute."
  },
  {
    provider: providerName,
    sport: "football",
    countryId: "5",
    leagueId: "207",
    countryName: "Italy",
    leagueName: "Serie A",
    enabled: true,
    reviewed: true,
    dryRunAllowed: true,
    priority: "high",
    notes:
      "Reviewed via teams/standings/events/scores dry-runs; teams/logos 20/20 with 19/20 logos and 1 standings-name enrichment, standings 20/20, recent finished events/scores 10/10 with FT/HT 10/10, upcoming events/scores 9/10 with one safely skipped live numeric status; countries/leagues execute required before data execute."
  },
  {
    provider: providerName,
    sport: "football",
    countryId: "3",
    leagueId: "168",
    countryName: "France",
    leagueName: "Ligue 1",
    enabled: true,
    reviewed: true,
    dryRunAllowed: true,
    priority: "high",
    notes:
      "Reviewed via teams/standings/events/scores dry-runs; teams/logos 18/18, standings 18/18, upcoming events 9/9, recent finished events/scores 9/9, FT/HT scores 9/9, unresolved 0; countries/leagues execute required before data execute."
  },
  {
    provider: providerName,
    sport: "football",
    countryId: "82",
    leagueId: "244",
    countryName: "Netherlands",
    leagueName: "Eredivisie",
    enabled: true,
    reviewed: true,
    dryRunAllowed: true,
    priority: "high",
    notes:
      "Reviewed via teams/standings/recent finished events evidence; teams 22/22, logos 21/22 with 1 missing non-fatal, 1 standings-name enrichment, standings 18/18, recent finished events/scores 8/8 with FT/HT 8/8, upcoming events/scores 10/11 with one safely skipped After Pen. non-standard status; After Pen. remains skipped unless explicit policy is added; countries/leagues execute required before data execute."
  }
] as const satisfies readonly ManualLeagueReviewConfig[];
const configuredCountryIds = Array.from(new Set(manualLeagueConfigs.map((league) => league.countryId))).sort();
const configuredLeagueIds = manualLeagueConfigs.map((league) => league.leagueId);
export const manualIngestionMaxDateRangeDays = 7;

export const manualOperations = ["countries", "leagues", "teams", "events", "scores", "standings"] as const;
export type ManualOperation = (typeof manualOperations)[number];

export interface ManualIngestionOptions {
  execute: boolean;
  verifyAfter: boolean;
  reportJson: boolean;
  operations: ManualOperation[];
  countryId?: string;
  leagueId?: string;
  from?: string;
  to?: string;
}

export interface ManualIngestionEnvironment {
  NODE_ENV?: string;
  DATABASE_URL?: string;
  APIFOOTBALL_COM_ENABLED?: string;
  APIFOOTBALL_COM_API_KEY?: string;
  APIFOOTBALL_COM_API_KEY_DEFAULT?: string;
  APIFOOTBALL_COM_API_KEY_COUNTRIES?: string;
  APIFOOTBALL_COM_API_KEY_LEAGUES?: string;
  APIFOOTBALL_COM_API_KEY_TEAMS?: string;
  APIFOOTBALL_COM_API_KEY_STANDINGS?: string;
  APIFOOTBALL_COM_API_KEY_EVENTS?: string;
  APIFOOTBALL_COM_API_KEY_RESULTS?: string;
  APIFOOTBALL_COM_API_KEY_FIXTURES?: string;
  APIFOOTBALL_COM_API_KEY_PLAYERS?: string;
  APIFOOTBALL_COM_API_KEY_STATISTICS?: string;
  APIFOOTBALL_COM_API_KEY_LINEUPS?: string;
  APIFOOTBALL_COM_API_KEY_INJURIES?: string;
}

export interface ManualFetchRequest {
  operation: ProviderOperation;
  entityType: ProviderEntityType;
  params: Record<string, unknown>;
}

export interface ManualOperationSummary {
  operation: ManualOperation | "sport_prerequisite";
  entityType: ProviderEntityType;
  providerOperation: ProviderOperation | "manual_prerequisite";
  fetchedCount: number;
  mappedCount: number;
  unresolvedRowsCount: number;
  teamsWithLogoCount?: number;
  teamsMissingLogoCount?: number;
  enrichedTeamNamesCount?: number;
  enrichedFrom?: "standings";
  rawPayloadId?: string;
  processingStatus?: string;
  normalizationStatus?: string;
}

export interface ManualIngestionRunResult {
  mode: "dry-run" | "execute";
  operations: ManualOperationSummary[];
  totals: {
    countriesCount: number;
    leaguesCount: number;
    teamsCount: number;
    teamsWithLogoCount: number;
    eventsCount: number;
    eventsWithStableHomeAwayIdsCount: number;
    scoresCount: number;
    standingsCount: number;
    unresolvedRowsCount: number;
  };
  notes: string[];
  postRunVerification?: ManualPostRunVerificationReport;
  ingestionRunReport: ManualIngestionRunReportSummary;
}

export interface ManualIngestionDependencies {
  fetchProviderResult(request: ManualFetchRequest): Promise<ProviderFetchResult<unknown>>;
  ingestProviderResult?(request: { entityType: ProviderEntityType; result: ProviderFetchResult<unknown> }): Promise<ProviderIngestionResult>;
  processRawPayload?(payload: RawPayloadProcessingJobPayload): Promise<{ status: string; normalizationStatus?: string }>;
  queryPostRunVerificationCounts?(): Promise<ManualPostRunVerificationCounts>;
  persistRunReport?(report: ManualIngestionRunReportSummary): Promise<void>;
  log?(message: string): void;
}

export interface ManualPostRunVerificationCounts {
  countriesCount: number;
  competitionsCount: number;
  teamsCount: number;
  teamsWithLogoUrlCount: number;
  matchesCount: number;
  footballMatchScoresCount: number;
  footballStandingsCount: number;
  providerMappingsCount: number;
  rawProviderPayloadsByProcessingStatus: Array<{ status: string; count: number }>;
  failedRawPayloadCount: number;
}

export interface ManualPostRunVerificationReport extends ManualPostRunVerificationCounts {
  teamLogoCoveragePercentage: number;
  unresolvedSkippedRowsCount: number;
  canonicalCountsChangedUnexpectedly?: boolean;
}

export interface ManualIngestionRunReportSummary {
  provider: typeof providerName;
  mode: "dry-run" | "execute";
  country_id?: string;
  league_id?: string;
  league_name?: string;
  from?: string;
  to?: string;
  operations: ManualOperation[];
  countries_count: number;
  leagues_count: number;
  teams_count: number;
  teams_with_logos_count: number;
  team_logo_coverage_percentage: number;
  events_count: number;
  stable_events_count: number;
  scores_count: number;
  standings_count: number;
  unresolved_skipped_rows_count: number;
  raw_payload_status_distribution?: Array<{ status: string; count: number }>;
  failed_raw_payload_count?: number;
  provider_mappings_count?: number;
  canonical_counts?: {
    countries: number;
    competitions: number;
    teams: number;
    teams_with_logo_url: number;
    matches: number;
    football_match_scores: number;
    football_standings: number;
  };
  started_at: string;
  finished_at: string;
  duration_ms: number;
  result: "success" | "partial" | "failed";
  warnings: string[];
  safe_sanitized_command_context: {
    provider: typeof providerName;
    mode: "dry-run" | "execute";
    country_id?: string;
    league_id?: string;
    league_name?: string;
    from?: string;
    to?: string;
    operations: ManualOperation[];
    execute: boolean;
    verify_after: boolean;
    report_json: boolean;
  };
}

interface OperationPlanItem {
  manualOperation: ManualOperation;
  providerOperation: ProviderOperation;
  entityType: ProviderEntityType;
  params: Record<string, unknown>;
}

interface DependencyFilterState {
  teamProviderIds: Set<string>;
  matchProviderIds: Set<string>;
}

export function parseManualIngestionArgs(argv: string[]): ManualIngestionOptions {
  const options: ManualIngestionOptions = {
    execute: false,
    verifyAfter: false,
    reportJson: false,
    operations: [...manualOperations]
  };

  for (const arg of argv) {
    if (arg === "--execute") {
      options.execute = true;
      continue;
    }

    if (arg === "--verify-after") {
      options.verifyAfter = true;
      continue;
    }

    if (arg === "--report-json") {
      options.reportJson = true;
      continue;
    }

    const [key, value] = parseFlag(arg);
    switch (key) {
      case "--operations":
        options.operations = parseOperations(value);
        break;
      case "--country-id":
        options.countryId = requiredFlagValue(key, value);
        break;
      case "--league-id":
        options.leagueId = requiredFlagValue(key, value);
        break;
      case "--from":
        options.from = requiredFlagValue(key, value);
        break;
      case "--to":
        options.to = requiredFlagValue(key, value);
        break;
      default:
        throw new Error(`Unknown APIFootball.com manual ingestion flag "${key}".`);
    }
  }

  return options;
}

export function validateManualIngestionOptions(options: ManualIngestionOptions, env: ManualIngestionEnvironment) {
  if (env.NODE_ENV === "production") {
    throw new Error("APIFootball.com manual ingestion is forbidden in production.");
  }

  if (env.APIFOOTBALL_COM_ENABLED !== "true") {
    throw new Error("APIFootball.com manual ingestion requires APIFOOTBALL_COM_ENABLED=true.");
  }

  if (!hasAnyAPIFootballCredential(env)) {
    throw new Error("At least one APIFOOTBALL_COM_API_KEY* value is required for APIFootball.com manual ingestion.");
  }

  if (!options.countryId) {
    throw new Error(`APIFootball.com manual ingestion requires one configured --country-id (${configuredCountryIds.join(", ")}).`);
  }

  if (requiresLeagueId(options.operations) && !options.leagueId) {
    throw new Error(`APIFootball.com manual ingestion requires one configured --league-id (${configuredLeagueIds.join(", ")}) for leagues, teams, events, scores, and standings.`);
  }

  validateManualLeagueAccess(options);

  if (requiresDateRange(options.operations)) {
    if (!options.from || !options.to) {
      throw new Error("APIFootball.com manual ingestion requires --from and --to for events and scores.");
    }

    assertNarrowDateRange(options.from, options.to);
  }
}

export function validateManualLeagueAccess(options: ManualIngestionOptions, configs: readonly ManualLeagueReviewConfig[] = manualLeagueConfigs) {
  const leagueConfig = resolveManualLeagueConfig(options.countryId, options.leagueId, configs);
  if (!leagueConfig) {
    throw new Error("APIFootball.com manual ingestion is limited to configured reviewed leagues and review candidates.");
  }

  if (options.execute && (!leagueConfig.reviewed || !leagueConfig.enabled)) {
    throw new Error("APIFootball.com execute is limited to reviewed and enabled leagues.");
  }

  if (!options.execute && !leagueConfig.dryRunAllowed) {
    throw new Error("APIFootball.com dry-run is limited to reviewed/enabled leagues or review candidates with dryRunAllowed=true.");
  }
}

export async function runManualAPIFootballComIngestion(
  options: ManualIngestionOptions,
  dependencies: ManualIngestionDependencies
): Promise<ManualIngestionRunResult> {
  const startedAt = new Date();
  const plans = buildOperationPlan(options);
  const summaries: ManualOperationSummary[] = [];
  const shouldVerifyAfter = options.execute || options.verifyAfter;
  const beforeVerification = shouldVerifyAfter ? await dependencies.queryPostRunVerificationCounts?.() : undefined;
  const dependencyState: DependencyFilterState = {
    teamProviderIds: new Set(),
    matchProviderIds: new Set()
  };
  const notes = [
    "APIFootball.com manual ingestion is local/manual only.",
    "Season provider IDs are not supplied by this provider slice; matches and football standings are ingested with nullable season_id."
  ];

  if (options.execute) {
    summaries.push(await ingestAndMaybeProcess(buildFootballSportResult(), "sport", "sport_prerequisite", "manual_prerequisite", dependencies));
  }

  for (const plan of plans) {
    const result = await dependencies.fetchProviderResult({
      operation: plan.providerOperation,
      entityType: plan.entityType,
      params: plan.params
    });
    const enriched = await enrichTeamNamesFromStandingsIfNeeded(narrowReviewedSlice(result, plan.manualOperation, options), plan, options, dependencies, notes);
    const narrowed = applyDependencyFilter(enriched, plan.manualOperation, dependencyState, notes);
    const summary = summarizeOperation(plan, narrowed);
    updateDependencyState(plan.manualOperation, narrowed, dependencyState);

    if (options.execute) {
      const ingestionSummary = await ingestAndMaybeProcess(narrowed, plan.entityType, plan.manualOperation, plan.providerOperation, dependencies);
      summaries.push({ ...summary, ...pickExecutionFields(ingestionSummary) });
    } else {
      summaries.push(summary);
    }
  }

  const totals = summarizeTotals(summaries);
  const afterVerification = shouldVerifyAfter ? await dependencies.queryPostRunVerificationCounts?.() : undefined;
  const finishedAt = new Date();
  const postRunVerification = afterVerification ? buildPostRunVerificationReport(afterVerification, totals.unresolvedRowsCount, beforeVerification) : undefined;
  const ingestionRunReport = buildIngestionRunReport(options, summaries, totals, notes, startedAt, finishedAt, postRunVerification);
  const output: ManualIngestionRunResult = {
    mode: options.execute ? "execute" : "dry-run",
    operations: summaries,
    totals,
    notes,
    postRunVerification,
    ingestionRunReport
  };

  if (options.reportJson) {
    await dependencies.persistRunReport?.(ingestionRunReport);
  }

  dependencies.log?.(formatRunResult(output));
  return output;
}

export function buildOperationPlan(options: ManualIngestionOptions): OperationPlanItem[] {
  return options.operations.map((operation) => {
    switch (operation) {
      case "countries":
        return {
          manualOperation: operation,
          providerOperation: "list_countries",
          entityType: "country",
          params: {}
        };
      case "leagues":
        return {
          manualOperation: operation,
          providerOperation: "list_competitions",
          entityType: "competition",
          params: { country_id: options.countryId }
        };
      case "teams":
        return {
          manualOperation: operation,
          providerOperation: "list_teams",
          entityType: "team",
          params: { league_id: options.leagueId }
        };
      case "events":
        return {
          manualOperation: operation,
          providerOperation: "list_finished_matches",
          entityType: "match",
          params: { country_id: options.countryId, league_id: options.leagueId, from: options.from, to: options.to }
        };
      case "scores":
        return {
          manualOperation: operation,
          providerOperation: "get_football_match_score",
          entityType: "football_match_score",
          params: { country_id: options.countryId, league_id: options.leagueId, from: options.from, to: options.to }
        };
      case "standings":
        return {
          manualOperation: operation,
          providerOperation: "get_football_standings",
          entityType: "football_standing",
          params: { league_id: options.leagueId }
        };
    }
  });
}

function parseFlag(arg: string): [string, string | undefined] {
  const index = arg.indexOf("=");
  return index === -1 ? [arg, undefined] : [arg.slice(0, index), arg.slice(index + 1)];
}

function requiredFlagValue(flag: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Flag ${flag} requires a value.`);
  }

  return value;
}

function parseOperations(value: string | undefined): ManualOperation[] {
  const raw = requiredFlagValue("--operations", value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  if (raw.length === 0) {
    throw new Error("--operations must include at least one operation.");
  }

  for (const operation of raw) {
    if (!manualOperations.includes(operation as ManualOperation)) {
      throw new Error(`Unsupported APIFootball.com manual ingestion operation "${operation}".`);
    }
  }

  return raw as ManualOperation[];
}

function requiresLeagueId(operations: ManualOperation[]) {
  return operations.some((operation) => operation !== "countries");
}

function requiresDateRange(operations: ManualOperation[]) {
  return operations.some((operation) => operation === "events" || operation === "scores");
}

function assertNarrowDateRange(from: string, to: string) {
  const fromDate = parseDateOnly(from, "--from");
  const toDate = parseDateOnly(to, "--to");
  const days = Math.floor((toDate.getTime() - fromDate.getTime()) / 86_400_000) + 1;

  if (days <= 0) {
    throw new Error("APIFootball.com manual ingestion requires --to to be on or after --from.");
  }

  if (days > manualIngestionMaxDateRangeDays) {
    throw new Error(`APIFootball.com manual ingestion date range must be ${manualIngestionMaxDateRangeDays} days or fewer.`);
  }
}

function parseDateOnly(value: string, flag: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`APIFootball.com manual ingestion requires ${flag}=YYYY-MM-DD.`);
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`APIFootball.com manual ingestion received invalid ${flag} date.`);
  }

  return date;
}

function buildFootballSportResult(): ProviderFetchResult<ProviderSport[]> {
  return buildProviderFetchResult({
    context: {
      provider: providerName,
      operation: "list_sports",
      sport: "football",
      entityType: "sport",
      params: { source: "manual_apifootball_prerequisite" }
    },
    data: [
      {
        providerEntityId: "football",
        name: "Football",
        slug: "football",
        metadata: {
          source: providerName,
          manualPrerequisite: true
        }
      }
    ],
    fetchedAt: new Date().toISOString()
  });
}

function narrowReviewedSlice(result: ProviderFetchResult<unknown>, operation: ManualOperation, options: ManualIngestionOptions): ProviderFetchResult<unknown> {
  if (operation !== "countries" && operation !== "leagues") {
    return result;
  }

  const data = asArray(result.data).filter((item) => {
    const record = asObject(item);
    return operation === "countries" ? record.providerEntityId === options.countryId : record.providerEntityId === options.leagueId;
  });
  const rawPayload = asArray(result.rawPayload ?? result.data).filter((item) => {
    const record = asObject(item);
    return operation === "countries" ? (record.country_id ?? record.providerEntityId) === options.countryId : (record.league_id ?? record.providerEntityId) === options.leagueId;
  });

  return {
    ...result,
    data,
    rawPayload,
    metadata: {
      ...result.metadata,
      requestParams: {
        ...result.metadata.requestParams,
        reviewedCountryId: options.countryId,
        reviewedLeagueId: operation === "leagues" ? options.leagueId : undefined
      },
      requestParamsHashInput: {
        ...asObject(result.metadata.requestParamsHashInput),
        reviewedCountryId: options.countryId,
        reviewedLeagueId: operation === "leagues" ? options.leagueId : undefined
      }
    }
  };
}

async function enrichTeamNamesFromStandingsIfNeeded(
  result: ProviderFetchResult<unknown>,
  plan: OperationPlanItem,
  options: ManualIngestionOptions,
  dependencies: ManualIngestionDependencies,
  notes: string[]
): Promise<ProviderFetchResult<unknown>> {
  if (plan.manualOperation !== "teams" || !options.leagueId) {
    return result;
  }

  const rawRows = asArray(result.rawPayload ?? result.data);
  const dataRows = asArray(result.data);
  const mappedTeamIds = new Set(dataRows.map((item) => asString(asObject(item).providerEntityId)).filter(Boolean));
  const missingNameRows = rawRows.filter((item) => {
    const record = asObject(item);
    const teamId = asString(record.team_key ?? record.team_id ?? record.providerEntityId);
    const teamName = asString(record.team_name ?? record.name);
    return Boolean(teamId && !teamName && !mappedTeamIds.has(teamId));
  });

  if (missingNameRows.length === 0) {
    return result;
  }

  const standings = await dependencies.fetchProviderResult({
    operation: "get_football_standings",
    entityType: "football_standing",
    params: { league_id: options.leagueId }
  });
  const standingsByTeamId = new Map<string, string>();
  for (const row of asArray(standings.rawPayload ?? standings.data)) {
    const record = asObject(row);
    const teamId = asString(record.team_id ?? record.teamProviderId);
    const teamName = asString(record.team_name ?? asObject(record.metadata).teamName);
    if (teamId && teamName) {
      standingsByTeamId.set(teamId, teamName);
    }
  }

  const enrichedRows: unknown[] = [];
  for (const row of missingNameRows) {
    const record = asObject(row);
    const teamId = asString(record.team_key ?? record.team_id ?? record.providerEntityId);
    const fallbackName = teamId ? standingsByTeamId.get(teamId) : undefined;
    if (!teamId || !fallbackName) {
      continue;
    }

    enrichedRows.push({
      providerEntityId: teamId,
      sportProviderId: "football",
      countryProviderId: asString(record.country_id) ?? options.countryId,
      name: fallbackName,
      venueName: asString(record.venue_name ?? record.team_venue),
      foundedYear: parseOptionalNumber(record.founded_year ?? record.founded ?? record.team_founded),
      metadata: {
        source: providerName,
        logoMissing: true,
        nameEnrichedFrom: "standings",
        nameEnrichmentLeagueId: options.leagueId
      },
      raw: record
    });
  }

  if (enrichedRows.length === 0) {
    return result;
  }

  notes.push(`Enriched ${enrichedRows.length} APIFootball.com team name(s) from exact team_id standings matches; logo fallback was not applied.`);

  return {
    ...result,
    data: [...dataRows, ...enrichedRows],
    metadata: {
      ...result.metadata,
      enrichedTeamNamesCount: enrichedRows.length,
      enrichedFrom: "standings"
    }
  };
}

function applyDependencyFilter(
  result: ProviderFetchResult<unknown>,
  operation: ManualOperation,
  state: DependencyFilterState,
  notes: string[]
): ProviderFetchResult<unknown> {
  if (state.teamProviderIds.size === 0 && state.matchProviderIds.size === 0) {
    return result;
  }

  const dataRows = asArray(result.data);
  const filteredRows = dataRows.filter((item) => {
    const record = asObject(item);

    if (operation === "events" && state.teamProviderIds.size > 0) {
      return hasKnownProviderId(state.teamProviderIds, record.homeTeamProviderId) && hasKnownProviderId(state.teamProviderIds, record.awayTeamProviderId);
    }

    if (operation === "scores" && state.matchProviderIds.size > 0) {
      return hasKnownProviderId(state.matchProviderIds, record.matchProviderId);
    }

    if (operation === "standings" && state.teamProviderIds.size > 0) {
      return hasKnownProviderId(state.teamProviderIds, record.teamProviderId);
    }

    return true;
  });

  const skipped = dataRows.length - filteredRows.length;
  if (skipped === 0) {
    return result;
  }

  notes.push(`Skipped ${skipped} ${operation} row(s) because required reviewed-slice provider mappings were not available.`);

  return {
    ...result,
    data: filteredRows
  };
}

function updateDependencyState(operation: ManualOperation, result: ProviderFetchResult<unknown>, state: DependencyFilterState) {
  const rows = asArray(result.data);

  if (operation === "teams") {
    for (const row of rows) {
      const providerEntityId = asString(asObject(row).providerEntityId);
      if (providerEntityId) {
        state.teamProviderIds.add(providerEntityId);
      }
    }
  }

  if (operation === "events") {
    for (const row of rows) {
      const providerEntityId = asString(asObject(row).providerEntityId);
      if (providerEntityId) {
        state.matchProviderIds.add(providerEntityId);
      }
    }
  }
}

function hasKnownProviderId(knownIds: Set<string>, value: unknown) {
  const providerId = asString(value);
  return Boolean(providerId && knownIds.has(providerId));
}

function withoutRawPayload(result: ProviderFetchResult<unknown>): ProviderFetchResult<unknown> {
  return {
    data: result.data,
    metadata: result.metadata
  };
}

function summarizeOperation(plan: OperationPlanItem, result: ProviderFetchResult<unknown>): ManualOperationSummary {
  const dataRows = asArray(result.data);
  const rawRows = asArray(result.rawPayload ?? result.data);
  const enrichedTeamNamesCount = Number(asObject(result.metadata).enrichedTeamNamesCount ?? 0);
  const unresolvedRowsCount = Math.max(0, countUnresolvedRows(plan.manualOperation, dataRows, rawRows) - enrichedTeamNamesCount);
  const teamsWithLogoCount = plan.manualOperation === "teams" ? dataRows.filter((item) => Boolean(asObject(item).logoUrl)).length : undefined;

  return {
    operation: plan.manualOperation,
    entityType: plan.entityType,
    providerOperation: plan.providerOperation,
    fetchedCount: rawRows.length,
    mappedCount: dataRows.length,
    unresolvedRowsCount,
    teamsWithLogoCount,
    teamsMissingLogoCount: plan.manualOperation === "teams" ? dataRows.length - (teamsWithLogoCount ?? 0) : undefined,
    enrichedTeamNamesCount: plan.manualOperation === "teams" ? enrichedTeamNamesCount : undefined,
    enrichedFrom: plan.manualOperation === "teams" && enrichedTeamNamesCount > 0 ? "standings" : undefined
  };
}

function countUnresolvedRows(operation: ManualOperation, dataRows: unknown[], rawRows: unknown[]): number {
  if (operation === "teams") {
    const malformedTeams = rawRows.filter((item) => {
      const record = asObject(item);
      return !(record.team_key || record.team_id || record.providerEntityId) || !(record.team_name || record.name);
    }).length;
    return Math.max(malformedTeams, rawRows.length - dataRows.length);
  }

  return Math.max(0, rawRows.length - dataRows.length);
}

async function ingestAndMaybeProcess(
  result: ProviderFetchResult<unknown>,
  entityType: ProviderEntityType,
  operation: ManualOperationSummary["operation"],
  providerOperation: ManualOperationSummary["providerOperation"],
  dependencies: ManualIngestionDependencies
): Promise<ManualOperationSummary> {
  if (!dependencies.ingestProviderResult) {
    throw new Error("Execute mode requires ProviderIngestionService.");
  }

  const ingestion = await dependencies.ingestProviderResult({ entityType, result: withoutRawPayload(result) });
  let processingStatus: string | undefined;
  let normalizationStatus: string | undefined;

  if (dependencies.processRawPayload) {
    const processed = await dependencies.processRawPayload({
      rawPayloadId: ingestion.rawPayloadId,
      entityType
    });
    processingStatus = processed.status;
    normalizationStatus = processed.normalizationStatus;
  }

  return {
    operation,
    entityType,
    providerOperation,
    fetchedCount: asArray(result.data).length,
    mappedCount: asArray(result.data).length,
    unresolvedRowsCount: 0,
    rawPayloadId: ingestion.rawPayloadId,
    processingStatus,
    normalizationStatus
  };
}

function pickExecutionFields(summary: ManualOperationSummary) {
  return {
    rawPayloadId: summary.rawPayloadId,
    processingStatus: summary.processingStatus,
    normalizationStatus: summary.normalizationStatus
  };
}

function summarizeTotals(summaries: ManualOperationSummary[]): ManualIngestionRunResult["totals"] {
  const byOperation = new Map(summaries.map((summary) => [summary.operation, summary]));
  const events = byOperation.get("events");

  return {
    countriesCount: byOperation.get("countries")?.mappedCount ?? 0,
    leaguesCount: byOperation.get("leagues")?.mappedCount ?? 0,
    teamsCount: byOperation.get("teams")?.mappedCount ?? 0,
    teamsWithLogoCount: byOperation.get("teams")?.teamsWithLogoCount ?? 0,
    eventsCount: events?.mappedCount ?? 0,
    eventsWithStableHomeAwayIdsCount: events ? events.mappedCount : 0,
    scoresCount: byOperation.get("scores")?.mappedCount ?? 0,
    standingsCount: byOperation.get("standings")?.mappedCount ?? 0,
    unresolvedRowsCount: summaries.reduce((total, summary) => total + summary.unresolvedRowsCount, 0)
  };
}

function buildPostRunVerificationReport(
  afterCounts: ManualPostRunVerificationCounts,
  unresolvedSkippedRowsCount: number,
  beforeCounts?: ManualPostRunVerificationCounts
): ManualPostRunVerificationReport {
  return {
    ...afterCounts,
    teamLogoCoveragePercentage: calculatePercentage(afterCounts.teamsWithLogoUrlCount, afterCounts.teamsCount),
    unresolvedSkippedRowsCount,
    canonicalCountsChangedUnexpectedly: beforeCounts ? canonicalCountsChangedUnexpectedly(beforeCounts, afterCounts) : undefined
  };
}

function buildIngestionRunReport(
  options: ManualIngestionOptions,
  summaries: ManualOperationSummary[],
  totals: ManualIngestionRunResult["totals"],
  notes: string[],
  startedAt: Date,
  finishedAt: Date,
  postRunVerification?: ManualPostRunVerificationReport
): ManualIngestionRunReportSummary {
  const mode = options.execute ? "execute" : "dry-run";
  const warnings = buildRunWarnings(summaries, totals, notes, postRunVerification);

  return {
    provider: providerName,
    mode,
    country_id: options.countryId,
    league_id: options.leagueId,
    league_name: lookupConfiguredLeagueName(options.countryId, options.leagueId),
    from: options.from,
    to: options.to,
    operations: options.operations,
    countries_count: totals.countriesCount,
    leagues_count: totals.leaguesCount,
    teams_count: totals.teamsCount,
    teams_with_logos_count: totals.teamsWithLogoCount,
    team_logo_coverage_percentage: calculatePercentage(totals.teamsWithLogoCount, totals.teamsCount),
    events_count: totals.eventsCount,
    stable_events_count: totals.eventsWithStableHomeAwayIdsCount,
    scores_count: totals.scoresCount,
    standings_count: totals.standingsCount,
    unresolved_skipped_rows_count: totals.unresolvedRowsCount,
    raw_payload_status_distribution: postRunVerification?.rawProviderPayloadsByProcessingStatus,
    failed_raw_payload_count: postRunVerification?.failedRawPayloadCount,
    provider_mappings_count: postRunVerification?.providerMappingsCount,
    canonical_counts: postRunVerification
      ? {
          countries: postRunVerification.countriesCount,
          competitions: postRunVerification.competitionsCount,
          teams: postRunVerification.teamsCount,
          teams_with_logo_url: postRunVerification.teamsWithLogoUrlCount,
          matches: postRunVerification.matchesCount,
          football_match_scores: postRunVerification.footballMatchScoresCount,
          football_standings: postRunVerification.footballStandingsCount
        }
      : undefined,
    started_at: startedAt.toISOString(),
    finished_at: finishedAt.toISOString(),
    duration_ms: finishedAt.getTime() - startedAt.getTime(),
    result: calculateRunResult(summaries, totals, postRunVerification),
    warnings,
    safe_sanitized_command_context: {
      provider: providerName,
      mode,
      country_id: options.countryId,
      league_id: options.leagueId,
      league_name: lookupConfiguredLeagueName(options.countryId, options.leagueId),
      from: options.from,
      to: options.to,
      operations: options.operations,
      execute: options.execute,
      verify_after: options.verifyAfter,
      report_json: options.reportJson
    }
  };
}

function calculateRunResult(
  summaries: ManualOperationSummary[],
  totals: ManualIngestionRunResult["totals"],
  postRunVerification?: ManualPostRunVerificationReport
): ManualIngestionRunReportSummary["result"] {
  if (summaries.some((summary) => summary.processingStatus === "failed" || summary.normalizationStatus === "failed")) {
    return "failed";
  }
  if (postRunVerification?.canonicalCountsChangedUnexpectedly) {
    return "failed";
  }
  return totals.unresolvedRowsCount > 0 ? "partial" : "success";
}

function buildRunWarnings(
  summaries: ManualOperationSummary[],
  totals: ManualIngestionRunResult["totals"],
  notes: string[],
  postRunVerification?: ManualPostRunVerificationReport
) {
  const warnings = [...notes];
  if (totals.unresolvedRowsCount > 0) {
    warnings.push(`Current run reported ${totals.unresolvedRowsCount} unresolved/skipped row(s).`);
  }
  if (postRunVerification && postRunVerification.failedRawPayloadCount > 0) {
    warnings.push(`Database currently has ${postRunVerification.failedRawPayloadCount} failed raw payload(s); manual ingestion does not clean them up.`);
  }
  if (summaries.some((summary) => summary.processingStatus === "failed" || summary.normalizationStatus === "failed")) {
    warnings.push("One or more current-run raw payloads failed processing.");
  }
  if (postRunVerification?.canonicalCountsChangedUnexpectedly) {
    warnings.push("Post-run verification detected an unexpected canonical count decrease.");
  }
  return warnings;
}

export function resolveManualLeagueConfig(countryId?: string, leagueId?: string, configs: readonly ManualLeagueReviewConfig[] = manualLeagueConfigs): ManualLeagueReviewConfig | undefined {
  if (leagueId) {
    return configs.find((league) => league.countryId === countryId && league.leagueId === leagueId);
  }

  return configs.find((league) => league.countryId === countryId);
}

function lookupConfiguredLeagueName(countryId?: string, leagueId?: string) {
  return resolveManualLeagueConfig(countryId, leagueId)?.leagueName;
}

function calculatePercentage(part: number, total: number) {
  return total === 0 ? 0 : Number(((part / total) * 100).toFixed(2));
}

function canonicalCountsChangedUnexpectedly(beforeCounts: ManualPostRunVerificationCounts, afterCounts: ManualPostRunVerificationCounts) {
  const before = canonicalCountVector(beforeCounts);
  const after = canonicalCountVector(afterCounts);
  return Object.keys(before).some((key) => after[key] < before[key]);
}

function canonicalCountVector(counts: ManualPostRunVerificationCounts): Record<string, number> {
  return {
    countriesCount: counts.countriesCount,
    competitionsCount: counts.competitionsCount,
    teamsCount: counts.teamsCount,
    teamsWithLogoUrlCount: counts.teamsWithLogoUrlCount,
    matchesCount: counts.matchesCount,
    footballMatchScoresCount: counts.footballMatchScoresCount,
    footballStandingsCount: counts.footballStandingsCount,
    providerMappingsCount: counts.providerMappingsCount
  };
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function parseOptionalNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function formatRunResult(result: ManualIngestionRunResult): string {
  return JSON.stringify(result, null, 2);
}

async function main() {
  const options = parseManualIngestionArgs(process.argv.slice(2));
  const config = loadConfig();
  validateManualIngestionOptions(options, process.env);

  if (options.execute || options.verifyAfter) {
    const readiness = await checkDatabaseReadiness({
      databaseUrl: config.DATABASE_URL,
      nodeEnv: config.NODE_ENV,
      dbExecutionTarget: config.DB_EXECUTION_TARGET,
      allowRemoteTestDb: config.ALLOW_REMOTE_TEST_DB,
      neonBranchName: config.NEON_BRANCH_NAME
    });
    if (readiness.status !== "ready") {
      throw new Error(`Database readiness check failed before provider fetch.\n${formatDatabaseReadinessResult(readiness)}`);
    }
  }

  const adapter = new APIFootballComAdapter({
    enabled: config.APIFOOTBALL_COM_ENABLED,
    apiKey: config.APIFOOTBALL_COM_API_KEY,
    apiKeys: {
      defaultApiKey: config.APIFOOTBALL_COM_API_KEY_DEFAULT,
      countriesApiKey: config.APIFOOTBALL_COM_API_KEY_COUNTRIES,
      leaguesApiKey: config.APIFOOTBALL_COM_API_KEY_LEAGUES,
      teamsApiKey: config.APIFOOTBALL_COM_API_KEY_TEAMS,
      standingsApiKey: config.APIFOOTBALL_COM_API_KEY_STANDINGS,
      eventsApiKey: config.APIFOOTBALL_COM_API_KEY_EVENTS,
      resultsApiKey: config.APIFOOTBALL_COM_API_KEY_RESULTS,
      fixturesApiKey: config.APIFOOTBALL_COM_API_KEY_FIXTURES,
      playersApiKey: config.APIFOOTBALL_COM_API_KEY_PLAYERS,
      statisticsApiKey: config.APIFOOTBALL_COM_API_KEY_STATISTICS,
      lineupsApiKey: config.APIFOOTBALL_COM_API_KEY_LINEUPS,
      injuriesApiKey: config.APIFOOTBALL_COM_API_KEY_INJURIES
    },
    baseUrl: config.APIFOOTBALL_COM_BASE_URL,
    timeoutMs: config.APIFOOTBALL_COM_TIMEOUT_MS,
    environment: { nodeEnv: config.NODE_ENV }
  });

  const dependencies = options.execute
    ? createExecuteDependencies(config, adapter)
    : createDryRunDependencies(adapter, options.verifyAfter ? createPostRunVerificationQuery(createDatabase(config.DATABASE_URL)) : undefined);

  try {
    await runManualAPIFootballComIngestion(options, dependencies);
  } finally {
    await closeDependencies(dependencies);
  }
}

function hasAnyAPIFootballCredential(env: ManualIngestionEnvironment) {
  return Boolean(
    env.APIFOOTBALL_COM_API_KEY ||
      env.APIFOOTBALL_COM_API_KEY_DEFAULT ||
      env.APIFOOTBALL_COM_API_KEY_COUNTRIES ||
      env.APIFOOTBALL_COM_API_KEY_LEAGUES ||
      env.APIFOOTBALL_COM_API_KEY_TEAMS ||
      env.APIFOOTBALL_COM_API_KEY_STANDINGS ||
      env.APIFOOTBALL_COM_API_KEY_EVENTS ||
      env.APIFOOTBALL_COM_API_KEY_RESULTS ||
      env.APIFOOTBALL_COM_API_KEY_FIXTURES ||
      env.APIFOOTBALL_COM_API_KEY_PLAYERS ||
      env.APIFOOTBALL_COM_API_KEY_STATISTICS ||
      env.APIFOOTBALL_COM_API_KEY_LINEUPS ||
      env.APIFOOTBALL_COM_API_KEY_INJURIES
  );
}

export function createDryRunDependencies(adapter: ProviderAdapter, queryPostRunVerificationCounts?: ManualIngestionDependencies["queryPostRunVerificationCounts"]): ManualIngestionDependencies {
  return {
    fetchProviderResult: (request) =>
      adapter.fetch({
        provider: providerName,
        operation: request.operation,
        sport: "football",
        entityType: request.entityType,
        params: request.params
      }),
    queryPostRunVerificationCounts,
    persistRunReport: writeRunReportFile,
    log: (message) => console.log(message)
  };
}

export function createExecuteDependencies(config: ReturnType<typeof loadConfig>, adapter: ProviderAdapter): ManualIngestionDependencies & { close?: () => Promise<void> } {
  const database = createDatabase(config.DATABASE_URL);
  const rawPayloadRepository = new RawProviderPayloadRepository(database, {
    successRetentionDays: config.RAW_PAYLOAD_SUCCESS_RETENTION_DAYS,
    failedRetentionDays: config.RAW_PAYLOAD_FAILED_RETENTION_DAYS
  });
  const syncJobRepository = new SyncJobRepository(database);
  const normalizerRegistry = new NormalizerRegistry(
    createPipelineNormalizers(
      createStaticNormalizerRepositories(database, (work) =>
        database.transaction((transaction) => work(createStaticNormalizerRepositories(transaction)))
      )
    )
  );
  const rawPayloadProcessor = new RawPayloadProcessor(rawPayloadRepository, syncJobRepository, normalizerRegistry);
  const inlineQueue = {
    add: async () => undefined
  };
  const ingestionService = new ProviderIngestionService(rawPayloadRepository, syncJobRepository, inlineQueue, {
    nodeEnv: config.NODE_ENV,
    mockProviderEnabled: config.MOCK_PROVIDER_ENABLED
  });

  return {
    fetchProviderResult: (request) =>
      adapter.fetch({
        provider: providerName,
        operation: request.operation,
        sport: "football",
        entityType: request.entityType,
        params: request.params
    }),
    ingestProviderResult: (request) => ingestionService.ingestProviderResult(request),
    processRawPayload: (payload) => rawPayloadProcessor.process(payload),
    queryPostRunVerificationCounts: createPostRunVerificationQuery(database),
    persistRunReport: writeRunReportFile,
    log: (message) => console.log(message)
  };
}

async function writeRunReportFile(report: ManualIngestionRunReportSummary) {
  const outputDir = path.join(process.cwd(), ".provider-runs", providerName);
  await mkdir(outputDir, { recursive: true });
  const startedAt = report.started_at.replace(/[:.]/g, "-");
  const leagueId = report.league_id ?? "no-league";
  const filename = `${startedAt}-${report.mode}-country-${report.country_id ?? "unknown"}-league-${leagueId}.json`;
  await writeFile(path.join(outputDir, filename), `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

export function createPostRunVerificationQuery(database: Database): () => Promise<ManualPostRunVerificationCounts> {
  return async () => ({
    countriesCount: await countRows(database, countries),
    competitionsCount: await countRows(database, competitions),
    teamsCount: await countRows(database, teams),
    teamsWithLogoUrlCount: normalizeCount((await database.select({ count: count() }).from(teams).where(isNotNull(teams.logoUrl)))[0]?.count),
    matchesCount: await countRows(database, matches),
    footballMatchScoresCount: await countRows(database, footballMatchScores),
    footballStandingsCount: await countRows(database, footballStandings),
    providerMappingsCount: await countRows(database, providerMappings),
    rawProviderPayloadsByProcessingStatus: (
      await database.select({ status: rawProviderPayloads.status, count: count() }).from(rawProviderPayloads).groupBy(rawProviderPayloads.status)
    )
      .map((row) => ({ status: row.status, count: normalizeCount(row.count) }))
      .sort((left, right) => left.status.localeCompare(right.status)),
    failedRawPayloadCount: normalizeCount(
      (await database.select({ count: count() }).from(rawProviderPayloads).where(eq(rawProviderPayloads.status, "failed")))[0]?.count
    )
  });
}

async function countRows(database: Database, table: typeof countries) {
  return normalizeCount((await database.select({ count: count() }).from(table))[0]?.count);
}

function normalizeCount(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (typeof value === "string") {
    return Number(value);
  }
  return 0;
}

export async function closeDependencies(dependencies: ManualIngestionDependencies & { close?: () => Promise<void> }) {
  await dependencies.close?.();
}

const isDirectRun = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (isDirectRun) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "APIFootball.com manual ingestion failed.");
    process.exitCode = 1;
  });
}
