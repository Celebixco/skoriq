CREATE EXTENSION IF NOT EXISTS "pgcrypto";--> statement-breakpoint
CREATE TYPE "public"."log_level" AS ENUM('debug', 'info', 'warn', 'error');--> statement-breakpoint
CREATE TYPE "public"."match_status" AS ENUM('scheduled', 'not_started', 'postponed', 'cancelled', 'finished', 'after_extra_time', 'after_penalties', 'abandoned');--> statement-breakpoint
CREATE TYPE "public"."provider_entity_type" AS ENUM('sport', 'country', 'competition', 'season', 'team', 'player', 'match', 'match_score', 'match_event', 'match_statistics', 'standing');--> statement-breakpoint
CREATE TYPE "public"."raw_payload_status" AS ENUM('received', 'processed', 'failed', 'expired');--> statement-breakpoint
CREATE TYPE "public"."score_period" AS ENUM('final', 'halftime', 'fulltime', 'extra_time', 'penalties');--> statement-breakpoint
CREATE TYPE "public"."sync_job_status" AS ENUM('queued', 'running', 'succeeded', 'failed', 'dead_lettered');--> statement-breakpoint
CREATE TABLE "competition_team_features" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"competition_id" uuid NOT NULL,
	"season_id" uuid,
	"team_id" uuid NOT NULL,
	"features_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"content_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "competition_team_features_uidx" UNIQUE NULLS NOT DISTINCT("competition_id","season_id","team_id")
);
--> statement-breakpoint
CREATE TABLE "competitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sport_id" uuid NOT NULL,
	"country_id" uuid,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"gender" text,
	"level" text,
	"metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "countries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "head_to_head_features" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_a_id" uuid NOT NULL,
	"team_b_id" uuid NOT NULL,
	"as_of_match_id" uuid,
	"features_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"content_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "head_to_head_features_uidx" UNIQUE NULLS NOT DISTINCT("team_a_id","team_b_id","as_of_match_id")
);
--> statement-breakpoint
CREATE TABLE "match_analysis_features" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"features_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"content_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "match_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"team_id" uuid,
	"player_id" uuid,
	"event_type" text NOT NULL,
	"minute" integer,
	"extra_minute" integer,
	"metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"provider_order" integer,
	"content_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "match_events_content_uidx" UNIQUE NULLS NOT DISTINCT("match_id","event_type","minute","extra_minute","team_id","player_id","provider_order")
);
--> statement-breakpoint
CREATE TABLE "match_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"period" "score_period" NOT NULL,
	"home_score" integer,
	"away_score" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "match_statistics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"possession" numeric(5, 2),
	"shots" integer,
	"shots_on_target" integer,
	"corners" integer,
	"fouls" integer,
	"yellow_cards" integer,
	"red_cards" integer,
	"offsides" integer,
	"expected_goals" numeric(6, 3),
	"attacks" integer,
	"dangerous_attacks" integer,
	"passes" integer,
	"provider_stats_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"content_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sport_id" uuid NOT NULL,
	"competition_id" uuid NOT NULL,
	"season_id" uuid,
	"round" text,
	"home_team_id" uuid NOT NULL,
	"away_team_id" uuid NOT NULL,
	"scheduled_start_at" timestamp with time zone NOT NULL,
	"status" "match_status" NOT NULL,
	"venue" text,
	"referee" text,
	"metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"content_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "matches_natural_uidx" UNIQUE NULLS NOT DISTINCT("competition_id","season_id","home_team_id","away_team_id","scheduled_start_at")
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sport_id" uuid NOT NULL,
	"country_id" uuid,
	"current_team_id" uuid,
	"name" text NOT NULL,
	"date_of_birth" date,
	"position" text,
	"metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"entity_type" "provider_entity_type" NOT NULL,
	"provider_entity_id" text NOT NULL,
	"internal_entity_id" uuid NOT NULL,
	"internal_entity_type" "provider_entity_type" NOT NULL,
	"metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "raw_provider_payloads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"entity_type" "provider_entity_type" NOT NULL,
	"provider_entity_id" text,
	"endpoint" text NOT NULL,
	"request_params_hash" text NOT NULL,
	"payload_hash" text NOT NULL,
	"payload_json" jsonb NOT NULL,
	"status" "raw_payload_status" DEFAULT 'received' NOT NULL,
	"normalization_error" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"delete_after" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seasons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"competition_id" uuid NOT NULL,
	"name" text NOT NULL,
	"start_date" date,
	"end_date" date,
	"is_current" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "standings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"competition_id" uuid NOT NULL,
	"season_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"position" integer,
	"played" integer DEFAULT 0 NOT NULL,
	"won" integer DEFAULT 0 NOT NULL,
	"drawn" integer DEFAULT 0 NOT NULL,
	"lost" integer DEFAULT 0 NOT NULL,
	"goals_for" integer DEFAULT 0 NOT NULL,
	"goals_against" integer DEFAULT 0 NOT NULL,
	"points" integer DEFAULT 0 NOT NULL,
	"metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"content_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_job_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sync_job_id" uuid NOT NULL,
	"level" "log_level" NOT NULL,
	"message" text NOT NULL,
	"metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"queue_name" text NOT NULL,
	"job_name" text NOT NULL,
	"job_key" text NOT NULL,
	"provider" text NOT NULL,
	"entity_type" "provider_entity_type" NOT NULL,
	"entity_id" text,
	"provider_entity_id" text,
	"status" "sync_job_status" DEFAULT 'queued' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_analysis_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"snapshot_date" date NOT NULL,
	"features_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"content_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_form_features" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"competition_id" uuid,
	"season_id" uuid,
	"as_of_match_id" uuid,
	"window_size" integer NOT NULL,
	"scope" text NOT NULL,
	"features_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"content_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_form_features_uidx" UNIQUE NULLS NOT DISTINCT("team_id","competition_id","season_id","as_of_match_id","window_size","scope")
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sport_id" uuid NOT NULL,
	"country_id" uuid,
	"name" text NOT NULL,
	"short_name" text,
	"slug" text NOT NULL,
	"metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "competition_team_features" ADD CONSTRAINT "competition_team_features_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_team_features" ADD CONSTRAINT "competition_team_features_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_team_features" ADD CONSTRAINT "competition_team_features_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitions" ADD CONSTRAINT "competitions_sport_id_sports_id_fk" FOREIGN KEY ("sport_id") REFERENCES "public"."sports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitions" ADD CONSTRAINT "competitions_country_id_countries_id_fk" FOREIGN KEY ("country_id") REFERENCES "public"."countries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "head_to_head_features" ADD CONSTRAINT "head_to_head_features_team_a_id_teams_id_fk" FOREIGN KEY ("team_a_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "head_to_head_features" ADD CONSTRAINT "head_to_head_features_team_b_id_teams_id_fk" FOREIGN KEY ("team_b_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "head_to_head_features" ADD CONSTRAINT "head_to_head_features_as_of_match_id_matches_id_fk" FOREIGN KEY ("as_of_match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_analysis_features" ADD CONSTRAINT "match_analysis_features_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_events" ADD CONSTRAINT "match_events_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_events" ADD CONSTRAINT "match_events_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_events" ADD CONSTRAINT "match_events_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_scores" ADD CONSTRAINT "match_scores_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_statistics" ADD CONSTRAINT "match_statistics_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_statistics" ADD CONSTRAINT "match_statistics_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_sport_id_sports_id_fk" FOREIGN KEY ("sport_id") REFERENCES "public"."sports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_home_team_id_teams_id_fk" FOREIGN KEY ("home_team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_away_team_id_teams_id_fk" FOREIGN KEY ("away_team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_sport_id_sports_id_fk" FOREIGN KEY ("sport_id") REFERENCES "public"."sports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_country_id_countries_id_fk" FOREIGN KEY ("country_id") REFERENCES "public"."countries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_current_team_id_teams_id_fk" FOREIGN KEY ("current_team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seasons" ADD CONSTRAINT "seasons_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standings" ADD CONSTRAINT "standings_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standings" ADD CONSTRAINT "standings_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standings" ADD CONSTRAINT "standings_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_job_logs" ADD CONSTRAINT "sync_job_logs_sync_job_id_sync_jobs_id_fk" FOREIGN KEY ("sync_job_id") REFERENCES "public"."sync_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_analysis_snapshots" ADD CONSTRAINT "team_analysis_snapshots_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_form_features" ADD CONSTRAINT "team_form_features_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_form_features" ADD CONSTRAINT "team_form_features_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_form_features" ADD CONSTRAINT "team_form_features_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_form_features" ADD CONSTRAINT "team_form_features_as_of_match_id_matches_id_fk" FOREIGN KEY ("as_of_match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_sport_id_sports_id_fk" FOREIGN KEY ("sport_id") REFERENCES "public"."sports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_country_id_countries_id_fk" FOREIGN KEY ("country_id") REFERENCES "public"."countries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "competition_team_features_lookup_idx" ON "competition_team_features" USING btree ("competition_id","season_id","team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "competitions_sport_slug_uidx" ON "competitions" USING btree ("sport_id","slug");--> statement-breakpoint
CREATE INDEX "competitions_country_idx" ON "competitions" USING btree ("country_id");--> statement-breakpoint
CREATE UNIQUE INDEX "countries_code_uidx" ON "countries" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "countries_slug_uidx" ON "countries" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "head_to_head_features_team_pair_idx" ON "head_to_head_features" USING btree ("team_a_id","team_b_id");--> statement-breakpoint
CREATE UNIQUE INDEX "match_analysis_features_match_uidx" ON "match_analysis_features" USING btree ("match_id");--> statement-breakpoint
CREATE INDEX "match_events_match_idx" ON "match_events" USING btree ("match_id");--> statement-breakpoint
CREATE UNIQUE INDEX "match_scores_match_period_uidx" ON "match_scores" USING btree ("match_id","period");--> statement-breakpoint
CREATE UNIQUE INDEX "match_statistics_match_team_uidx" ON "match_statistics" USING btree ("match_id","team_id");--> statement-breakpoint
CREATE INDEX "match_statistics_team_idx" ON "match_statistics" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "matches_upcoming_idx" ON "matches" USING btree ("scheduled_start_at") WHERE "matches"."status" in ('scheduled', 'not_started', 'postponed');--> statement-breakpoint
CREATE INDEX "matches_finished_idx" ON "matches" USING btree ("scheduled_start_at") WHERE "matches"."status" in ('finished', 'after_extra_time', 'after_penalties', 'abandoned');--> statement-breakpoint
CREATE INDEX "matches_competition_date_idx" ON "matches" USING btree ("competition_id","scheduled_start_at");--> statement-breakpoint
CREATE INDEX "matches_home_team_date_idx" ON "matches" USING btree ("home_team_id","scheduled_start_at");--> statement-breakpoint
CREATE INDEX "matches_away_team_date_idx" ON "matches" USING btree ("away_team_id","scheduled_start_at");--> statement-breakpoint
CREATE INDEX "players_current_team_idx" ON "players" USING btree ("current_team_id");--> statement-breakpoint
CREATE INDEX "players_sport_name_idx" ON "players" USING btree ("sport_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_mappings_provider_entity_uidx" ON "provider_mappings" USING btree ("provider","entity_type","provider_entity_id");--> statement-breakpoint
CREATE INDEX "provider_mappings_internal_idx" ON "provider_mappings" USING btree ("internal_entity_type","internal_entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "raw_provider_payloads_dedupe_uidx" ON "raw_provider_payloads" USING btree ("provider","endpoint","request_params_hash","payload_hash");--> statement-breakpoint
CREATE INDEX "raw_provider_payloads_cleanup_idx" ON "raw_provider_payloads" USING btree ("status","delete_after");--> statement-breakpoint
CREATE INDEX "raw_provider_payloads_delete_after_idx" ON "raw_provider_payloads" USING btree ("delete_after");--> statement-breakpoint
CREATE INDEX "raw_provider_payloads_entity_idx" ON "raw_provider_payloads" USING btree ("provider","entity_type","provider_entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "seasons_competition_name_uidx" ON "seasons" USING btree ("competition_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "sports_slug_uidx" ON "sports" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "standings_competition_season_team_uidx" ON "standings" USING btree ("competition_id","season_id","team_id");--> statement-breakpoint
CREATE INDEX "standings_competition_season_idx" ON "standings" USING btree ("competition_id","season_id","position");--> statement-breakpoint
CREATE INDEX "sync_job_logs_job_created_idx" ON "sync_job_logs" USING btree ("sync_job_id","created_at");--> statement-breakpoint
CREATE INDEX "sync_job_logs_created_idx" ON "sync_job_logs" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sync_jobs_job_key_uidx" ON "sync_jobs" USING btree ("job_key");--> statement-breakpoint
CREATE INDEX "sync_jobs_status_idx" ON "sync_jobs" USING btree ("status","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "team_analysis_snapshots_team_date_uidx" ON "team_analysis_snapshots" USING btree ("team_id","snapshot_date");--> statement-breakpoint
CREATE INDEX "team_analysis_snapshots_team_lookup_idx" ON "team_analysis_snapshots" USING btree ("team_id","snapshot_date");--> statement-breakpoint
CREATE INDEX "team_form_features_team_lookup_idx" ON "team_form_features" USING btree ("team_id","scope","window_size");--> statement-breakpoint
CREATE UNIQUE INDEX "teams_sport_slug_uidx" ON "teams" USING btree ("sport_id","slug");--> statement-breakpoint
CREATE INDEX "teams_country_idx" ON "teams" USING btree ("country_id");
