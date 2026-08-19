import { buildEvidenceCenterRecords } from "../read-models/evidence-center.mjs";
import { buildLoopRoutineStateSummary } from "../read-models/loop-routines.mjs";
import { buildPublicState } from "../read-models/state.mjs";

export function createReadModelRuntime({
  namespace,
  protocolVersion,
  state,
  defaultProjectPath,
  currentProject,
  defaultAgent,
  codexApprovalQueue,
  codexSessionForInvocation,
  findInvocation,
  repoPathForEvidence,
  ledgerSummary,
  budgetStatuses,
  teamBudgetStatuses,
  expireCodexApprovalBrokerRequests,
  channelReadiness,
}) {
  function loopRoutineReadModelForCurrentProject() {
    return buildLoopRoutineStateSummary(currentLoopRoutineProjectContext());
  }

  function currentLoopRoutineProjectContext() {
    const project = currentProject();
    const root = project?.path ?? defaultProjectPath;
    return {
      root,
      projectId: project?.id ?? null,
      projectPath: root
    };
  }

  function publicState(actor = null) {
    expireCodexApprovalBrokerRequests();
    return buildPublicState({
      namespace,
      protocolVersion,
      state,
      defaultProjectPath,
      currentProject,
      defaultAgent,
      loopRoutineReadModel: loopRoutineReadModelForCurrentProject,
      codexApprovalQueue,
      evidenceCenterRecords,
      ledgerSummary,
      budgetStatuses,
      teamBudgetStatuses,
      channelReadiness,
      actor,
    });
  }

  function evidenceCenterRecords() {
    return buildEvidenceCenterRecords({
      state,
      findInvocation,
      codexSessionForInvocation,
      repoPathForEvidence,
    });
  }

  return {
    currentLoopRoutineProjectContext,
    evidenceCenterRecords,
    publicState,
  };
}
