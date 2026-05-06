CREATE TYPE "public"."football_match_lineup_role" AS ENUM('starting', 'substitute', 'coach', 'unavailable', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."football_player_context_risk_level" AS ENUM('low', 'medium', 'high', 'unknown');--> statement-breakpoint
CREATE TABLE "football_match_lineups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"formation" text,
	"confirmed" boolean DEFAULT false NOT NULL,
	"provider_reported_at" timestamp with time zone,
	"metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "football_match_lineups_match_team_uidx" UNIQUE("match_id","team_id")
);
--> statement-breakpoint
CREATE TABLE "football_match_lineup_players" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_lineup_id" uuid NOT NULL,
	"match_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"role" "football_match_lineup_role" DEFAULT 'unknown' NOT NULL,
	"position" text,
	"shirt_number" integer,
	"order_index" integer,
	"metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "football_match_lineup_players_identity_uidx" UNIQUE NULLS NOT DISTINCT("match_lineup_id","player_id","role","order_index")
);
--> statement-breakpoint
CREATE TABLE "football_match_player_context_features" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"home_missing_players_count" integer DEFAULT 0 NOT NULL,
	"away_missing_players_count" integer DEFAULT 0 NOT NULL,
	"home_suspended_count" integer DEFAULT 0 NOT NULL,
	"away_suspended_count" integer DEFAULT 0 NOT NULL,
	"home_injured_count" integer DEFAULT 0 NOT NULL,
	"away_injured_count" integer DEFAULT 0 NOT NULL,
	"home_doubtful_count" integer DEFAULT 0 NOT NULL,
	"away_doubtful_count" integer DEFAULT 0 NOT NULL,
	"home_lineup_confirmed" boolean DEFAULT false NOT NULL,
	"away_lineup_confirmed" boolean DEFAULT false NOT NULL,
	"home_starting_xi_known" boolean DEFAULT false NOT NULL,
	"away_starting_xi_known" boolean DEFAULT false NOT NULL,
	"home_availability_coverage_score" numeric(5, 2) DEFAULT 0 NOT NULL,
	"away_availability_coverage_score" numeric(5, 2) DEFAULT 0 NOT NULL,
	"player_context_coverage_score" numeric(5, 2) DEFAULT 0 NOT NULL,
	"player_context_risk_level" "football_player_context_risk_level" DEFAULT 'unknown' NOT NULL,
	"metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "football_match_lineups" ADD CONSTRAINT "football_match_lineups_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "football_match_lineups" ADD CONSTRAINT "football_match_lineups_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "football_match_lineup_players" ADD CONSTRAINT "football_match_lineup_players_match_lineup_id_football_match_lineups_id_fk" FOREIGN KEY ("match_lineup_id") REFERENCES "public"."football_match_lineups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "football_match_lineup_players" ADD CONSTRAINT "football_match_lineup_players_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "football_match_lineup_players" ADD CONSTRAINT "football_match_lineup_players_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "football_match_lineup_players" ADD CONSTRAINT "football_match_lineup_players_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "football_match_player_context_features" ADD CONSTRAINT "football_match_player_context_features_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "football_match_player_context_features_match_uidx" ON "football_match_player_context_features" USING btree ("match_id");--> statement-breakpoint
CREATE INDEX "football_match_lineups_match_idx" ON "football_match_lineups" USING btree ("match_id");--> statement-breakpoint
CREATE INDEX "football_match_lineups_team_idx" ON "football_match_lineups" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "football_match_lineups_reported_idx" ON "football_match_lineups" USING btree ("provider_reported_at");--> statement-breakpoint
CREATE INDEX "football_match_lineup_players_lineup_idx" ON "football_match_lineup_players" USING btree ("match_lineup_id");--> statement-breakpoint
CREATE INDEX "football_match_lineup_players_match_idx" ON "football_match_lineup_players" USING btree ("match_id");--> statement-breakpoint
CREATE INDEX "football_match_lineup_players_team_idx" ON "football_match_lineup_players" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "football_match_lineup_players_player_idx" ON "football_match_lineup_players" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "football_match_player_context_features_risk_idx" ON "football_match_player_context_features" USING btree ("player_context_risk_level");--> statement-breakpoint
CREATE INDEX "football_match_player_context_features_updated_idx" ON "football_match_player_context_features" USING btree ("updated_at");--> statement-breakpoint
