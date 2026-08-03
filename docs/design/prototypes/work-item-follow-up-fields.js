const sceneButtons = document.querySelectorAll("[data-scene]");
const scenePanels = document.querySelectorAll("[data-scene-panel]");
const relationSelect = document.querySelector("[data-create-relation]");
const selfSummary = document.querySelector("[data-self-summary]");
const requesterFields = document.querySelector("[data-requester-fields]");

function showScene(scene) {
  sceneButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.scene === scene);
  });
  scenePanels.forEach((panel) => {
    const active = panel.dataset.scenePanel === scene;
    panel.hidden = !active;
    panel.classList.toggle("is-visible", active);
  });
}

sceneButtons.forEach((button) => {
  button.addEventListener("click", () => showScene(button.dataset.scene));
});

relationSelect?.addEventListener("change", () => {
  const isSelf = relationSelect.value === "self";
  selfSummary.hidden = !isSelf;
  requesterFields.hidden = isSelf;
});

document.querySelectorAll("[data-open-progress]").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelector("[data-progress-editor]").hidden = false;
  });
});

document.querySelectorAll("[data-close-progress]").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelector("[data-progress-editor]").hidden = true;
  });
});

showScene("create");
