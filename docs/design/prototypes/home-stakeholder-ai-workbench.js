const sceneButtons = document.querySelectorAll("[data-scene]");
const attentionCards = document.querySelectorAll("[data-attention]");
const relationButtons = document.querySelectorAll("[data-relation].filter-chip");
const mineToggle = document.querySelector("[data-mine-toggle]");
const taskCards = document.querySelectorAll(".task-card");
const taskList = document.querySelector("[data-task-list]");
const emptyState = document.querySelector("[data-empty-state]");
const aiRail = document.querySelector("[data-ai-rail]");

let scene = "attention";
let relation = "all";
let attention = "mine";

function setActive(buttons, active, attribute) {
  buttons.forEach((button) => button.classList.toggle("is-active", button.getAttribute(attribute) === active));
}

function applyFilters() {
  const clear = scene === "clear";
  const aiOnly = scene === "ai";
  let visible = 0;

  taskCards.forEach((card) => {
    const tags = (card.dataset.tags || "").split(" ");
    const matchesRelation = relation === "all" || card.dataset.relation === relation;
    const matchesMine = !mineToggle.checked || tags.includes("mine");
    const matchesScene = scene === "all"
      || scene === "attention"
      || (aiOnly && tags.includes("ai"));
    const matchesAttention = scene !== "attention" || attention === "mine" || tags.includes(attention);
    const show = !clear && matchesRelation && matchesMine && matchesScene && matchesAttention;
    card.hidden = !show;
    if (show) visible += 1;
  });

  taskList.hidden = visible === 0;
  emptyState.hidden = visible !== 0;
  aiRail.hidden = clear;
}

sceneButtons.forEach((button) => {
  button.addEventListener("click", () => {
    scene = button.dataset.scene;
    if (scene === "attention") {
      attention = "mine";
      mineToggle.checked = true;
    } else if (scene === "all" || scene === "ai") {
      mineToggle.checked = false;
    }
    setActive(sceneButtons, scene, "data-scene");
    attentionCards.forEach((card) => card.classList.toggle("is-selected", scene === "attention" && card.dataset.attention === attention));
    applyFilters();
  });
});

attentionCards.forEach((card) => {
  card.addEventListener("click", () => {
    scene = "attention";
    attention = card.dataset.attention;
    setActive(sceneButtons, scene, "data-scene");
    attentionCards.forEach((item) => item.classList.toggle("is-selected", item === card));
    applyFilters();
  });
});

relationButtons.forEach((button) => {
  button.addEventListener("click", () => {
    relation = button.dataset.relation;
    setActive(relationButtons, relation, "data-relation");
    applyFilters();
  });
});

mineToggle.addEventListener("change", applyFilters);
applyFilters();
