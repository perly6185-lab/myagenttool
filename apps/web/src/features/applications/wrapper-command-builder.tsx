import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Field } from "@/components/common/field";
import { buildNpmWrapperDescriptorDraft } from "@/features/applications/descriptor-utils";

export function NpmWrapperCommandBuilder({
  descriptorText,
  onDescriptorTextChange,
}: {
  descriptorText: string;
  onDescriptorTextChange: (value: string) => void;
}) {
  const [id, setId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [commandType, setCommandType] = useState("npm_script");
  const [command, setCommand] = useState("");
  const [status, setStatus] = useState("approved");
  const [riskLevel, setRiskLevel] = useState("medium");
  const [filePolicy, setFilePolicy] = useState("read_only");
  const [networkPolicy, setNetworkPolicy] = useState("forbidden");
  const [requiresApproval, setRequiresApproval] = useState(true);
  const [feedback, setFeedback] = useState<string | null>(null);

  function applyDraft() {
    const result = buildNpmWrapperDescriptorDraft(descriptorText, {
      id,
      displayName,
      commandType,
      command,
      status,
      riskLevel,
      filePolicy,
      networkPolicy,
      requiresApproval,
    });
    if (result.error) {
      setFeedback(result.error);
      return;
    }
    onDescriptorTextChange(result.text ?? "");
    setFeedback("Command draft applied.");
  }

  return (
    <div className="space-y-3 rounded-md border border-border/70 p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Wrapper command id">
          <Input value={id} onChange={(event) => setId(event.target.value)} placeholder="daily" />
        </Field>
        <Field label="Display name">
          <Input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Daily report" />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Command type">
          <Select value={commandType} onChange={(event) => setCommandType(event.target.value)}>
            <option value="npm_script">npm script</option>
            <option value="bin">binary</option>
            <option value="custom">custom</option>
          </Select>
        </Field>
        <Field label="Command">
          <Input value={command} onChange={(event) => setCommand(event.target.value)} placeholder="daily" />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Status">
          <Select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="approved">approved</option>
            <option value="draft">draft</option>
            <option value="disabled">disabled</option>
          </Select>
        </Field>
        <Field label="Risk">
          <Select value={riskLevel} onChange={(event) => setRiskLevel(event.target.value)}>
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
            <option value="critical">critical</option>
          </Select>
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="File policy">
          <Select value={filePolicy} onChange={(event) => setFilePolicy(event.target.value)}>
            <option value="forbidden">forbidden</option>
            <option value="read_only">read only</option>
            <option value="workspace_write">workspace write</option>
          </Select>
        </Field>
        <Field label="Network policy">
          <Select value={networkPolicy} onChange={(event) => setNetworkPolicy(event.target.value)}>
            <option value="forbidden">forbidden</option>
            <option value="restricted">restricted</option>
            <option value="network">network</option>
          </Select>
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={requiresApproval}
          onChange={(event) => setRequiresApproval(event.target.checked)}
        />
        <span>Requires approval</span>
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" onClick={applyDraft}>
          Apply command draft
        </Button>
        {feedback ? (
          <span className={feedback.endsWith("applied.") ? "text-xs text-success" : "text-xs text-destructive"}>
            {feedback}
          </span>
        ) : null}
      </div>
    </div>
  );
}
