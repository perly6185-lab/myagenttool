import {
  isClaudeAgentCommand,
  isCodexAgentCommand,
  normalizeAgentModel,
} from "@myagenttool/protocol/agent-models";

export function applyAgentModelArgs(args, adapter, selectedModel) {
  const model = normalizeAgentModel(selectedModel);
  const source = Array.isArray(args) ? args.map(String) : [];
  if (!model || (!isCodexAgentCommand(adapter?.command) && !isClaudeAgentCommand(adapter?.command))) {
    return source;
  }
  const cleaned = stripModelArgs(source);
  if (isCodexAgentCommand(adapter?.command)) {
    const execIndex = cleaned.indexOf("exec");
    const insertAt = execIndex >= 0 ? execIndex + 1 : 0;
    cleaned.splice(insertAt, 0, "--model", model);
    return cleaned;
  }
  return ["--model", model, ...cleaned];
}

function stripModelArgs(args) {
  const result = [];
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--model" || value === "-m") {
      index += 1;
      continue;
    }
    if (value.startsWith("--model=") || value.startsWith("-m=")) continue;
    result.push(value);
  }
  return result;
}
