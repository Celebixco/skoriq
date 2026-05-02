export interface AnalysisFeatureBuildRequest {
  reason: string;
  matchId?: string;
  teamId?: string;
  competitionId?: string;
  seasonId?: string;
}

export interface AnalysisFeatureBuildResult {
  changedFeatureRows: number;
  skippedReason?: string;
}

export interface AnalysisFeatureBuilder {
  build(request: AnalysisFeatureBuildRequest): Promise<AnalysisFeatureBuildResult>;
}
