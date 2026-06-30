import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const canvasRoot = resolve(repoRoot, "docs/design/prototypes/canvas");
const prototypes = [
  {
    id: "managed-session-history",
    scenePath: resolve(canvasRoot, "managed-session-history.imported.scene.json"),
    htmlOutPath: resolve(canvasRoot, "managed-session-history.export.html"),
    checklistJsonPath: resolve(canvasRoot, "managed-session-history.visual-qa.json"),
    checklistMdPath: resolve(canvasRoot, "managed-session-history.visual-qa.md"),
  },
  {
    id: "agent-workspace",
    scenePath: resolve(canvasRoot, "agent-workspace.imported.scene.json"),
    htmlOutPath: resolve(canvasRoot, "agent-workspace.export.html"),
    checklistJsonPath: resolve(canvasRoot, "agent-workspace.visual-qa.json"),
    checklistMdPath: resolve(canvasRoot, "agent-workspace.visual-qa.md"),
  },
];

for (const prototype of prototypes) {
  const scene = JSON.parse(readFileSync(prototype.scenePath, "utf8"));
  const checklist = buildChecklist(scene, prototype);

  writeFileSync(prototype.htmlOutPath, exportHtml(scene));
  writeFileSync(prototype.checklistJsonPath, `${JSON.stringify(checklist, null, 2)}\n`);
  writeFileSync(prototype.checklistMdPath, checklistMarkdown(checklist));

  console.log(`[export-prototype-canvas] wrote ${relative(prototype.htmlOutPath)}`);
  console.log(`[export-prototype-canvas] wrote ${relative(prototype.checklistJsonPath)}`);
  console.log(`[export-prototype-canvas] wrote ${relative(prototype.checklistMdPath)}`);
}

