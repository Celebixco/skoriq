CREATE TYPE "public"."football_player_availability_status" AS ENUM('injured', 'suspended', 'doubtful', 'unavailable', 'questionable', 'returned', 'unknown');--> statement-breakpoint
CREATE TABLE "football_player_availability" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"competition_id" uuid,
	"match_id" uuid,
	"status" "football_player_availability_status" NOT NULL,
	"reason" text,
	"injury_type" text,
	"expected_return_date" date,
	"provider_reported_at" timestamp with time zone,
	"source_label" text NOT NULL,
	"source_quality" text,
	"metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "football_player_availability_identity_uidx" UNIQUE NULLS NOT DISTINCT("player_id","team_id","competition_id","match_id","status","reason","injury_type","expected_return_date","source_label")
);
--> statement-breakpoint
CREATE TABLE "football_player_team_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"competition_id" uuid,
	"shirt_number" integer,
	"position" text,
	"active" boolean DEFAULT true NOT NULL,
	"valid_from" date,
	"valid_to" date,
	"metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "football_player_team_memberships_player_team_competition_uidx" UNIQUE NULLS NOT DISTINCT("player_id","team_id","competition_id")
);
--> statement-breakpoint
ALTER TABLE "football_player_availability" ADD CONSTRAINT "football_player_availability_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "football_player_availability" ADD CONSTRAINT "football_player_availability_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "football_player_availability" ADD CONSTRAINT "football_player_availability_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "football_player_availability" ADD CONSTRAINT "football_player_availability_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "football_player_team_memberships" ADD CONSTRAINT "football_player_team_memberships_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "football_player_team_memberships" ADD CONSTRAINT "football_player_team_memberships_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "football_player_team_memberships" ADD CONSTRAINT "football_player_team_memberships_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "football_player_availability_team_idx" ON "football_player_availability" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "football_player_availability_match_idx" ON "football_player_availability" USING btree ("match_id");--> statement-breakpoint
CREATE INDEX "football_player_availability_player_idx" ON "football_player_availability" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "football_player_availability_competition_idx" ON "football_player_availability" USING btree ("competition_id");--> statement-breakpoint
CREATE INDEX "football_player_availability_status_idx" ON "football_player_availability" USING btree ("status");--> statement-breakpoint
CREATE INDEX "football_player_availability_reported_idx" ON "football_player_availability" USING btree ("provider_reported_at");--> statement-breakpoint
CREATE INDEX "football_player_team_memberships_team_idx" ON "football_player_team_memberships" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "football_player_team_memberships_player_idx" ON "football_player_team_memberships" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "football_player_team_memberships_competition_idx" ON "football_player_team_memberships" USING btree ("competition_id");