export function mockStructuredOutput({ agentName, prompt, issue, title, inferArea, inferPlatform, inferRiskFlags, buildBranchName }) {
  const riskFlags = inferRiskFlags(prompt);
  const area = inferArea(prompt);
  const platform = inferPlatform(prompt);

  if (agentName === "pm-brief") {
    return {
      outcome: "A non-professional user can describe an idea and receive a safe, trackable engineering slice.",
      primaryUser: "Non-professional product user first, with professional controls available as secondary details.",
      problem: "The current workflow still requires engineering knowledge to turn intent into issue-ready work.",
      userStory: "As a user with an idea, I want the system to translate my intent into scoped work so that I can move toward a product outcome without knowing the internal process.",
      nonGoals: ["No production deployment without human approval.", "No hidden local command execution."],
      acceptanceCriteria: [
        "A plain-language idea produces a structured PM brief.",
        "The brief includes risk, platform, area, acceptance, and user outcome fields.",
        "High-risk changes remain gated by explicit human approval.",
      ],
      riskFlags: riskFlags.length > 0 ? riskFlags : ["Review scope, data, cost, and local execution impact manually."],
      projectFields: {
        milestone: "M0",
        area,
        type: "task",
        status: "ready",
        risk: riskFlags.length > 0 ? "high" : "medium",
        acceptance: "defined",
        platform,
        agentTarget: "platform",
        priority: "p1",
        sourceDoc: "docs/engineering/FULL_FLOW_AI_DELIVERY.md",
      },
      productFlow: {
        roleFlow: "ordinary developer",
        scenario: "Turn a plain-language idea into a governed AI development issue.",
        frequency: "medium",
        ownerSurface: "AI intake and issue creation workflow",
        usabilityTask: "Create a trackable issue with acceptance, risk, and Product Flow evidence.",
        whatNotToShow: "Raw provider internals or unreviewed automation details as product-facing proof.",
        partialAcceptanceOrFollowUp: "None for the governed issue creation slice.",
      },
      issueTitle: "[Task]: Model-backed PM brief generation",
      suggestedLabels: [
        "type/task",
        "status/ready",
        `area/${area}`,
        `risk/${riskFlags.length > 0 ? "high" : "medium"}`,
        "acceptance/defined",
        `platform/${platform}`,
        "agent/platform",
        "priority/p1",
      ],
      openQuestions: ["Which provider should be used in production: OpenAI, command adapter, or both?"],
    };
  }

  if (agentName === "code-plan") {
    const issueMatch = prompt.match(/Issue title:\n(.+)/);
    const planTitle = title || issueMatch?.[1]?.trim() || "AI delivery work";
    const expectedBranchMatch = prompt.match(/Expected branch:\n(?:[a-z]+\/)?issue-(\d+)-/);
    const issueNumber = issue ?? expectedBranchMatch?.[1] ?? "0";
    return {
      branch: buildBranchName(issueNumber, planTitle, "feat"),
      summary: "Add a safe AI work runner slice that turns issue context into an implementation plan, review draft, and verification evidence.",
      productFlow: {
        roleFlow: "ordinary developer",
        scenario: "Run an AI-assisted development task from a governed issue.",
        frequency: "medium",
        ownerSurface: "AI development workflow and generated PR evidence",
        usabilityTask: "Confirm generated work is tied to a role, task flow, verification evidence, and follow-up.",
        whatNotToShow: "Raw provider internals or unreviewed automation details as product-facing proof.",
        partialAcceptanceOrFollowUp: "None for this automation slice.",
      },
      affectedSurfaces: ["AI issue tree", "AI code plan", "PR evidence"],
      prototypeStates: ["empty", "running", "succeeded", "failed"],
      acceptanceSignals: [
        "Findable: Product Flow is visible in the code plan and PR body.",
        "Understandable: Reviewer can identify role, scenario, and owner surface.",
        "Actionable: Verification commands and follow-up issues are explicit.",
        "Traceable: Evidence files link code plan, testing plan, scope check, and PR.",
      ],
      whatNotToShow: ["Raw provider internals", "Unreviewed generated work as accepted evidence"],
      visualQaTasks: ["Not applicable for non-Web UI automation changes."],
      filesToTouch: [
        "tools/ai/src/index.mjs",
        "docs/engineering/MODEL_DRIVEN_DELIVERY.md",
        "docs/engineering/FULL_FLOW_AI_DELIVERY.md",
      ],
      steps: [
        "Add model provider abstraction with OpenAI, command, and mock providers.",
        "Add PM, code plan, work runner, and review commands.",
        "Keep mutating operations behind explicit --apply or --comment gates.",
      ],
      commands: ["pnpm ai:check", "pnpm typecheck", "pnpm test"],
      risks: ["Local command execution must remain opt-in.", "Provider output must be structured and reviewable."],
      followUpIssues: ["Add provider-specific eval fixtures before production use."],
      prSummary: "feat: add AI delivery runner MVP",
    };
  }

  if (agentName === "review-pr") {
    return {
      summary: "Mock review found no blocking correctness issue in the provided context.",
      findings: [],
      verificationGaps: [
        "Run the full repository checks and attach output before merge.",
        "Attach visual QA, desktop cancellation, security/data/billing, or release evidence when matching files change.",
      ],
      riskGates: [
        "Security, data, billing/cost, local execution, and release/deploy changes require explicit evidence before merge.",
        "Web UI changes require visual QA screenshot evidence; desktop/local execution changes require cross-platform execution and cancellation evidence.",
        "Human approval is still required for merge, release, billing, local execution, and data retention changes.",
      ],
      approve: false,
    };
  }

  throw new Error(`No mock output for agent ${agentName}.`);
}
