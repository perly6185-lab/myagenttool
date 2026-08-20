import { getCurrentSession } from "@/lib/api-client";
import { request } from "@/lib/api/request";

export interface PrivateTutorLearner {
  id: string;
  displayName: string;
  grade: string;
  curriculumEditionId: string | null;
  status: "active";
  createdAt: string;
  updatedAt: string;
}

export interface PrivateTutorKnowledgeState {
  id: string;
  mastery: number | null;
  level: "mastered" | "learning" | "needs_support" | "unknown";
  evidenceCount: number;
}

export interface PrivateTutorSnapshot {
  id: string;
  learnerId: string;
  revision: number;
  dailyMinutes: number;
  completedSessions: number;
  independentAnswers: number;
  knowledge: PrivateTutorKnowledgeState[];
  updatedAt: string;
}

export async function listPrivateTutorLearners() {
  const result = await request<{ learners: PrivateTutorLearner[] }>("GET", "/api/private-tutor/learners");
  return result.learners;
}

export async function createPrivateTutorLearner(input: { displayName: string; grade: string }) {
  return request<{ learner: PrivateTutorLearner; snapshot: PrivateTutorSnapshot }>(
    "POST",
    "/api/private-tutor/learners",
    input,
  );
}

export async function getPrivateTutorSnapshot(learnerId: string) {
  return request<{ learner: PrivateTutorLearner; snapshot: PrivateTutorSnapshot }>(
    "GET",
    `/api/private-tutor/learners/${encodeURIComponent(learnerId)}/snapshot`,
  );
}

export async function startPrivateTutorChildMode(learnerId: string, exitPin: string) {
  await request("POST", "/api/private-tutor/child-mode", { learnerId, exitPin });
  return getCurrentSession();
}

export async function exitPrivateTutorChildMode(exitPin: string) {
  await request("POST", "/api/private-tutor/child-mode/exit", { exitPin });
  return getCurrentSession();
}

export async function recordPrivateTutorAttempt(learnerId: string, input: {
  idempotencyKey: string;
  knowledgeId: string;
  questionRevisionId: string;
  correct: boolean;
  independent: boolean;
  usedHint: boolean;
  source: "screen" | "voice_confirmed" | "visual";
  recognitionConfidence?: number;
  durationSeconds: number;
}) {
  return request<{ snapshot: PrivateTutorSnapshot; replayed: boolean }>(
    "POST",
    `/api/private-tutor/learners/${encodeURIComponent(learnerId)}/attempts`,
    input,
  );
}
