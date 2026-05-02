ALTER TABLE "football_prediction_outputs" ADD COLUMN "stale_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "football_prediction_outputs" ADD COLUMN "rebuild_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "football_prediction_outputs" ADD COLUMN "generation_window_status" text;--> statement-breakpoint
ALTER TABLE "football_prediction_outputs" ADD COLUMN "generated_lead_time_minutes" integer;--> statement-breakpoint
ALTER TABLE "football_prediction_outputs" ADD COLUMN "rebuild_reason" text;--> statement-breakpoint
ALTER TABLE "football_prediction_outputs" ADD COLUMN "last_rebuilt_at" timestamp with time zone;