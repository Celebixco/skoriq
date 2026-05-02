export const queueNames = {
  fixtureSync: "fixture-sync-queue",
  finishedMatchSync: "finished-match-sync-queue",
  matchDetailSync: "match-detail-sync-queue",
  standingsSync: "standings-sync-queue",
  teamSync: "team-sync-queue",
  playerSync: "player-sync-queue",
  rawPayloadProcessing: "raw-payload-processing-queue",
  normalization: "normalization-queue",
  analysisFeatureBuild: "analysis-feature-build-queue",
  cleanup: "cleanup-queue"
} as const;

export type QueueName = (typeof queueNames)[keyof typeof queueNames];

export const allQueueNames = Object.values(queueNames);
