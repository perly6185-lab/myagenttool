# myagenttool

Personal and small-team Agent Control Plane.

myagenttool is not a place to develop business agents. It is a control plane for
managing, invoking, auditing, and safely exposing agents that already exist.

The core idea is:

- Agent Registry: register local, cloud, HTTP, CLI, MCP, and third-party agents.
- Agent Gateway: provide one unified invocation surface for all registered agents.
- Local Agent Bridge: connect cloud control with agents running on a user's own
  macOS, Windows, or Linux machine without giving the cloud direct machine
  control.
- Agent Lifecycle: discover, install, enable, disable, update, and uninstall
  managed local agents through explicit local bridge actions.
- Agent Integration Builder: turn user intent into reviewable adapter configs,
  recipes, tests, and custom integrations for unsupported agents.
- AI usage governance: route necessary AI calls, meter usage, enforce quotas,
  support billing, and audit model access.
- Agent economics: model external agent costs, revenue, chargeback, budgets,
  and settlement metadata during registration and invocation.
- Deployment flexibility: support SaaS, self-hosted, and private deployment
  models with the same local bridge architecture.
- Policy and risk governance: classify agent capabilities, approval
  requirements, and high-risk actions consistently.
- Developer experience: provide APIs, CLI, SDKs, webhooks, and adapter testing
  tools over time.
- Extension distribution: safely version, review, sign, and distribute
  adapters, recipes, and integration artifacts.
- Operations and alerting: surface device, queue, invocation, quota, and
  security-relevant operational signals.
- Platform agents: expose selected control-plane capabilities as governed
  agents, such as onboarding, troubleshooting, policy review, audit analysis,
  and cost analysis.
- Permission and audit: manage who can call which agent, with what capability,
  from which device, and with what recorded evidence.
- User experience: make the default product understandable for non-professional
  users, with expert controls available through progressive disclosure.
- Idea to outcome: let users describe what they want, then guide them through
  clarification, agent selection or connection, safe execution, and next steps.

## Product Positioning

myagenttool is a personal or small-team version of an agent control plane:

> Register agents, route calls, enforce permission, and record what happened.

It should integrate with existing agents instead of replacing them. Example
targets include coding agents, local automation scripts, MCP servers, HTTP agent
services, workflow systems, and private internal tools.

See [docs/vision/PRODUCT.md](docs/vision/PRODUCT.md) for product scope.

## First Milestone

M0 proves a single remote invocation loop:

1. A user signs in to the web console.
2. One desktop bridge signs in and registers the local device.
3. The user manually registers one CLI or HTTP agent.
4. The user starts from a plain-language task or idea.
5. The web console shows the proposed device, agent, risk, cost, data handling,
   and cancellation behavior.
6. The user invokes the agent from the web console.
7. The cloud gateway sends the invocation request to the desktop bridge.
8. The bridge calls the selected local agent.
9. Logs, status, trace data, and final result are sent back to the cloud console.
10. Queued/offline delivery, cancellation, and device unlink behavior are
    visible and auditable.

See [docs/vision/ROADMAP.md](docs/vision/ROADMAP.md) and
[docs/vision/ACCEPTANCE_CRITERIA.md](docs/vision/ACCEPTANCE_CRITERIA.md) for
the complete milestone definition.

## Planned Modules

```text
apps/
  web/              # Account management, device list, agent list, invocation UI
  server/           # API, auth, registry, gateway, job orchestration, audit
  desktop/          # Local Agent Bridge for discovering and invoking local agents

packages/
  protocol/         # Shared schemas for agents, devices, invocations, events
  adapters/         # CLI, HTTP, MCP, and future A2A adapters
  shared/           # Common utilities and types

docs/
  vision/
    PRODUCT.md
    ROADMAP.md
    ARCHITECTURE.md
    AGENT_PROTOCOL.md
    STATE_MACHINE.md
    AGENT_ADAPTER_MATRIX.md
    INVOCATION_DELIVERY.md
    AGENT_LIFECYCLE.md
    INTEGRATION_BUILDER.md
    AI_BILLING_AUDIT.md
    AGENT_ECONOMICS.md
    ECONOMIC_LEDGER.md
    DEPLOYMENT.md
    DATA_GOVERNANCE.md
    ACCEPTANCE_CRITERIA.md
    USER_EXPERIENCE.md
    IDEA_TO_OUTCOME.md
    POLICY_AND_RISK.md
    DEVELOPER_EXPERIENCE.md
    EXTENSION_DISTRIBUTION.md
    OPERATIONS_ALERTING.md
    PLATFORM_AGENTS.md
    PLATFORM_SUPPORT.md
    SECURITY.md
  engineering/
    AI_CONTEXT.md
    AI_DEVELOPMENT_WORKFLOW.md
    DEFINITION_OF_DONE.md
    AUTOMATION_PLAN.md
    PR_REVIEW_POLICY.md
    LOCAL_DEV_ENV.md
    TEST_STRATEGY.md
    RELEASE_PROCESS.md
    ADR_0001_LOCAL_DEV_STACK.md
    PROJECT_MANAGEMENT.md
    PROJECT_FIELDS.md
    MILESTONES.md
    LABELS.md
    BACKLOG_SEED.md
    GITHUB_SETUP.md
    M0_ISSUE_SEED.md
    ADR_SEED.md
    AI_ENGINEERING_ISSUE_SEED.md
```

The initial pnpm workspace scaffold exists. Most app/package workspaces are
currently placeholders until their M0 implementation issues are started.

## Design Principles

- Do not build business agents in this repository.
- Treat external agents as managed capabilities.
- Design for non-professional users first; expose expert controls gradually.
- Start from user intent and guide toward a safe, observable outcome.
- The cloud can request local work, but the local bridge owns final execution.
- Every invocation should be attributable, cancellable, observable, and auditable.
- Invocation, delivery, cancellation, and unlinking states should have a single
  canonical state machine.
