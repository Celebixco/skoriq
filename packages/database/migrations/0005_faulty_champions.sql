ALTER TYPE "public"."provider_entity_type" ADD VALUE 'football_match_team_statistics' BEFORE 'match_score';--> statement-breakpoint
ALTER TYPE "public"."provider_entity_type" ADD VALUE 'basketball_team_match_statistics' BEFORE 'match_score';--> statement-breakpoint
CREATE TABLE "basketball_team_match_statistics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"opponent_team_id" uuid NOT NULL,
	"is_home" boolean NOT NULL,
	"field_goals_made" integer,
	"field_goals_attempted" integer,
	"field_goal_percent" numeric(5, 2),
	"two_pointers_made" integer,
	"two_pointers_attempted" integer,
	"two_point_percent" numeric(5, 2),
	"three_pointers_made" integer,
	"three_pointers_attempted" integer,
	"three_point_percent" numeric(5, 2),
	"free_throws_made" integer,
	"free_throws_attempted" integer,
	"free_throw_percent" numeric(5, 2),
	"rebounds_total" integer,
	"rebounds_offensive" integer,
	"rebounds_defensive" integer,
	"assists" integer,
	"steals" integer,
	"blocks" integer,
	"turnovers" integer,
	"personal_fouls" integer,
	"fast_break_points" integer,
	"points_in_paint" integer,
	"second_chance_points" integer,
	"bench_points" integer,
	"biggest_lead" integer,
	"lead_changes" integer,
	"time_in_lead_seconds" integer,
	"metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "football_match_team_statistics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"opponent_team_id" uuid NOT NULL,
	"is_home" boolean NOT NULL,
	"possession_percent" numeric(5, 2),
	"shots_total" integer,
	"shots_on_target" integer,
	"shots_off_target" integer,
	"blocked_shots" integer,
	"corners" integer,
	"fouls" integer,
	"yellow_cards" integer,
	"red_cards" integer,
	"offsides" integer,
	"goalkeeper_saves" integer,
	"passes" integer,
	"accurate_passes" integer,
	"pass_accuracy_percent" numeric(5, 2),
	"big_chances" integer,
	"big_chances_missed" integer,
	"expected_goals" numeric(6, 3),
	"expected_assists" numeric(6, 3),
	"attacks" integer,
	"dangerous_attacks" integer,
	"hit_woodwork" integer,
	"tackles" integer,
	"interceptions" integer,
	"clearances" integer,
	"duels_won" integer,
	"aerial_duels_won" integer,
	"metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "basketball_team_match_statistics" ADD CONSTRAINT "basketball_team_match_statistics_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "basketball_team_match_statistics" ADD CONSTRAINT "basketball_team_match_statistics_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "basketball_team_match_statistics" ADD CONSTRAINT "basketball_team_match_statistics_opponent_team_id_teams_id_fk" FOREIGN KEY ("opponent_team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "football_match_team_statistics" ADD CONSTRAINT "football_match_team_statistics_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "football_match_team_statistics" ADD CONSTRAINT "football_match_team_statistics_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "football_match_team_statistics" ADD CONSTRAINT "football_match_team_statistics_opponent_team_id_teams_id_fk" FOREIGN KEY ("opponent_team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "basketball_team_match_statistics_match_team_uidx" ON "basketball_team_match_statistics" USING btree ("match_id","team_id");--> statement-breakpoint
CREATE INDEX "basketball_team_match_statistics_match_idx" ON "basketball_team_match_statistics" USING btree ("match_id");--> statement-breakpoint
CREATE INDEX "basketball_team_match_statistics_team_idx" ON "basketball_team_match_statistics" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "basketball_team_match_statistics_opponent_idx" ON "basketball_team_match_statistics" USING btree ("opponent_team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "football_match_team_statistics_match_team_uidx" ON "football_match_team_statistics" USING btree ("match_id","team_id");--> statement-breakpoint
CREATE INDEX "football_match_team_statistics_match_idx" ON "football_match_team_statistics" USING btree ("match_id");--> statement-breakpoint
CREATE INDEX "football_match_team_statistics_team_idx" ON "football_match_team_statistics" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "football_match_team_statistics_opponent_idx" ON "football_match_team_statistics" USING btree ("opponent_team_id");