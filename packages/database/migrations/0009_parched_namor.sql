CREATE TABLE "football_head_to_head_features" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_a_id" uuid NOT NULL,
	"team_b_id" uuid NOT NULL,
	"competition_id" uuid,
	"season_id" uuid,
	"as_of_match_id" uuid,
	"as_of_date" timestamp with time zone NOT NULL,
	"window_size" integer NOT NULL,
	"matches_played" integer DEFAULT 0 NOT NULL,
	"team_a_wins" integer DEFAULT 0 NOT NULL,
	"team_b_wins" integer DEFAULT 0 NOT NULL,
	"draws" integer DEFAULT 0 NOT NULL,
	"team_a_goals_for" integer DEFAULT 0 NOT NULL,
	"team_b_goals_for" integer DEFAULT 0 NOT NULL,
	"avg_total_goals" numeric(8, 3),
	"avg_team_a_goals" numeric(8, 3),
	"avg_team_b_goals" numeric(8, 3),
	"both_teams_to_score_rate" numeric(5, 2),
	"over_1_5_rate" numeric(5, 2),
	"over_2_5_rate" numeric(5, 2),
	"over_3_5_rate" numeric(5, 2),
	"team_a_home_matches" integer DEFAULT 0 NOT NULL,
	"team_b_home_matches" integer DEFAULT 0 NOT NULL,
	"team_a_home_wins" integer DEFAULT 0 NOT NULL,
	"team_b_home_wins" integer DEFAULT 0 NOT NULL,
	"last_match_id" uuid,
	"last_match_date" timestamp with time zone,
	"last_match_team_a_goals" integer,
	"last_match_team_b_goals" integer,
	"sample_size" integer DEFAULT 0 NOT NULL,
	"coverage_score" numeric(5, 2) DEFAULT 0 NOT NULL,
	"metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "football_head_to_head_features_uidx" UNIQUE NULLS NOT DISTINCT("team_a_id","team_b_id","competition_id","season_id","as_of_match_id","window_size")
);
--> statement-breakpoint
ALTER TABLE "football_head_to_head_features" ADD CONSTRAINT "football_head_to_head_features_team_a_id_teams_id_fk" FOREIGN KEY ("team_a_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "football_head_to_head_features" ADD CONSTRAINT "football_head_to_head_features_team_b_id_teams_id_fk" FOREIGN KEY ("team_b_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "football_head_to_head_features" ADD CONSTRAINT "football_head_to_head_features_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "football_head_to_head_features" ADD CONSTRAINT "football_head_to_head_features_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "football_head_to_head_features" ADD CONSTRAINT "football_head_to_head_features_as_of_match_id_matches_id_fk" FOREIGN KEY ("as_of_match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "football_head_to_head_features" ADD CONSTRAINT "football_head_to_head_features_last_match_id_matches_id_fk" FOREIGN KEY ("last_match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "football_head_to_head_features_team_a_idx" ON "football_head_to_head_features" USING btree ("team_a_id");--> statement-breakpoint
CREATE INDEX "football_head_to_head_features_team_b_idx" ON "football_head_to_head_features" USING btree ("team_b_id");--> statement-breakpoint
CREATE INDEX "football_head_to_head_features_competition_season_idx" ON "football_head_to_head_features" USING btree ("competition_id","season_id");--> statement-breakpoint
CREATE INDEX "football_head_to_head_features_as_of_match_idx" ON "football_head_to_head_features" USING btree ("as_of_match_id");--> statement-breakpoint
CREATE INDEX "football_head_to_head_features_pair_idx" ON "football_head_to_head_features" USING btree ("team_a_id","team_b_id");--> statement-breakpoint
CREATE INDEX "football_head_to_head_features_updated_idx" ON "football_head_to_head_features" USING btree ("updated_at");