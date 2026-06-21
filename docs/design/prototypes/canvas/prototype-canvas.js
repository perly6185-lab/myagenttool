const sceneUrl = "./managed-session-history.imported.scene.json";
const state = {
  scene: null,
  activeSurfaceId: "",
  selected: null,
  zoom: 1,
  pan: { x: 32, y: 32 },
  draggingRegion: null,
  panning: null,
};

const refs = {
  surfaceList: document.querySelector("[data-surface-list]"),
  frame: document.querySelector("[data-canvas-frame]"),
  world: document.querySelector("[data-canvas-world]"),
  zoomLabel: document.querySelector("[data-zoom-label]"),
  selectionEmpty: document.querySelector("[data-selection-empty]"),
  inspectorForm: document.querySelector("[data-inspector-form]"),
  labelInput: document.querySelector("[data-label-input]"),
  ownerInput: document.querySelector("[data-owner-input]"),
  statesInput: document.querySelector("[data-states-input]"),
  hiddenInput: document.querySelector("[data-hidden-input]"),
  validationMessage: document.querySelector("[data-validation-message]"),
};

document.querySelector("[data-zoom-in]").addEventListener("click", () => setZoom(state.zoom + 0.1));
document.querySelector("[data-zoom-out]").addEventListener("click", () => setZoom(state.zoom - 0.1));
document.querySelector("[data-reset-view]").addEventListener("click", resetView);
refs.labelInput.addEventListener("input", updateSelectedLabel);
refs.frame.addEventListener("pointerdown", startPan);
refs.frame.addEventListener("pointermove", movePointer);
refs.frame.addEventListener("pointerup", endPointer);
refs.frame.addEventListener("pointercancel", endPointer);

loadScene();

async function loadScene() {
  const response = await fetch(sceneUrl);
  state.scene = await response.json();
  state.activeSurfaceId = state.scene.surfaces[0]?.id ?? "";
  renderSurfaceNav();
  renderCanvas();
  updateTransform();
}

function renderSurfaceNav() {
  refs.surfaceList.innerHTML = `<div class="surface-list">${state.scene.surfaces
    .map((surface) => `<button class="surface-button ${surface.id === state.activeSurfaceId ? "is-active" : ""}" type="button" data-surface-id="${surface.id}">${escapeHtml(surface.name)}</button>`)
    .join("")}</div>`;

  refs.surfaceList.querySelectorAll("[data-surface-id]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeSurfaceId = button.dataset.surfaceId;
      state.selected = null;
      renderSurfaceNav();
      renderCanvas();
      renderInspector();
    });
  });
}

function renderCanvas() {
  const surface = activeSurface();
  refs.world.innerHTML = "";
  if (!surface) return;

  for (const region of surface.regions) {
    const node = document.createElement("article");
    node.className = `region ${state.selected?.kind === "region" && state.selected.id === region.id ? "is-selected" : ""}`;
    node.dataset.regionId = region.id;
    node.style.left = `${region.bounds.x}px`;
    node.style.top = `${region.bounds.y}px`;
    node.style.width = `${region.bounds.width}px`;
    node.style.minHeight = `${Math.max(region.bounds.height, 180)}px`;
    node.innerHTML = `
      <header class="region-header">
        <h2 class="region-title">${escapeHtml(region.name)}</h2>
        <div class="region-meta">${escapeHtml(region.frequency)}<br>${escapeHtml(region.role.replaceAll("_", " "))}</div>
      </header>
      <div class="element-list">
        ${region.elements.map((element) => elementHtml(region, element)).join("")}
      </div>
    `;
    node.addEventListener("pointerdown", (event) => selectRegion(event, region));
    refs.world.append(node);
  }

  refs.world.querySelectorAll("[data-element-id]").forEach((node) => {
    node.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
      const region = findRegion(node.dataset.regionId);
      const element = region?.elements.find((item) => item.id === node.dataset.elementId);
      if (!region || !element) return;
      state.selected = { kind: "element", regionId: region.id, id: element.id };
      renderCanvas();
      renderInspector();
    });
  });
}

function elementHtml(region, element) {
  const selected = state.selected?.kind === "element" && state.selected.id === element.id;
  return `<button class="canvas-element ${selected ? "is-selected" : ""}" type="button" data-type="${escapeHtml(element.type)}" data-region-id="${escapeHtml(region.id)}" data-element-id="${escapeHtml(element.id)}">${escapeHtml(element.label)}</button>`;
}

