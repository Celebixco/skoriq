/**
 * Automatic analytics jobs only. Historical simulation backfills are manual,
 * opt-in maintenance and must never run on the daily schedule or fresh boot.
 */
export const JOBS = [
  {
    key: "prematch",
    hour: 9,
    minute: 0,
    script: "scripts/pipeline-football-daily-prematch.ts",
    args: ["--all-competitions", "--execute", "--timezone=Europe/Istanbul", "--limit=100", "--max-runtime-seconds=900"],
    timeoutSeconds: 1_200
  },
  {
    key: "finished-sync",
    hour: 9,
    minute: 10,
    script: "scripts/provider-football-finished-sync.ts",
    args: ["--execute", "--all-reviewed-enabled", "--lookback-hours=96"],
    timeoutSeconds: 900
  },
  {
    key: "rc-prematch",
    hour: 9,
    minute: 20,
    script: "scripts/football-rc-prematch.ts",
    args: ["--execute"],
    timeoutSeconds: 600
  },
  {
    key: "h1-prematch",
    hour: 9,
    minute: 25,
    script: "scripts/football-h1-prematch.ts",
    args: ["--execute"],
    timeoutSeconds: 600
  },
  {
    key: "tork-prematch",
    hour: 9,
    minute: 35,
    script: "scripts/football-tork-prematch.ts",
    args: ["--execute"],
    timeoutSeconds: 600
  },
  {
    key: "settlement",
    hour: 9,
    minute: 30,
    script: "scripts/analytics-football-predictions-settle.ts",
    args: ["--all-competitions", "--lookback-hours=96", "--execute"],
    timeoutSeconds: 900
  },
  {
    key: "model-shadow",
    hour: 9,
    minute: 45,
    script: "scripts/football-model-shadow.ts",
    args: ["--window-hours=72", "--min-training=200"],
    timeoutSeconds: 900
  }
];

export const INTERVAL_JOBS = [
  {
    key: "settlement",
    intervalMinutes: 15,
    script: "scripts/analytics-football-predictions-settle.ts",
    args: ["--all-competitions", "--lookback-hours=48", "--execute"],
    timeoutSeconds: 300
  },
  {
    key: "finished-sync-interval",
    intervalMinutes: 360,
    script: "scripts/provider-football-finished-sync.ts",
    args: ["--execute", "--all-reviewed-enabled", "--lookback-hours=120"],
    timeoutSeconds: 900
  },
  {
    key: "rc-prematch-interval",
    intervalMinutes: 360,
    script: "scripts/football-rc-prematch.ts",
    args: ["--execute"],
    timeoutSeconds: 600
  },
  {
    key: "h1-prematch-interval",
    intervalMinutes: 360,
    script: "scripts/football-h1-prematch.ts",
    args: ["--execute"],
    timeoutSeconds: 600
  },
  {
    key: "tork-prematch-interval",
    intervalMinutes: 360,
    script: "scripts/football-tork-prematch.ts",
    args: ["--execute"],
    timeoutSeconds: 600
  },
  {
    key: "rc-settlement",
    intervalMinutes: 15,
    script: "scripts/football-rc-settle.ts",
    args: [],
    timeoutSeconds: 300
  },
  {
    key: "h1-settlement",
    intervalMinutes: 15,
    script: "scripts/football-h1-settle.ts",
    args: [],
    timeoutSeconds: 300
  },
  {
    key: "tork-settlement",
    intervalMinutes: 15,
    script: "scripts/football-tork-settle.ts",
    args: [],
    timeoutSeconds: 300
  }
];