function exportHtml(model) {
  const surfaces = model.surfaces
    .map((surface) => `
      <section class="surface" id="${escapeAttr(surface.id)}" aria-labelledby="${escapeAttr(surface.id)}-title">
        <header class="surface-header">
          <div>
            <p>${escapeHtml(surface.role.replaceAll("_", " "))} / ${escapeHtml(surface.kind)}</p>
            <h2 id="${escapeAttr(surface.id)}-title">${escapeHtml(surface.name)}</h2>
          </div>
          <dl>
            <div><dt>Owner</dt><dd>${escapeHtml(surface.productFlow.ownerSurface)}</dd></div>
            <div><dt>States</dt><dd>${escapeHtml(surface.prototypeStates.join(", "))}</dd></div>
          </dl>
        </header>
        <div class="region-grid">
          ${surface.regions.map(regionHtml).join("")}
        </div>
      </section>`)
    .join("\n");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(model.name)} Export</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f6f7f9;
        --panel: #ffffff;
        --ink: #18202c;
        --muted: #5d6878;
        --line: #d8dee8;
        --accent: #146c5f;
        --accent-soft: #dff3ee;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      * { box-sizing: border-box; }
      body { margin: 0; background: var(--bg); color: var(--ink); }
      main { max-width: 1240px; margin: 0 auto; padding: 24px; }
      .hero { display: grid; gap: 8px; padding: 20px 0 24px; }
      .hero p, .surface-header p, dt, .meta, .element-type { margin: 0; color: var(--muted); font-size: 12px; font-weight: 700; text-transform: uppercase; }
      h1, h2, h3 { margin: 0; }
      h1 { font-size: 28px; }
      h2 { font-size: 20px; }
      h3 { font-size: 15px; }
      .surface { margin-bottom: 24px; padding: 18px; border: 1px solid var(--line); border-radius: 8px; background: var(--panel); }
      .surface-header { display: flex; justify-content: space-between; gap: 18px; padding-bottom: 16px; border-bottom: 1px solid var(--line); }
      dl { display: grid; gap: 8px; margin: 0; min-width: 280px; }
      dt { margin-bottom: 2px; }
      dd { margin: 0; color: var(--ink); overflow-wrap: anywhere; }
      .region-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; padding-top: 16px; }
      .region { display: grid; align-content: start; gap: 12px; padding: 14px; border: 1px solid var(--line); border-radius: 8px; background: #fbfcfd; }
      .region-meta { display: grid; gap: 6px; }
      .element-list { display: grid; gap: 8px; }
      .element { min-height: 34px; padding: 8px 10px; border: 1px solid var(--line); border-radius: 6px; background: #fff; overflow-wrap: anywhere; }
      .element[data-type="button"] { text-align: center; font-weight: 700; color: #fff; background: var(--accent); border-color: var(--accent); }
      .element[data-type="textarea"], .element[data-type="status"], .element[data-type="timeline"], .element[data-type="result"] { min-height: 56px; }
      .hidden-list { margin: 0; padding-left: 18px; color: var(--muted); font-size: 13px; }
      @media (max-width: 820px) {
        main { padding: 16px; }
        .surface-header { display: grid; }
        .region-grid { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body>
    <main>
      <header class="hero">
        <p>Exported from Prototype Canvas</p>
        <h1>${escapeHtml(model.name)}</h1>
        <div class="meta">Source: ${escapeHtml(model.source.path)}</div>
      </header>
      ${surfaces}
    </main>
  </body>
</html>
`;
}

function regionHtml(region) {
  return `<article class="region" aria-label="${escapeAttr(region.name)}">
    <div class="region-meta">
      <h3>${escapeHtml(region.name)}</h3>
      <div class="meta">Owner: ${escapeHtml(region.ownerSurface)}</div>
      <div class="meta">States: ${escapeHtml(region.prototypeStates.join(", "))}</div>
    </div>
    <div class="element-list">
      ${region.elements.map((element) => `<div class="element" data-type="${escapeAttr(element.type)}"><span class="element-type">${escapeHtml(element.type)}</span><br>${escapeHtml(element.label)}</div>`).join("")}
    </div>
    <div>
      <div class="meta">What not to show</div>
      <ul class="hidden-list">${region.whatNotToShow.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    </div>
  </article>`;
}

function buildChecklist(model, prototype) {
  const surfaces = model.surfaces.map((surface) => ({
    id: surface.id,
    name: surface.name,
    role: surface.role,
    ownerSurface: surface.productFlow.ownerSurface,
    prototypeStates: surface.prototypeStates,
    tasks: [
      `Confirm ${surface.name} is findable for ${surface.productFlow.roleFlow}.`,
      `Confirm states are represented: ${surface.prototypeStates.join(", ")}.`,
      `Confirm owner surface remains ${surface.productFlow.ownerSurface}.`,
      ...surface.acceptanceSignals.map((signal) => `Confirm ${signal}`),
    ],
    regions: surface.regions.map((region) => ({
      id: region.id,
      name: region.name,
      ownerSurface: region.ownerSurface,
      prototypeStates: region.prototypeStates,
      whatNotToShow: region.whatNotToShow,
      tasks: [
        `Confirm ${region.name} appears only in ${region.ownerSurface}.`,
        `Confirm labels are understandable without raw implementation terms.`,
        ...region.whatNotToShow.map((item) => `Confirm "${item}" is not shown in ${region.name}.`),
      ],
    })),
  }));

  return {
    generatedAt: new Date().toISOString(),
    sourceScene: relative(prototype.scenePath),
    exportedHtml: relative(prototype.htmlOutPath),
    productFlow: model.productFlow,
    viewports: [
      { name: "desktop", width: 1366, height: 768 },
      { name: "mobile", width: 390, height: 844 },
    ],
    surfaces,
  };
}

function checklistMarkdown(checklist) {
  return [
    "# Prototype Canvas Visual QA Checklist",
    "",
    `Generated: ${checklist.generatedAt}`,
    `Source scene: ${checklist.sourceScene}`,
    `Exported HTML: ${checklist.exportedHtml}`,
    "",
    "## Product Flow",
    "",
    `- Role flow: ${checklist.productFlow.roleFlow}`,
    `- Scenario: ${checklist.productFlow.scenario}`,
    `- Frequency: ${checklist.productFlow.frequency}`,
    `- Owner surface: ${checklist.productFlow.ownerSurface}`,
    `- Usability task: ${checklist.productFlow.usabilityTask}`,
    "",
    "## Viewports",
    "",
    ...checklist.viewports.map((viewport) => `- [ ] ${viewport.name}: ${viewport.width} x ${viewport.height}`),
    "",
    "## Surface Checks",
    "",
    ...checklist.surfaces.flatMap((surface) => [
      `### ${surface.name}`,
      "",
      ...surface.tasks.map((task) => `- [ ] ${task}`),
      "",
      ...surface.regions.flatMap((region) => [
        `#### ${region.name}`,
        "",
        ...region.tasks.map((task) => `- [ ] ${task}`),
        "",
      ]),
    ]),
  ].join("\n");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/'/g, "&#39;");
}

function relative(path) {
  return path.replace(`${repoRoot}\\`, "").replaceAll("\\", "/");
}
