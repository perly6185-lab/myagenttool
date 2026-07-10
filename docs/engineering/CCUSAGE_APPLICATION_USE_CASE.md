# ccusage Application Use Case

Status: implemented

Audience: product readers, API consumers, operators, and engineers who need to
understand why `ccusage` belongs in the Application system and how the system
uses it.

## Reader Summary

`ccusage` is the reference Application use case for an npm-delivered utility
inside myagenttool.

The important idea is simple:

```text
npm package -> managed Application -> governed report capability -> imported result
```

Instead of treating every ccusage report as a separate agent, myagenttool
registers `ccusage` once as the `app_ccusage` Application. The Application then
projects its report commands as governed capabilities, executes them through the
platform Application Wrapper Runner, and imports the report rows into the normal
result and evidence views.

External callers can keep using the stable tool facade:

```http
POST /api/tools/ccusage.report/invocations
```

Governed Application-aware callers can also discover the underlying Application
capabilities through:

```http
GET /api/capabilities?providerType=application
GET /api/applications/app_ccusage/capabilities
```

## 5 Minute Product Path

Use this path when you want to experience the scenario before reading the full
system explanation.

1. Start the local stack:

   ```bash
   pnpm dev
   ```

2. Register the reference Application:

   ```bash
   pnpm ccusage:register-app
   ```

3. Open the ccusage Application detail:

   ```text
   http://127.0.0.1:5000/?section=applications&application=app_ccusage
   ```

4. In `ccusage operation case`, confirm step 1 shows projected wrapper report
   capabilities.

5. Click `Run daily report`.

6. Click `View created invocation` or `View latest invocation`.

Expected result: the Web Console keeps you inside the same closed loop:

```text
Discover governed report capabilities
  -> Run ccusage.report
  -> Inspect invocation and importedUsageEstimates evidence
```

If the UI shows `Wrapper setup needed`, the Application is registered but the
local wrapper readiness check is not satisfied. Confirm that the ccusage wrapper
runner is installed and re-register or refresh the Application before expecting
real wrapper execution. The offline demo request still demonstrates the stable
facade payload and invocation tracking path when the local stack supports it.

## The User Scenario

A team wants a repeatable way to inspect observed usage estimates from the
installed `ccusage` npm CLI. They do not want every caller to know local binary
paths, wrapper scripts, working directories, environment variables, or raw CLI
arguments.

The desired experience is:

1. Register the ccusage package as a managed Application.
2. Discover the available reports as governed capabilities.
3. Invoke a report through a stable API contract.
4. Track the invocation through the normal audit and state model.
5. Find imported rows in `importedUsageEstimates`, the Application latest
   result, the invocation, and Evidence Center.

## Hands-on Walkthrough

This walkthrough turns the system capabilities into a directly operable local
case. It assumes the local demo stack is running:

```bash
pnpm dev
```

The local demo prints the Web Console and Server API URLs. By default they are:

```text
Web Console: http://127.0.0.1:5000
Server API:  http://127.0.0.1:5001
```

Use the server URL from your own run when it differs:

```bash
BASE_URL=http://127.0.0.1:5001
TOKEN=<token-if-auth-is-enabled>
```

PowerShell equivalent:

```powershell
$env:BASE_URL = "http://127.0.0.1:5001"
$env:TOKEN = "<token-if-auth-is-enabled>"
```

If local auth is disabled, omit the `Authorization` header from the `curl`
examples below.

### 1. Confirm The Server Is Up

```bash
curl -s "$BASE_URL/health"
```

Expected result: the server returns a health response. This proves the API
surface is reachable before registering the Application.

### 2. Register ccusage As An Application

```bash
MYAGENTTOOL_SERVER_URL="$BASE_URL" pnpm ccusage:register-app
```

PowerShell equivalent:

```powershell
$env:MYAGENTTOOL_SERVER_URL = $env:BASE_URL
pnpm ccusage:register-app
```

Expected result:

```text
[ccusage] registered application app_ccusage: ccusage (npm 20.0.16, 6 report capabilities)
```

System capability demonstrated: Application asset management. One npm package
is now represented as one managed Application.

### 3. Discover The Application Capabilities

```bash
curl -s "$BASE_URL/api/applications/app_ccusage/capabilities" \
  -H "Authorization: Bearer $TOKEN"
```

Expected result: the response includes wrapper capabilities such as:

```text
app.app_ccusage.wrapper.daily
app.app_ccusage.wrapper.weekly
app.app_ccusage.wrapper.monthly
app.app_ccusage.wrapper.session
app.app_ccusage.wrapper.codex_daily
app.app_ccusage.wrapper.claude_daily
```

System capability demonstrated: capability projection. The API exposes
reviewed, invokable contracts without exposing local wrapper paths or raw CLI
commands.

### 4. Invoke The Stable Tool Facade

