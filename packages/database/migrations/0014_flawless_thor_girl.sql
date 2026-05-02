CREATE TYPE "public"."football_prediction_settlement_status" AS ENUM('settled_success', 'settled_failed', 'settled_void');--> statement-breakpoint
CREATE TABLE "football_prediction_settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prediction_output_id" uuid NOT NULL,
	"match_id" uuid NOT NULL,
	"settlement_status" "football_prediction_settlement_status" NOT NULL,
	"actual_result" text NOT NULL,
	"evaluated_at" timestamp with time zone NOT NULL,
	"settlement_reason" text NOT NULL,
	"settlement_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "football_prediction_settlements" ADD CONSTRAINT "football_prediction_settlements_prediction_output_id_football_prediction_outputs_id_fk" FOREIGN KEY ("prediction_output_id") REFERENCES "public"."football_prediction_outputs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "football_prediction_settlements" ADD CONSTRAINT "football_prediction_settlements_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "football_prediction_settlements_prediction_output_uidx" ON "football_prediction_settlements" USING btree ("prediction_output_id");--> statement-breakpoint
CREATE INDEX "football_prediction_settlements_prediction_output_idx" ON "football_prediction_settlements" USING btree ("prediction_output_id");--> statement-breakpoint
CREATE INDEX "football_prediction_settlements_match_idx" ON "football_prediction_settlements" USING btree ("match_id");--> statement-breakpoint
CREATE INDEX "football_prediction_settlements_status_idx" ON "football_prediction_settlements" USING btree ("settlement_status");--> statement-breakpoint
CREATE INDEX "football_prediction_settlements_evaluated_at_idx" ON "football_prediction_settlements" USING btree ("evaluated_at");