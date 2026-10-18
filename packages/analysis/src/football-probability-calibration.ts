export type FootballOutcome = "home" | "draw" | "away";

export interface FootballCalibrationSample {
  probabilities: { home: number; draw: number; away: number };
  outcome: FootballOutcome;
}

export interface FootballCalibrationBucket {
  bucket: string;
  count: number;
  accuracy: number;
  averageConfidence: number;
}

export interface FootballCalibrationReport {
  samples: number;
  temperature: number;
  logLoss: number;
  brierScore: number;
  expectedCalibrationError: number;
  buckets: FootballCalibrationBucket[];
  accuracy: number;
}

const OUTCOME_INDEX: Record<FootballOutcome, number> = { home: 0, draw: 1, away: 2 };

/**
 * Temperature scaling for a three-way 1X2 distribution.
 *
 * The model is deliberately conservative: a temperature below 1 is allowed but
 * the grid starts at 0.5, and the selected value must reduce out-of-sample log
 * loss. This is calibration, not a new prediction model.
 */
export function fitTemperatureScaling(samples: readonly FootballCalibrationSample[], options: { min?: number; max?: number; step?: number } = {}): number {
  const clean = samples.filter(validSample);
  if (clean.length < 20) return 1;
  const min = options.min ?? 0.5;
  const max = options.max ?? 5;
  const step = options.step ?? 0.05;
  let bestTemperature = 1;
  let bestLoss = Number.POSITIVE_INFINITY;
  for (let temperature = min; temperature <= max + 1e-9; temperature += step) {
    const loss = logLoss(clean, temperature);
    if (loss < bestLoss - 1e-9) {
      bestLoss = loss;
      bestTemperature = temperature;
    }
  }
  return round(bestTemperature, 2);
}

export function applyTemperature(
  probabilities: { home: number; draw: number; away: number },
  temperature: number
): { home: number; draw: number; away: number } {
  const safeTemperature = Math.max(0.05, temperature);
  const logits = [probabilities.home, probabilities.draw, probabilities.away].map((probability) => Math.log(Math.max(1e-12, probability)) / safeTemperature);
  const maximum = Math.max(...logits);
  const exponentials = logits.map((logit) => Math.exp(logit - maximum));
  const total = exponentials.reduce((sum, value) => sum + value, 0);
  return {
    home: exponentials[0]! / total,
    draw: exponentials[1]! / total,
    away: exponentials[2]! / total
  };
}

export interface RollingCalibrationReport {
  windowSize: number;
  evaluations: number;
  latestTemperature: number;
  minTemperature: number;
  maxTemperature: number;
  report: FootballCalibrationReport;
  coverage: Array<{ threshold: number; coverage: number; selected: number; accuracy: number }>;
}

/**
 * Walk-forward temperature scaling. Each evaluation sample is calibrated using
 * only earlier predictions, so the reported ECE is not fitted on its own test
 * data. The window can move as the season changes.
 */
export function evaluateRollingCalibration(
  samples: readonly FootballCalibrationSample[],
  options: { windowSize?: number; refitEvery?: number } = {}
): RollingCalibrationReport {
  const clean = samples.filter(validSample);
  const windowSize = Math.max(20, options.windowSize ?? 200);
  const refitEvery = Math.max(1, options.refitEvery ?? 10);
  const calibrated: FootballCalibrationSample[] = [];
  const temperatures: number[] = [];
  let temperature = 1;
  for (let index = windowSize; index < clean.length; index++) {
    if ((index - windowSize) % refitEvery === 0) {
      temperature = fitTemperatureScaling(clean.slice(index - windowSize, index));
      temperatures.push(temperature);
    }
    const sample = clean[index]!;
    calibrated.push({ probabilities: applyTemperature(sample.probabilities, temperature), outcome: sample.outcome });
  }
  const report = evaluateCalibration(calibrated, 1);
  return {
    windowSize,
    evaluations: calibrated.length,
    latestTemperature: temperature,
    minTemperature: temperatures.length ? Math.min(...temperatures) : 1,
    maxTemperature: temperatures.length ? Math.max(...temperatures) : 1,
    report,
    coverage: [0.5, 0.6, 0.7, 0.8].map((threshold) => coverageAtConfidence(calibrated, 1, threshold))
  };
}

export interface ConfidenceSample {
  confidence: number;
  correct: boolean;
}

export interface IsotonicPoint {
  confidence: number;
  probability: number;
  weight: number;
}

export interface RollingIsotonicReport {
  windowSize: number;
  evaluations: number;
  latestPoints: number;
  expectedCalibrationError: number;
  coverage: Array<{ threshold: number; coverage: number; selected: number; accuracy: number }>;
}

