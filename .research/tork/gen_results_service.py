# -*- coding: utf-8 -*-
"""Regenerate the Tork results service from the WORKING H1 service with a
single ordered mechanical transform (no piecemeal replaces)."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
src = (ROOT / "apps/api/src/routes/football-h1-results.service.ts").read_text(encoding="utf-8")

repl = [
    # tables / model
    ("football_h1_prematch_predictions", "football_tork_prematch_predictions"),
    ("football_h1_prematch_results", "football_tork_prematch_results"),
    ("H1-A", "TORK-A"),
    # sql columns
    ("p.p_goal", "p.p_btts"),
    ("r.halftime_status", "r.fulltime_status"),
    ("'verified_halftime'", "'verified_normal_time'"),
    # types & identifiers (longest first)
    ("FootballH1ResultsService", "FootballTorkResultsService"),
    ("H1ResultStatus", "TorkResultStatus"),
    ("H1ResultsFilters", "TorkResultsFilters"),
    ("H1PredictionResultItem", "TorkPredictionResultItem"),
    ("H1PredictionResultsResponse", "TorkPredictionResultsResponse"),
    ("H1PredictionResultsSummary", "TorkPredictionResultsSummary"),
    ("H1ResultRow", "TorkResultRow"),
    ("resolveH1SettlementStatus", "resolveTorkSettlementStatus"),
    ("p_goal: string | number;", "p_btts: string | number;"),
    ("halftime_status: string | null;", "fulltime_status: string | null;"),
    # market semantics
    ('marketType: "first_half_over_0_5"', 'marketType: "btts"'),
    ('selection: "over_0_5" | "under_0_5"', 'selection: "btts_yes" | "btts_no"'),
    ('pick: "over_0_5" | "under_0_5";', 'pick: "btts_yes" | "btts_no";'),
    ('result_label: "over_0_5" | "under_0_5" | null;', 'result_label: "btts_yes" | "btts_no" | null;'),
    ('row.pick === "over_0_5" ? "İlk yarıda gol var" : "İlk yarıda gol yok"',
     'row.pick === "btts_yes" ? "Her iki takım da gol atar" : "Karşılıklı gol yok"'),
    # labels / copy
    ('const MODEL_LABEL = "Volt";', 'const MODEL_LABEL = "Tork";'),
    ("H1_PREMATCH_ENABLED", "TORK_PREMATCH_ENABLED"),
    ("İlk yarı gol tahminleri geçici olarak kapalı.", "Karşılıklı gol tahminleri geçici olarak kapalı."),
    ("`İlk yarı skoru ${halftimeScore ?? \"?\"}: tahmin tuttu.`", "`Maç sonucu ${normalTimeScore ?? \"?\"}: tahmin tuttu.`"),
    ("`İlk yarı skoru ${halftimeScore ?? \"?\"}: tahmin tutmadı.`", "`Maç sonucu ${normalTimeScore ?? \"?\"}: tahmin tutmadı.`"),
    ('"İlk yarı skoru doğrulanamadığı için tahmin değerlendirilemedi."', '"Normal süre skoru doğrulanamadığı için tahmin değerlendirilemedi."'),
    ("const normalTimeScore = scoreLabel(row.home_score_90, row.away_score_90);",
     "const normalTimeScore = scoreLabel(row.home_score_fulltime, row.away_score_fulltime);"),
    ("explanation: settlementExplanation(status, halftimeScore)",
     "explanation: settlementExplanation(status, scoreLabel(row.home_score_fulltime, row.away_score_fulltime))"),
]

out = src
for a, b in repl:
    out = out.replace(a, b)

# H1 row has no home_score_90 member; Tork reuses fulltime scores from fs columns (already in select)
dst = ROOT / "apps/api/src/routes/football-tork-results.service.ts"
dst.write_text(out, encoding="utf-8")
print("tork results service yeniden üretildi:", len(out), "bayt")
