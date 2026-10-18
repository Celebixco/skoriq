import { describe, expect, it } from "vitest";
import {
  applyTemperature,
  coverageAtConfidence,
  evaluateCalibration,
  fitTemperatureScaling,
  type FootballCalibrationSample
} from "./football-probability-calibration.js";

function overconfidentSamples(): FootballCalibrationSample[] {
  const samples: FootballCalibrationSample[] = [];
  for (let index = 0; index < 100; index++) {
    samples.push({
      probabilities: { home: 0.9, draw: 0.05, away: 0.05 },
      outcome: index < 60 ? "home" : "away"
    });
  }
  return samples;
}

describe("football probability calibration", () => {
  it("softens overconfident probabilities and improves log loss", () => {
    const samples = overconfidentSamples();
    const temperature = fitTemperatureScaling(samples);
    const raw = evaluateCalibration(samples, 1);
    const calibrated = evaluateCalibration(samples, temperature);

    expect(temperature).toBeGreaterThan(1);
    expect(calibrated.logLoss).toBeLessThan(raw.logLoss);
    expect(calibrated.expectedCalibrationError).toBeLessThan(raw.expectedCalibrationError);
    expect(calibrated.accuracy).toBe(raw.accuracy);
  });

  it("keeps a valid probability distribution after temperature scaling", () => {
    const scaled = applyTemperature({ home: 0.7, draw: 0.2, away: 0.1 }, 2.5);
    expect(scaled.home + scaled.draw + scaled.away).toBeCloseTo(1, 8);
    expect(scaled.home).toBeGreaterThan(scaled.away);
  });

  it("reports coverage and accuracy for a confidence filter", () => {
    const samples = overconfidentSamples();
    const temperature = fitTemperatureScaling(samples);
    const filtered = coverageAtConfidence(samples, temperature, 0.5);

    expect(filtered.selected).toBeLessThanOrEqual(samples.length);
    expect(filtered.coverage).toBeGreaterThanOrEqual(0);
    expect(filtered.coverage).toBeLessThanOrEqual(1);
  });
});