- AI usage should be metered, attributable, quota-aware, and auditable.
- Agent cost, revenue, chargeback, settlement, and AI usage should roll up
  through one economic ledger model.
- Unsupported agent integrations should be generated as reviewable artifacts,
  tested locally, and enabled explicitly.
- Platform-owned agents must use the same registry, gateway, permission,
  metering, and audit path as external agents.
- Protocol compatibility matters: MCP and A2A should be first-class adapter
  targets over time.
- Cross-platform support is a first-class requirement for macOS, Windows, and
  Linux desktop terminals.

## Documentation

- [Product Scope](docs/vision/PRODUCT.md)
- [Roadmap](docs/vision/ROADMAP.md)
- [Architecture](docs/vision/ARCHITECTURE.md)
- [Agent Protocol](docs/vision/AGENT_PROTOCOL.md)
- [State Machine](docs/vision/STATE_MACHINE.md)
- [Agent Adapter Matrix](docs/vision/AGENT_ADAPTER_MATRIX.md)
- [Invocation Delivery](docs/vision/INVOCATION_DELIVERY.md)
- [Agent Lifecycle](docs/vision/AGENT_LIFECYCLE.md)
- [Agent Integration Builder](docs/vision/INTEGRATION_BUILDER.md)
- [AI Usage, Billing, and Audit](docs/vision/AI_BILLING_AUDIT.md)
- [Agent Economics](docs/vision/AGENT_ECONOMICS.md)
- [Economic Ledger](docs/vision/ECONOMIC_LEDGER.md)
- [Deployment Models](docs/vision/DEPLOYMENT.md)
- [Data Governance](docs/vision/DATA_GOVERNANCE.md)
- [Acceptance Criteria](docs/vision/ACCEPTANCE_CRITERIA.md)
- [User Experience](docs/vision/USER_EXPERIENCE.md)
- [Idea to Outcome](docs/vision/IDEA_TO_OUTCOME.md)
- [Policy and Risk](docs/vision/POLICY_AND_RISK.md)
- [Developer Experience](docs/vision/DEVELOPER_EXPERIENCE.md)
- [Extension Distribution](docs/vision/EXTENSION_DISTRIBUTION.md)
- [Operations and Alerting](docs/vision/OPERATIONS_ALERTING.md)
- [Platform Agents](docs/vision/PLATFORM_AGENTS.md)
- [Platform Support](docs/vision/PLATFORM_SUPPORT.md)
- [Security Model](docs/vision/SECURITY.md)

## Engineering Management

The project should be managed through GitHub Issues, Milestones, Projects, Pull
Requests, and lightweight docs automation.

- [AI Context](docs/engineering/AI_CONTEXT.md)
- [AI Development Workflow](docs/engineering/AI_DEVELOPMENT_WORKFLOW.md)
- [Definition of Done](docs/engineering/DEFINITION_OF_DONE.md)
- [Automation Plan](docs/engineering/AUTOMATION_PLAN.md)
- [PR Review Policy](docs/engineering/PR_REVIEW_POLICY.md)
- [Local Development Environment](docs/engineering/LOCAL_DEV_ENV.md)
- [Test Strategy](docs/engineering/TEST_STRATEGY.md)
- [Release Process](docs/engineering/RELEASE_PROCESS.md)
- [ADR 0001: Local Development Stack](docs/engineering/ADR_0001_LOCAL_DEV_STACK.md)
- [Project Management](docs/engineering/PROJECT_MANAGEMENT.md)
- [Project Fields](docs/engineering/PROJECT_FIELDS.md)
- [Milestones](docs/engineering/MILESTONES.md)
- [Labels](docs/engineering/LABELS.md)
- [Backlog Seed](docs/engineering/BACKLOG_SEED.md)
- [GitHub Setup](docs/engineering/GITHUB_SETUP.md)
- [M0 Issue Seed](docs/engineering/M0_ISSUE_SEED.md)
- [ADR Seed](docs/engineering/ADR_SEED.md)
- [AI Engineering Issue Seed](docs/engineering/AI_ENGINEERING_ISSUE_SEED.md)

GitHub issue forms live in `.github/ISSUE_TEMPLATE`, and the pull request
template lives in `.github/PULL_REQUEST_TEMPLATE.md`.

## Local Checks

The initial scaffold includes these local checks:

```text
pnpm repo:check
pnpm docs:check
```

Until dependencies are installed, the underlying PowerShell scripts can be run
directly:

```text
powershell -NoProfile -ExecutionPolicy Bypass -File tools/docs/check-repo-health.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File tools/docs/check-markdown-links.ps1
```

## M0 Local Demo

The repository now includes a local-only M0 demo loop:

```text
pnpm install
pnpm dev
```

After pulling a newer revision, run `pnpm install --frozen-lockfile` again before
starting the app so newly added workspace dependencies are available.

The local demo automatically re-pairs its development-only Desktop Bridge once
when a saved pairing credential has expired. Production pairing still requires
an explicit user action.

Then open:

```text
http://127.0.0.1:5000
```

The demo starts:

- Web Console on `127.0.0.1:5000`
- Server API on `127.0.0.1:5001`
- Desktop Bridge process connected to the local server
- Safe Demo CLI Agent invoked only by the bridge

Automated verification:

```text
pnpm test
pnpm smoke:local
```

The demo proves a narrow local invocation loop: create a task, dispatch it to the
Desktop Bridge, run a harmless local demo agent, stream logs, return a result,
and record an audit summary. It does not implement real accounts, production
auth, arbitrary command execution, billing, or remote cloud dispatch.