```bash
curl -s -X POST "$BASE_URL/api/tools/ccusage.report/invocations" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  --data '{
    "report": "daily",
    "source": "all",
    "since": "2026-07-01",
    "until": "2026-07-02",
    "timezone": "Asia/Shanghai",
    "offline": true,
    "projectId": "prj_local"
  }'
```

Expected result:

```json
{
  "tool": "ccusage.report",
  "invocationId": "inv_123",
  "agentId": "agt_platform_application_wrapper",
  "status": "queued",
  "outputCollection": "importedUsageEstimates"
}
```

Save the returned `invocationId`. System capability demonstrated: stable
compatibility facade. The caller uses the familiar tool API while the backing
execution goes through the Application wrapper path.

### 5. Follow The Invocation And Result

```bash
curl -s "$BASE_URL/api/state" \
  -H "Authorization: Bearer $TOKEN"
```

In the response, find:

```text
invocations[].id == <invocationId>
importedUsageEstimates[].reportInvocationId == <invocationId>
applications[].id == app_ccusage
applications[].latestResult
```

System capability demonstrated: result import and evidence linkage. The same
run can be followed through invocation state, imported usage estimates,
Application latest result, audit summary, and Evidence Center.

### 6. Invoke The Application Capability Directly

Use this only when you intentionally want the Application capability surface:

```bash
curl -s -X POST "$BASE_URL/api/capabilities/app.app_ccusage.wrapper.daily/invocations" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  --data '{
    "since": "2026-07-01",
    "until": "2026-07-02",
    "timezone": "Asia/Shanghai",
    "projectId": "prj_local"
  }'
```

Expected result: a queued invocation backed by
`agt_platform_application_wrapper`, with results imported into the same
`importedUsageEstimates` collection.

System capability demonstrated: direct Application capability invocation with
validated descriptor-declared inputs.

### 7. Inspect In The Web Console

Open the ccusage Application detail directly:

```text
http://127.0.0.1:5000/?section=applications&application=app_ccusage
```

Then use the `ccusage operation case` checklist:

- Step 1 confirms wrapper report capabilities are projected.
- Step 2 runs the stable `ccusage.report` facade.
- Step 3 links to the created or latest invocation and shows imported result
  evidence when available.

You can also inspect the broader product surfaces:

- Applications list: find `ccusage`.
- Application detail: verify readiness, wrapper commands, and latest result.
- Invocations view: open the report invocation.
- Evidence Center: verify imported `usage_estimate` evidence.

This is the operator-facing proof that the Application loop is closed:

```text
register -> discover -> invoke -> import -> inspect
```

## What Gets Registered

The canonical registration creates:

```text
Application id: app_ccusage
Source:         npm package ccusage@20.0.16
Wrapper mode:   installed-wrapper
Runner:         agt_platform_application_wrapper
```

It publishes six report wrapper capabilities:

```text
app.app_ccusage.wrapper.daily
app.app_ccusage.wrapper.weekly
app.app_ccusage.wrapper.monthly
app.app_ccusage.wrapper.session
app.app_ccusage.wrapper.codex_daily
app.app_ccusage.wrapper.claude_daily
```

Each capability is projected from reviewed Application metadata. Discovery
responses expose the public contract, not the local wrapper implementation.

## How To Register It

Use the repo script when the server is running:

```bash
pnpm ccusage:register-app
```

Equivalent direct command:

```bash
node tools/dev/register-ccusage-application.mjs \
  --server-url http://127.0.0.1:5001 \
  --version 20.0.16
```

Add `--online` only when the operator intentionally wants the Application moved
online during registration.

If `ccusage.report` is requested before the Application exists, the tool surface
returns `application_not_available` with guidance to run
`pnpm ccusage:register-app`.

## Common Setup And Failure States

`Wrapper setup needed`

The Application exists, but the local wrapper readiness check has not passed.
Confirm the package, wrapper runner, and local server state, then refresh or
re-register the Application.

`application_not_available`

The stable facade was called before `app_ccusage` existed. Run
`pnpm ccusage:register-app`, then retry.

`agent_not_available`

The Application exists, but the Desktop Bridge or the platform Application
Wrapper Runner is not available. Start the full local stack with `pnpm dev`, or
confirm the Desktop Bridge is online and the `agt_platform_application_wrapper`
agent is registered before retrying.

`application_wrapper_policy_consent_required`

The wrapper descriptor requires explicit policy consent before execution. Grant
consent from the Application detail screen, then retry the invocation.

No imported rows after a queued run

Open the invocation and audit summary first. If the invocation did not complete,
fix that execution issue before looking for `importedUsageEstimates`. If it did
complete, join imported rows by `reportInvocationId == <invocationId>`.

## Calling The Stable Tool Facade

Most external consumers should use the stable tool facade:

