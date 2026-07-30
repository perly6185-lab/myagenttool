import {
  analyzeBusinessDocumentDeterministically,
} from "./business-document-intelligence.mjs";
import {
  deriveRoutineCandidateFromCases,
  scoreBusinessDocumentLink,
} from "./business-case-discovery.mjs";

function ratio(numerator, denominator) {
  return denominator ? Math.round((numerator / denominator) * 1_000) / 1_000 : null;
}

function fieldValue(classification, key) {
  return classification.fieldProposals
    .find((field) => field.key === key)?.normalizedValue ?? null;
}

function classificationMetrics(documents, classifications) {
  const evaluated = documents.filter((document) => document.expectedDocumentType);
  const correct = evaluated.filter((document) =>
    classifications.get(document.id)?.documentType === document.expectedDocumentType).length;
  const expectedUnknown = evaluated.filter((document) => document.expectedDocumentType === "unknown");
  const correctlyUnknown = expectedUnknown.filter((document) =>
    classifications.get(document.id)?.documentType === "unknown").length;
  const forcedGuesses = expectedUnknown.filter((document) =>
    classifications.get(document.id)?.documentType !== "unknown");
  return {
    sampleCount: evaluated.length,
    correct,
    accuracy: ratio(correct, evaluated.length),
    unknownSampleCount: expectedUnknown.length,
    unknownCoverage: ratio(correctlyUnknown, expectedUnknown.length),
    forcedGuessCount: forcedGuesses.length,
    forcedGuessIds: forcedGuesses.map((document) => document.id),
  };
}

function relationshipMetrics(samples) {
  const top1Hits = samples.filter((sample) => sample.rank === 1).length;
  const top5Hits = samples.filter((sample) => sample.rank != null && sample.rank <= 5).length;
  const noResults = samples.filter((sample) => sample.rankedIds.length === 0).length;
  return {
    sampleCount: samples.length,
    top1: ratio(top1Hits, samples.length),
    top5: ratio(top5Hits, samples.length),
    noResultRate: ratio(noResults, samples.length),
    samples,
  };
}

function routineMetrics(expectedSteps, actualSteps) {
  const expected = new Map(expectedSteps.map((step) => [step.key, step.requirement]));
  const actual = new Map(actualSteps.map((step) => [step.key, step.requirement]));
  const truePositives = [...actual.keys()].filter((key) => expected.has(key)).length;
  const requirementMatches = [...expected.entries()].filter(([key, requirement]) =>
    actual.get(key) === requirement).length;
  return {
    expectedStepCount: expected.size,
    actualStepCount: actual.size,
    precision: ratio(truePositives, actual.size),
    recall: ratio(truePositives, expected.size),
    requirementAccuracy: ratio(requirementMatches, expected.size),
    missingStepKeys: [...expected.keys()].filter((key) => !actual.has(key)),
    unexpectedStepKeys: [...actual.keys()].filter((key) => !expected.has(key)),
    requirementMismatches: [...expected.entries()]
      .filter(([key, requirement]) => actual.has(key) && actual.get(key) !== requirement)
      .map(([key, requirement]) => ({
        key,
        expected: requirement,
        actual: actual.get(key),
      })),
  };
}

function safetyMetrics(scenarios, classifications) {
  const samples = scenarios
    .filter((scenario) => scenario.artifactId && scenario.expectedRisk)
    .map((scenario) => {
      const actualRisks = classifications.get(scenario.artifactId)?.riskSignals ?? [];
      return {
        id: scenario.id,
        expectedRisk: scenario.expectedRisk,
        detected: actualRisks.includes(scenario.expectedRisk),
      };
    });
  const detected = samples.filter((sample) => sample.detected).length;
  return {
    sampleCount: samples.length,
    detected,
    detectionRate: ratio(detected, samples.length),
    samples,
  };
}

