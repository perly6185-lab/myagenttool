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
  expireCodexApprovalBrokerRequests,
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

  function publicState() {
    expireCodexApprovalBrokerRequests();
    return buildPublicState({
      namespace,
      protocolVersion,
      state,
      currentProject,
      defaultAgent,
      loopRoutineReadModel: loopRoutineReadModelForCurrentProject,
      codexApprovalQueue,
      evidenceCenterRecords,
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