/**
 * Pool-adjacent-violators isotonic regression. It maps a model's stated
 * confidence to the observed hit rate while preserving monotonicity. The
 * mapping is only used for confidence filtering; class probabilities remain
 * untouched.
 */
export function fitIsotonic(samples: readonly ConfidenceSample[]): IsotonicPoint[] {
  const sorted = samples
    .filter((sample) => Number.isFinite(sample.confidence) && sample.confidence > 0 && sample.confidence <= 1)
    .map((sample) => ({ confidence: sample.confidence, probability: sample.correct ? 1 : 0, weight: 1 }))
    .sort((left, right) => left.confidence - right.confidence);
  if (sorted.length < 10) return [];
  const blocks: IsotonicPoint[] = [];
  for (const sample of sorted) {
    blocks.push({ ...sample });
    while (blocks.length >= 2) {
      const previous = blocks[blocks.length - 2]!;
      const current = blocks[blocks.length - 1]!;
      if (previous.probability <= current.probability) break;
      blocks.splice(blocks.length - 2, 2, {
        confidence: (previous.confidence * previous.weight + current.confidence * current.weight) / (previous.weight + current.weight),
        probability: (previous.probability * previous.weight + current.probability * current.weight) / (previous.weight + current.weight),
        weight: previous.weight + current.weight
      });
    }
  }
  return blocks;
}

export function applyIsotonic(points: readonly IsotonicPoint[], confidence: number): number {
  if (points.length === 0) return confidence;
  if (confidence <= points[0]!.confidence) return points[0]!.probability;
  const last = points[points.length - 1]!;
  if (confidence >= last.confidence) return last.probability;
  for (let index = 1; index < points.length; index++) {
    const right = points[index]!;
    if (confidence > right.confidence) continue;
    const left = points[index - 1]!;
    const width = right.confidence - left.confidence;
    if (width <= 0) return right.probability;
    const ratio = (confidence - left.confidence) / width;
    return left.probability + (right.probability - left.probability) * ratio;
  }
  return last.probability;
}

export function evaluateRollingIsotonic(
  samples: readonly FootballCalibrationSample[],
  options: { windowSize?: number; refitEvery?: number } = {}
): RollingIsotonicReport {
  const clean = samples.filter(validSample);
  const confidenceSamples = clean.map(toConfidenceSample);
  const windowSize = Math.max(20, options.windowSize ?? 200);
  const refitEvery = Math.max(1, options.refitEvery ?? 10);
  let points: IsotonicPoint[] = [];
  const calibrated: ConfidenceSample[] = [];
  for (let index = windowSize; index < confidenceSamples.length; index++) {
    if ((index - windowSize) % refitEvery === 0) {
      points = fitIsotonic(confidenceSamples.slice(index - windowSize, index));
    }
    const sample = confidenceSamples[index]!;
    calibrated.push({ confidence: applyIsotonic(points, sample.confidence), correct: sample.correct });
  }
  return {
    windowSize,
    evaluations: calibrated.length,
    latestPoints: points.length,
    expectedCalibrationError: confidenceEce(calibrated),
    coverage: [0.5, 0.6, 0.7, 0.8].map((threshold) => confidenceCoverage(calibrated, threshold))
  };
}

export function evaluateCalibration(
  samples: readonly FootballCalibrationSample[],
  temperature = 1
): FootballCalibrationReport {
  const clean = samples.filter(validSample);
  if (clean.length === 0) {
    return { samples: 0, temperature, logLoss: 0, brierScore: 0, expectedCalibrationError: 0, buckets: [], accuracy: 0 };
  }
  let losses = 0;
  let brier = 0;
  let correct = 0;
  const buckets = new Map<string, { count: number; correct: number; confidenceSum: number }>();
  for (const sample of clean) {
    const probabilities = applyTemperature(sample.probabilities, temperature);
    const probabilityByOutcome = [probabilities.home, probabilities.draw, probabilities.away];
    const actualIndex = OUTCOME_INDEX[sample.outcome];
    const predictedIndex = probabilityByOutcome.indexOf(Math.max(...probabilityByOutcome));
    const confidence = probabilityByOutcome[predictedIndex]!;
    losses += -Math.log(Math.max(1e-12, probabilityByOutcome[actualIndex]!));
    brier += probabilityByOutcome.reduce((sum, probability, index) => sum + (probability - (index === actualIndex ? 1 : 0)) ** 2, 0);
    const isCorrect = predictedIndex === actualIndex;
    correct += isCorrect ? 1 : 0;
    const key = bucketKey(confidence);
    const bucket = buckets.get(key) ?? { count: 0, correct: 0, confidenceSum: 0 };
    bucket.count += 1;
    bucket.correct += isCorrect ? 1 : 0;
    bucket.confidenceSum += confidence;
    buckets.set(key, bucket);
  }
  const bucketReports = [...buckets.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([bucket, value]) => ({
      bucket,
      count: value.count,
      accuracy: round(value.correct / value.count, 4),
      averageConfidence: round(value.confidenceSum / value.count, 4)
    }));
  const ece = bucketReports.reduce((sum, bucket) => sum + (bucket.count / clean.length) * Math.abs(bucket.accuracy - bucket.averageConfidence), 0);
  return {
    samples: clean.length,
    temperature,
    logLoss: round(losses / clean.length, 4),
    brierScore: round(brier / clean.length, 4),
    expectedCalibrationError: round(ece, 4),
    buckets: bucketReports,
    accuracy: round(correct / clean.length, 4)
  };
}

