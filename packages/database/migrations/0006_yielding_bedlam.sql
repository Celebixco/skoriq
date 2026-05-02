ALTER TYPE "public"."provider_entity_type" ADD VALUE 'football_standing' BEFORE 'match_score';--> statement-breakpoint
ALTER TYPE "public"."provider_entity_type" ADD VALUE 'basketball_standing' BEFORE 'match_score';--> statement-breakpoint
CREATE TABLE "basketball_standings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"competition_id" uuid NOT NULL,
	"season_id" uuid,
	"team_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"played" integer NOT NULL,
	"wins" integer NOT NULL,
	"losses" integer NOT NULL,
	"win_percentage" numeric(5, 2),
	"points_for" integer,
	"points_against" integer,
	"point_difference" integer,
	"home_wins" integer,
	"home_losses" integer,
	"away_wins" integer,
	"away_losses" integer,
	"streak" text,
	"form_string" text,
	"conference" text,
	"division" text,
	"status" text,
	"metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "basketball_standings_competition_season_team_uidx" UNIQUE NULLS NOT DISTINCT("competition_id","season_id","team_id")
);
--> statement-breakpoint
CREATE TABLE "football_standings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"competition_id" uuid NOT NULL,
	"season_id" uuid,
	"team_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"played" integer NOT NULL,
	"wins" integer NOT NULL,
	"draws" integer NOT NULL,
	"losses" integer NOT NULL,
	"goals_for" integer NOT NULL,
	"goals_against" integer NOT NULL,
	"goal_difference" integer NOT NULL,
	"points" integer NOT NULL,
	"home_played" integer,
	"home_wins" integer,
	"home_draws" integer,
	"home_losses" integer,
	"home_goals_for" integer,
	"home_goals_against" integer,
	"away_played" integer,
	"away_wins" integer,
	"away_draws" integer,
	"away_losses" integer,
	"away_goals_for" integer,
	"away_goals_against" integer,
	"form_string" text,
	"status" text,
	"metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "football_standings_competition_season_team_uidx" UNIQUE NULLS NOT DISTINCT("competition_id","season_id","team_id")
);
--> statement-breakpoint
ALTER TABLE "basketball_standings" ADD CONSTRAINT "basketball_standings_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "basketball_standings" ADD CONSTRAINT "basketball_standings_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "basketball_standings" ADD CONSTRAINT "basketball_standings_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "football_standings" ADD CONSTRAINT "football_standings_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "football_standings" ADD CONSTRAINT "football_standings_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "football_standings" ADD CONSTRAINT "football_standings_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "basketball_standings_competition_season_position_idx" ON "basketball_standings" USING btree ("competition_id","season_id","position");--> statement-breakpoint
CREATE INDEX "basketball_standings_team_idx" ON "basketball_standings" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "basketball_standings_lookup_idx" ON "basketball_standings" USING btree ("competition_id","season_id","team_id");--> statement-breakpoint
CREATE INDEX "football_standings_competition_season_position_idx" ON "football_standings" USING btree ("competition_id","season_id","position");--> statement-breakpoint
CREATE INDEX "football_standings_team_idx" ON "football_standings" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "football_standings_lookup_idx" ON "football_standings" USING btree ("competition_id","season_id","team_id");