```http
POST /api/tools/ccusage.report/invocations
Content-Type: application/json
Authorization: Bearer <token>

{
  "report": "daily",
  "source": "all",
  "since": "2026-07-01",
  "until": "2026-07-02",
  "timezone": "Asia/Shanghai",
  "offline": true,
  "projectId": "prj_local"
}
```

Successful creation returns a normal queued invocation:

```json
{
  "tool": "ccusage.report",
  "invocationId": "inv_123",
  "agentId": "agt_platform_application_wrapper",
  "status": "queued",
  "outputCollection": "importedUsageEstimates"
}
```

After creation, poll `GET /api/state`, find the invocation by `invocationId`,
then read `importedUsageEstimates` rows whose `reportInvocationId` matches that
invocation.

The `agentId` is informational. Consumers should join results by
`invocationId` and `outputCollection`, not by the backing runner identity.

## Calling The Application Capability Directly

Application-aware consumers can intentionally invoke a projected capability:

```http
POST /api/capabilities/app.app_ccusage.wrapper.daily/invocations
Content-Type: application/json
Authorization: Bearer <token>

{
  "since": "2026-07-01",
  "until": "2026-07-02",
  "timezone": "Asia/Shanghai",
  "projectId": "prj_local"
}
```

This uses the same platform wrapper runner and writes the same normalized
records to `importedUsageEstimates`.

Use this path only when the caller is deliberately operating against the
Application capability model. Tool-only external integrations should keep using
`/api/tools/ccusage.report/invocations`.

## System Capabilities Proven By ccusage

The ccusage use case proves these Application system capabilities:

| Capability | What ccusage demonstrates |
| --- | --- |
| Application asset management | One npm package is registered as one managed Application instead of multiple pseudo-agents. |
| Capability projection | Six reviewed report commands become `app.app_ccusage.wrapper.*` capabilities. |
| Stable compatibility facade | `/api/tools/ccusage.report` remains the public tool contract while the backing moves to Application execution. |
| Governed invocation | Report execution creates normal invocation, audit, policy, trace, and result records. |
| Wrapper safety | The server builds argv from reviewed descriptors and validated inputs; callers cannot pass free-form commands or args. |
| Local bridge enforcement | The Desktop Bridge re-checks command id, cwd, args, file policy, and network policy before spawning the fixed wrapper runner. |
| Result import | Completed report output is normalized into `importedUsageEstimates`. |
| Evidence linkage | Imported rows are linked to invocation result metadata, audit summary, Application `latestResult`, public state, and Evidence Center. |
| Operator visibility | The Applications inspector can show readiness, result collection, latest result, and a View invocation action. |
| Restart recovery | Persisted Application descriptors, projected capabilities, result refs, and read-model evidence can be rebuilt after restart. |

## Governance And Safety Boundaries

The ccusage Application path intentionally limits what callers can do:

- Only reviewed wrapper commands are projected as invokable capabilities.
- Only declared inputs are accepted. For ccusage filters, that means
  `since`, `until`, and `timezone` on wrapper capabilities, plus the facade's
  public `report`, `source`, `offline`, and `projectId` fields.
- Date filters must use `YYYY-MM-DD`.
- Timezones must match the wrapper-safe server validation.
- The report commands run read-only and offline, with network access forbidden.
- The `session` report keeps its approval requirement.
- Discovery never exposes local wrapper paths, raw adapter commands, env, or
  arbitrary CLI flags.

## Billing And Ledger Semantics

`ccusage` imports observed external usage estimates. These rows are useful for
reporting and reconciliation, but they are not authoritative myagenttool billing
ledger entries.

Rows in `importedUsageEstimates` use:

```text
amountSource: imported_ccusage_report
economicModel: external_billed
authoritative: false
```

They should not be used for platform quota enforcement unless a later explicit
reconciliation step promotes them.

## Where To Look In The Product

Operators should be able to inspect the flow from these surfaces:

- Applications list: find `ccusage`.
- Application detail: inspect status, source, wrapper commands, readiness, and
  latest result.
- Capabilities view: discover `app.app_ccusage.wrapper.*` capabilities.
- Invocations view: follow the queued, running, completed, or refused report.
- Evidence Center: inspect imported `usage_estimate` evidence linked to the
  invocation.

## Related Engineering Documents

- [ADR 0007: Re-home ccusage as an Application](ADR_0007_CCUSAGE_AS_APPLICATION.md)
- [Application Capability Registry](APPLICATION_CAPABILITY_REGISTRY.md)
- [Application Closed-loop Development Report](APPLICATION_CLOSED_LOOP_DEVELOPMENT_REPORT.md)
- [Tool Registry Agent Calling](TOOL_REGISTRY_AGENT_CALLING.md)
- [Tool Registry External Consumer Contract](TOOL_REGISTRY_EXTERNAL_CONSUMER_CONTRACT.md)