function selectRegion(event, region) {
  if (event.button !== 0) return;
  state.selected = { kind: "region", id: region.id };
  state.draggingRegion = {
    id: region.id,
    startX: event.clientX,
    startY: event.clientY,
    initialX: region.bounds.x,
    initialY: region.bounds.y,
  };
  refs.frame.setPointerCapture(event.pointerId);
  renderCanvas();
  renderInspector();
}

function startPan(event) {
  if (event.target !== refs.frame && event.target !== refs.world) return;
  state.panning = {
    startX: event.clientX,
    startY: event.clientY,
    initialX: state.pan.x,
    initialY: state.pan.y,
  };
  refs.frame.classList.add("is-panning");
  refs.frame.setPointerCapture(event.pointerId);
}

function movePointer(event) {
  if (state.draggingRegion) {
    const region = findRegion(state.draggingRegion.id);
    if (!region) return;
    region.bounds.x = Math.round(state.draggingRegion.initialX + (event.clientX - state.draggingRegion.startX) / state.zoom);
    region.bounds.y = Math.round(state.draggingRegion.initialY + (event.clientY - state.draggingRegion.startY) / state.zoom);
    renderCanvas();
    renderInspector();
    return;
  }

  if (state.panning) {
    state.pan.x = Math.round(state.panning.initialX + event.clientX - state.panning.startX);
    state.pan.y = Math.round(state.panning.initialY + event.clientY - state.panning.startY);
    updateTransform();
  }
}

function endPointer() {
  state.draggingRegion = null;
  state.panning = null;
  refs.frame.classList.remove("is-panning");
}

function renderInspector() {
  const selection = selectedTarget();
  refs.selectionEmpty.hidden = Boolean(selection);
  refs.inspectorForm.hidden = !selection;
  if (!selection) return;

  refs.labelInput.value = selection.kind === "region" ? selection.target.name : selection.target.label;
  refs.ownerInput.value = selection.region.ownerSurface;
  refs.statesInput.value = selection.region.prototypeStates.join("\n");
  refs.hiddenInput.value = selection.region.whatNotToShow.join("\n");
  validateSelection();
}

function updateSelectedLabel() {
  const selection = selectedTarget();
  if (!selection) return;
  const next = refs.labelInput.value.trim();
  if (selection.kind === "region") selection.target.name = next;
  else selection.target.label = next;
  validateSelection();
  renderCanvas();
}

function validateSelection() {
  const selection = selectedTarget();
  const message = refs.validationMessage;
  message.className = "validation-message";
  if (!selection) return;

  const label = refs.labelInput.value.toLowerCase();
  const forbidden = selection.region.whatNotToShow.some((term) => label.includes(term.toLowerCase()));
  const taskComposerLeak = selection.region.id === "task-composer" && ["latest managed codex", "open session", "evidence center", "send follow-up", "session turns"].some((term) => label.includes(term));

  if (forbidden || taskComposerLeak) {
    message.textContent = "Blocked boundary: this label belongs in another surface.";
    message.classList.add("is-danger");
    return;
  }

  message.textContent = "Edit is inside this region boundary.";
}

function selectedTarget() {
  if (!state.selected) return null;
  if (state.selected.kind === "region") {
    const region = findRegion(state.selected.id);
    return region ? { kind: "region", region, target: region } : null;
  }

  const region = findRegion(state.selected.regionId);
  const element = region?.elements.find((item) => item.id === state.selected.id);
  return region && element ? { kind: "element", region, target: element } : null;
}

function findRegion(id) {
  return activeSurface()?.regions.find((region) => region.id === id);
}

function activeSurface() {
  return state.scene?.surfaces.find((surface) => surface.id === state.activeSurfaceId);
}

function setZoom(next) {
  state.zoom = Math.min(1.6, Math.max(0.5, Number(next.toFixed(2))));
  updateTransform();
}

function resetView() {
  state.zoom = 1;
  state.pan = { x: 32, y: 32 };
  updateTransform();
}

function updateTransform() {
  refs.world.style.transform = `translate(${state.pan.x}px, ${state.pan.y}px) scale(${state.zoom})`;
  refs.zoomLabel.textContent = `${Math.round(state.zoom * 100)}%`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