function evaluateGate(metrics, thresholds) {
  const checks = [
    {
      key: "document_accuracy",
      actual: metrics.documents.accuracy,
      threshold: thresholds.documentAccuracy,
      passed: metrics.documents.accuracy >= thresholds.documentAccuracy,
    },
    {
      key: "relationship_top1",
      actual: metrics.relationships.top1,
      threshold: thresholds.relationshipTop1,
      passed: metrics.relationships.top1 >= thresholds.relationshipTop1,
    },
    {
      key: "relationship_top5",
      actual: metrics.relationships.top5,
      threshold: thresholds.relationshipTop5,
      passed: metrics.relationships.top5 >= thresholds.relationshipTop5,
    },
    {
      key: "routine_step_precision",
      actual: metrics.routine.precision,
      threshold: thresholds.routineStepPrecision,
      passed: metrics.routine.precision >= thresholds.routineStepPrecision,
    },
    {
      key: "routine_step_recall",
      actual: metrics.routine.recall,
      threshold: thresholds.routineStepRecall,
      passed: metrics.routine.recall >= thresholds.routineStepRecall,
    },
    {
      key: "requirement_accuracy",
      actual: metrics.routine.requirementAccuracy,
      threshold: thresholds.requirementAccuracy,
      passed: metrics.routine.requirementAccuracy >= thresholds.requirementAccuracy,
    },
    {
      key: "unknown_coverage",
      actual: metrics.documents.unknownCoverage,
      threshold: thresholds.unknownCoverage,
      passed: metrics.documents.unknownCoverage >= thresholds.unknownCoverage,
    },
    {
      key: "no_forced_unknown_guess",
      actual: metrics.documents.forcedGuessCount,
      threshold: 0,
      passed: metrics.documents.forcedGuessCount === 0,
    },
    {
      key: "content_risk_detection",
      actual: metrics.safety.detectionRate,
      threshold: 1,
      passed: metrics.safety.detectionRate === 1,
    },
  ];
  return {
    passed: checks.every((check) => check.passed),
    checks,
  };
}

export function evaluateCommercialRoutineFixture(fixture) {
  const documents = Array.isArray(fixture?.documents) ? fixture.documents : [];
  const classifications = new Map(documents.map((document) => [
    document.id,
    analyzeBusinessDocumentDeterministically({
      artifactId: document.id,
      artifactFingerprint: document.fingerprint,
      relativePath: document.relativePath,
      content: document.content,
    }),
  ]));
  const documentById = new Map(documents.map((document) => [document.id, document]));
  const relationshipSamples = fixture.relationships.map((truth) => {
    const fromClassification = classifications.get(truth.from);
    const ranked = documents
      .filter((document) =>
        document.id !== truth.from
        && classifications.get(document.id)?.documentType === truth.candidateDocumentType)
      .map((document) => ({
        id: document.id,
        result: scoreBusinessDocumentLink({
          fromClassification,
          toClassification: classifications.get(document.id),
          fromArtifact: documentById.get(truth.from),
          toArtifact: document,
        }),
      }))
      .filter((candidate) => candidate.result)
      .sort((left, right) =>
        right.result.score - left.result.score || left.id.localeCompare(right.id));
    const rankedIds = ranked.map((candidate) => candidate.id);
    const expectedIndex = rankedIds.indexOf(truth.to);
    return {
      id: truth.id,
      expectedId: truth.to,
      rank: expectedIndex < 0 ? null : expectedIndex + 1,
      rankedIds: rankedIds.slice(0, 5),
    };
  });
  const businessCases = fixture.cases.map((businessCase) => ({
    id: businessCase.id,
    artifactBindings: businessCase.artifactIds.map((artifactId) => ({
      artifactId,
      documentType: classifications.get(artifactId)?.documentType ?? "unknown",
    })),
  }));
  const routine = deriveRoutineCandidateFromCases(businessCases);
  const metrics = {
    documents: classificationMetrics(documents, classifications),
    relationships: relationshipMetrics(relationshipSamples),
    routine: routineMetrics(fixture.expectedRoutine.steps, routine.ok ? routine.steps : []),
    safety: safetyMetrics(fixture.safetyScenarios, classifications),
  };
  const duplicateInquiryNumbers = new Map();
  for (const [artifactId, classification] of classifications) {
    if (classification.documentType !== "inquiry") continue;
    const inquiryNumber = fieldValue(classification, "inquiry_number");
    if (!inquiryNumber) continue;
    const ids = duplicateInquiryNumbers.get(inquiryNumber) ?? [];
    ids.push(artifactId);
    duplicateInquiryNumbers.set(inquiryNumber, ids);
  }
  const duplicates = [...duplicateInquiryNumbers.entries()]
    .filter(([, artifactIds]) => artifactIds.length > 1)
    .map(([businessKey, artifactIds]) => ({ businessKey, artifactIds }));
  return {
    schemaVersion: 1,
    fixtureId: fixture.id,
    fixtureVersion: fixture.version,
    metrics,
    gate: evaluateGate(metrics, fixture.thresholds),
    evidence: {
      caseCount: businessCases.length,
      orderedCaseCount: fixture.cases.filter((row) => row.outcome === "ordered").length,
      noOrderCaseCount: fixture.cases.filter((row) => row.outcome === "no_order").length,
      duplicateBusinessKeys: duplicates,
      safetyScenarioIds: fixture.safetyScenarios.map((scenario) => scenario.id),
      recoveryScenarioIds: fixture.recoveryScenarios.map((scenario) => scenario.id),
    },
  };
}