export function coverageAtConfidence(
  samples: readonly FootballCalibrationSample[],
  temperature: number,
  threshold: number
): { threshold: number; coverage: number; selected: number; accuracy: number } {
  const clean = samples.filter(validSample);
  let selected = 0;
  let correct = 0;
  for (const sample of clean) {
    const probabilities = applyTemperature(sample.probabilities, temperature);
    const probabilityByOutcome = [probabilities.home, probabilities.draw, probabilities.away];
    const predictedIndex = probabilityByOutcome.indexOf(Math.max(...probabilityByOutcome));
    const confidence = probabilityByOutcome[predictedIndex]!;
    if (confidence < threshold) continue;
    selected += 1;
    correct += predictedIndex === OUTCOME_INDEX[sample.outcome] ? 1 : 0;
  }
  return {
    threshold,
    coverage: clean.length ? round(selected / clean.length, 4) : 0,
    selected,
    accuracy: selected ? round(correct / selected, 4) : 0
  };
}

function logLoss(samples: readonly FootballCalibrationSample[], temperature: number): number {
  let loss = 0;
  for (const sample of samples) {
    const probabilities = applyTemperature(sample.probabilities, temperature);
    const probability = [probabilities.home, probabilities.draw, probabilities.away][OUTCOME_INDEX[sample.outcome]]!;
    loss += -Math.log(Math.max(1e-12, probability));
  }
  return loss / samples.length;
}

function validSample(sample: FootballCalibrationSample): boolean {
  const values = [sample.probabilities.home, sample.probabilities.draw, sample.probabilities.away];
  return values.every((value) => Number.isFinite(value) && value > 0 && value <= 1);
}

function toConfidenceSample(sample: FootballCalibrationSample): ConfidenceSample {
  const probabilities = [sample.probabilities.home, sample.probabilities.draw, sample.probabilities.away];
  const predictedIndex = probabilities.indexOf(Math.max(...probabilities));
  return {
    confidence: probabilities[predictedIndex]!,
    correct: predictedIndex === OUTCOME_INDEX[sample.outcome]
  };
}

function confidenceEce(samples: readonly ConfidenceSample[]): number {
  if (samples.length === 0) return 0;
  const bins = new Map<string, { count: number; correct: number; confidenceSum: number }>();
  for (const sample of samples) {
    const key = bucketKey(sample.confidence);
    const bin = bins.get(key) ?? { count: 0, correct: 0, confidenceSum: 0 };
    bin.count += 1;
    bin.correct += sample.correct ? 1 : 0;
    bin.confidenceSum += sample.confidence;
    bins.set(key, bin);
  }
  return round(
    [...bins.values()].reduce((sum, bin) => sum + (bin.count / samples.length) * Math.abs(bin.correct / bin.count - bin.confidenceSum / bin.count), 0),
    4
  );
}

function confidenceCoverage(
  samples: readonly ConfidenceSample[],
  threshold: number
): { threshold: number; coverage: number; selected: number; accuracy: number } {
  const selected = samples.filter((sample) => sample.confidence >= threshold);
  return {
    threshold,
    coverage: samples.length ? round(selected.length / samples.length, 4) : 0,
    selected: selected.length,
    accuracy: selected.length ? round(selected.filter((sample) => sample.correct).length / selected.length, 4) : 0
  };
}

function bucketKey(confidence: number): string {
  const lower = Math.min(0.9, Math.floor(confidence * 10) / 10);
  return `${lower.toFixed(1)}-${(lower + 0.1).toFixed(1)}`;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
