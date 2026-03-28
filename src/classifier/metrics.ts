/**
 * Classifier metrics tracking.
 *
 * Records classification events for monitoring classifier quality,
 * language distribution, and confidence trends.
 */

export interface ClassificationResult {
  isCodingTask: boolean;
  taskType: "coding" | "review" | "planning" | "chat" | "other";
  taskClass: string;
  confidence: number;
  signals: string[];
}

interface ClassificationEvent {
  timestamp: number;
  input: string;
  normalizedInput: string;
  result: ClassificationResult;
}

export interface ClassifierMetrics {
  totalClassifications: number;
  codingDetections: number;
  chatDetections: number;
  otherDetections: number;
  avgConfidence: number;
  languageBreakdown: { uk: number; en: number; mixed: number };
  recentEvents: ClassificationEvent[]; // last 100
}

const MAX_RECENT = 100;

const metrics: ClassifierMetrics = {
  totalClassifications: 0,
  codingDetections: 0,
  chatDetections: 0,
  otherDetections: 0,
  avgConfidence: 0,
  languageBreakdown: { uk: 0, en: 0, mixed: 0 },
  recentEvents: [],
};

/**
 * Detect whether text is primarily Ukrainian, English, or mixed.
 */
function detectLanguage(text: string): "uk" | "en" | "mixed" {
  const lower = text.toLowerCase();
  const cyrillic = /[\u0400-\u04FF]/;
  const latin = /[a-zA-Z]/;
  const hasCyrillic = cyrillic.test(lower);
  const hasLatin = latin.test(lower);

  if (hasCyrillic && hasLatin) return "mixed";
  if (hasCyrillic) return "uk";
  return "en";
}

export function recordClassification(
  input: string,
  normalizedInput: string,
  result: ClassificationResult,
): void {
  metrics.totalClassifications++;

  // Count by task type
  if (result.taskType === "coding") {
    metrics.codingDetections++;
  } else if (result.taskType === "chat") {
    metrics.chatDetections++;
  } else {
    metrics.otherDetections++;
  }

  // Running average confidence
  const prevTotal = metrics.totalClassifications - 1;
  metrics.avgConfidence =
    (metrics.avgConfidence * prevTotal + result.confidence) /
    metrics.totalClassifications;

  // Language breakdown
  const lang = detectLanguage(input);
  metrics.languageBreakdown[lang]++;

  // Recent events (capped)
  metrics.recentEvents.push({
    timestamp: Date.now(),
    input,
    normalizedInput,
    result: { ...result, signals: [...result.signals] },
  });
  if (metrics.recentEvents.length > MAX_RECENT) {
    metrics.recentEvents.shift();
  }
}

export function getMetrics(): ClassifierMetrics {
  return {
    ...metrics,
    languageBreakdown: { ...metrics.languageBreakdown },
    recentEvents: metrics.recentEvents.map((e) => ({
      ...e,
      result: { ...e.result, signals: [...e.result.signals] },
    })),
  };
}

export function resetMetrics(): void {
  metrics.totalClassifications = 0;
  metrics.codingDetections = 0;
  metrics.chatDetections = 0;
  metrics.otherDetections = 0;
  metrics.avgConfidence = 0;
  metrics.languageBreakdown = { uk: 0, en: 0, mixed: 0 };
  metrics.recentEvents = [];
}
