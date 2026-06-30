import { spawnSync } from "node:child_process";
import https from "node:https";

export async function runStructuredAgent({
  args,
  agentName,
  schema,
  systemPrompt,
  userPrompt,
  repoRoot,
  option,
  commandOutput,
  mockStructuredOutput,
}) {
  const provider = resolveProvider(args, option);
  if (provider === "mock") {
    return mockStructuredOutput({
      agentName,
      schema,
      prompt: userPrompt,
      issue: option(args, "--issue"),
      title: option(args, "--title"),
    });
  }

  const request = {
    agentName,
    schema,
    systemPrompt,
    userPrompt,
    metadata: {
      repository: commandOutput("git", ["remote", "get-url", "origin"]),
      branch: commandOutput("git", ["branch", "--show-current"]),
      head: commandOutput("git", ["rev-parse", "--short", "HEAD"]),
    },
  };

  if (provider === "command") {
    return callCommandProvider(args, request, { option, repoRoot });
  }

  if (provider === "openai") {
    return callOpenAiProvider(args, request, { option });
  }

  throw new Error(`Unsupported provider: ${provider}`);
}

function resolveProvider(args, option) {
  const provider = option(args, "--provider") ?? process.env.MYAGENTTOOL_AI_PROVIDER;
  if (provider) return provider.toLowerCase();
  throw new Error("Missing --provider or MYAGENTTOOL_AI_PROVIDER. Use openai, command, or mock for deterministic validation.");
}

async function callOpenAiProvider(args, request, { option }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is required for --provider openai.");

  const model = option(args, "--model") ?? process.env.OPENAI_MODEL;
  if (!model) throw new Error("OPENAI_MODEL or --model is required for --provider openai so model choice stays auditable.");
  const baseUrl = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
  const url = new URL("/v1/responses", baseUrl.endsWith("/v1") ? baseUrl.slice(0, -3) : baseUrl);
  const body = {
    model,
    input: [
      {
        role: "system",
        content: [{ type: "input_text", text: request.systemPrompt }],
      },
      {
        role: "user",
        content: [{ type: "input_text", text: request.userPrompt }],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: request.schema.name,
        schema: request.schema.schema,
        strict: true,
      },
    },
  };

  const response = await httpsJson(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const outputText = response.output_text ?? extractResponseText(response);
  if (!outputText) {
    throw new Error("OpenAI response did not include output text.");
  }
  return JSON.parse(outputText);
}

function callCommandProvider(args, request, { option, repoRoot }) {
  const command = option(args, "--provider-command") ?? process.env.MYAGENTTOOL_AI_COMMAND;
  if (!command) throw new Error("MYAGENTTOOL_AI_COMMAND or --provider-command is required for --provider command.");

  const result = spawnSync(command, {
    cwd: repoRoot,
    input: `${JSON.stringify(request, null, 2)}\n`,
    encoding: "utf8",
    shell: true,
    stdio: ["pipe", "pipe", "pipe"],
  });

  if (result.status !== 0) {
    throw new Error(`Command provider failed with exit ${result.status}:\n${result.stderr}`);
  }

  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`Command provider did not return valid JSON: ${error.message}\n${result.stdout}`);
  }
}

function extractResponseText(response) {
  const chunks = [];
  for (const item of response.output ?? []) {
    for (const content of item.content ?? []) {
      if (typeof content.text === "string") chunks.push(content.text);
    }
  }
  return chunks.join("\n").trim();
}

function httpsJson(url, options) {
  return new Promise((resolvePromise, reject) => {
    const request = https.request(url, {
      method: options.method,
      headers: options.headers,
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`HTTP ${response.statusCode}: ${text}`));
          return;
        }
        try {
          resolvePromise(JSON.parse(text));
        } catch (error) {
          reject(new Error(`Invalid JSON response: ${error.message}`));
        }
      });
    });
    request.on("error", reject);
    request.write(options.body);
    request.end();
  });
}
