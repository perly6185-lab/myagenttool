// Shared governed-agent identity gate for the fixed-wrapper tools (codex.review,
// codex.exec, claude.review/explain/propose/apply). Every one of these was an
// independent copy of the same seven checks + the same canonical-path lock; a
// forged/overriding agent registration that repoints a governed facade at an
// attacker-controlled script is a local-execution escalation, so this check is
// security-critical and MUST NOT drift between tools. One implementation, one
// place to audit.
//
// A spec is { id, toolName, capabilityName, wrapper, mode }. `mode` is the fixed
// `--mode <value>` the wrapper is pinned to; pass `null` for a single-argument
// wrapper (the apply runner takes no --mode).
export function isGovernedWrapperAgent(agent, { id, toolName, capabilityName, wrapper, mode }) {
  if (!agent) {
    return false;
  }
  const adapterArgs = Array.isArray(agent.adapter?.args) ? agent.adapter.args.map(String) : [];
  return agent.id === id
    && agent.adapter?.type === "cli"
    && String(agent.adapter?.command ?? "") === "node"
    && agent.adapter?.outputFormat === "plain_result"
    && agent.toolContract?.name === toolName
    && (agent.capabilities ?? []).some((capability) => capability?.name === capabilityName)
    && isExactGovernedWrapperArgs(adapterArgs, wrapper, mode);
}

// Match the FULL trailing repo path segment, never a bare basename. A basename
// match (`endsWith("codex-exec-wrapper.mjs")`) would also accept a script at an
// attacker-controlled path (e.g. /tmp/evil/codex-exec-wrapper.mjs) — turning the
// "governed" facade into arbitrary local execution. Wrappers are registered as
// absolute paths, so the trailing `tools/agents/<wrapper>` is the real lock.
export function isExactGovernedWrapperArgs(args, wrapper, mode) {
  const pathOk = (arg) => String(arg ?? "").replaceAll("\\", "/").endsWith(`tools/agents/${wrapper}`);
  if (mode == null) {
    // Single-argument wrapper (e.g. the apply runner): exactly the wrapper path.
    return args.length === 1 && pathOk(args[0]);
  }
  return args.length === 3 && pathOk(args[0]) && args[1] === "--mode" && args[2] === mode;
}
