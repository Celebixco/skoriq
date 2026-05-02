import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { APIFootballComHttpClient, APIFootballComHttpError, createAPIFootballCredentialResolver } from "@sports-data/providers";
import type { APIFootballComAction } from "@sports-data/providers";

const providerName = "apifootball-com";
const sampleDir = path.resolve(process.cwd(), ".provider-samples", providerName);
const authCheckMode = process.argv.includes("--auth-check");

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("APIFootball.com sample capture is forbidden in production.");
  }

  const credentialResolver = createAPIFootballCredentialResolver({
    legacyApiKey: process.env.APIFOOTBALL_COM_API_KEY,
    defaultApiKey: process.env.APIFOOTBALL_COM_API_KEY_DEFAULT,
    countriesApiKey: process.env.APIFOOTBALL_COM_API_KEY_COUNTRIES,
    leaguesApiKey: process.env.APIFOOTBALL_COM_API_KEY_LEAGUES,
    teamsApiKey: process.env.APIFOOTBALL_COM_API_KEY_TEAMS,
    standingsApiKey: process.env.APIFOOTBALL_COM_API_KEY_STANDINGS,
    eventsApiKey: process.env.APIFOOTBALL_COM_API_KEY_EVENTS,
    resultsApiKey: process.env.APIFOOTBALL_COM_API_KEY_RESULTS,
    fixturesApiKey: process.env.APIFOOTBALL_COM_API_KEY_FIXTURES,
    playersApiKey: process.env.APIFOOTBALL_COM_API_KEY_PLAYERS,
    statisticsApiKey: process.env.APIFOOTBALL_COM_API_KEY_STATISTICS,
    lineupsApiKey: process.env.APIFOOTBALL_COM_API_KEY_LINEUPS,
    injuriesApiKey: process.env.APIFOOTBALL_COM_API_KEY_INJURIES
  });
  if (!credentialResolver.hasAnyCredential()) {
    throw new Error("At least one APIFOOTBALL_COM_API_KEY* value is required for local sample capture.");
  }

  const client = new APIFootballComHttpClient({
    credentialResolver,
    baseUrl: process.env.APIFOOTBALL_COM_BASE_URL ?? "https://apiv3.apifootball.com/",
    timeoutMs: Number.parseInt(process.env.APIFOOTBALL_COM_TIMEOUT_MS ?? "15000", 10)
  });

  await mkdir(sampleDir, { recursive: true });

  if (authCheckMode) {
    await capture(client, "get_countries", {}, { writeSample: false });
    return;
  }

  await capture(client, "get_countries");
  await capture(client, "get_leagues", { country_id: process.env.APIFOOTBALL_COM_SAMPLE_COUNTRY_ID });

  const leagueId = process.env.APIFOOTBALL_COM_SAMPLE_LEAGUE_ID;
  const sampleFrom = process.env.APIFOOTBALL_COM_SAMPLE_FROM;
  const sampleTo = process.env.APIFOOTBALL_COM_SAMPLE_TO;

  if (leagueId && sampleFrom && sampleTo) {
    await capture(client, "get_events", {
      from: sampleFrom,
      to: sampleTo,
      country_id: process.env.APIFOOTBALL_COM_SAMPLE_COUNTRY_ID,
      league_id: leagueId
    });
  } else if (!leagueId) {
    skip("get_events", "APIFOOTBALL_COM_SAMPLE_LEAGUE_ID is not set.");
  } else {
    skip("get_events", "APIFOOTBALL_COM_SAMPLE_FROM and APIFOOTBALL_COM_SAMPLE_TO are required together.");
  }

  if (leagueId) {
    await capture(client, "get_standings", { league_id: leagueId });
    await capture(client, "get_teams", { league_id: leagueId });
  } else {
    skip("get_standings", "APIFOOTBALL_COM_SAMPLE_LEAGUE_ID is not set.");
    skip("get_teams", "APIFOOTBALL_COM_SAMPLE_LEAGUE_ID is not set.");
  }
}

async function capture(
  client: APIFootballComHttpClient,
  action: APIFootballComAction,
  params: Record<string, string | undefined> = {},
  options: { writeSample?: boolean } = {}
) {
  try {
    const result = await client.requestJson({ action, params });
    if (options.writeSample === false) {
      console.log(`APIFootball.com auth check succeeded for ${action}.`);
      return;
    }

    await writeSuccessSample(action, result);
  } catch (error) {
    if (error instanceof APIFootballComHttpError) {
      await writeErrorSample(error);
      console.error(error.message);
      return;
    }

    throw error;
  }
}

async function writeSuccessSample(action: APIFootballComAction, result: Awaited<ReturnType<APIFootballComHttpClient["requestJson"]>>) {
  const sample = {
    capturedAt: result.metadata.fetchedAt,
    provider: providerName,
    action,
    request: {
      action,
      params: result.metadata.params,
      apiKey: "<redacted>",
      credentialLabel: result.metadata.credentialLabel
    },
    responseShape: summarizeShape(result.payload),
    payload: trimPayload(result.payload)
  };

  await writeFile(path.join(sampleDir, `${action}.sample.json`), `${JSON.stringify(sample, null, 2)}\n`);
}

async function writeErrorSample(error: APIFootballComHttpError) {
  const sample = {
    capturedAt: new Date().toISOString(),
    provider: providerName,
    action: error.details.action,
    request: {
      safeUrl: error.details.safeRequestUrl,
      apiKey: "<redacted>",
      credentialLabel: error.details.credentialLabel
    },
    error: {
      kind: error.details.kind,
      message: error.details.message,
      status: error.details.status,
      responseBody: trimPayload(error.details.responseBody)
    }
  };

  await writeFile(path.join(sampleDir, `${error.details.action}.error.sample.json`), `${JSON.stringify(sample, null, 2)}\n`);
}

function skip(action: APIFootballComAction, reason: string) {
  console.warn(`Skipping ${action}: ${reason}`);
}

function trimPayload(payload: unknown): unknown {
  if (Array.isArray(payload)) {
    return payload.slice(0, 5).map(trimPayload);
  }

  if (payload && typeof payload === "object") {
    return Object.fromEntries(Object.entries(payload).slice(0, 10).map(([key, value]) => [key, trimPayload(value)]));
  }

  return payload;
}

function summarizeShape(payload: unknown): unknown {
  if (Array.isArray(payload)) {
    return {
      type: "array",
      lengthCaptured: payload.length,
      firstItemKeys: payload[0] && typeof payload[0] === "object" ? Object.keys(payload[0]) : []
    };
  }

  if (payload && typeof payload === "object") {
    return {
      type: "object",
      keys: Object.keys(payload)
    };
  }

  return { type: typeof payload };
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "APIFootball.com sample capture failed.");
  process.exitCode = 1;
});
