export const PRIVATE_TUTOR_VISUAL_SCENE_SCHEMA_VERSION = 1;

const TEMPLATE_CATALOG = [
  template("number_line", "数轴", ["integer"]),
  template("fraction_strip", "分数条", ["fraction"]),
  template("equation_balance", "等式天平", ["equation-meaning", "balance"]),
  template("bar_model", "线段图", ["word-problem"]),
  template("coordinate_plane", "坐标系", ["coordinate"]),
  template("comparison", "正误对比", ["equation-meaning", "misconception"]),
];

const QUESTION_INTERACTIONS = {
  "tutor-int-recall-001-v1": values("在数轴上选择落点", ["-11", "-3", "3"]),
  "tutor-int-guided-001-v1": values("选择计算后的落点", ["-4", "14", "4"]),
  "tutor-int-transfer-001-v1": values("选择计算后的落点", ["16", "8", "-16"]),
  "tutor-eqm-recall-001-v1": values("选择符合条件的卡片", ["a", "b", "c"], ["第一张", "第二张", "第三张"]),
  "tutor-eqm-guided-001-v1": values("选择能让等式平衡的 x", ["-5", "5", "17"]),
  "tutor-eqm-transfer-001-v1": values("选择能让等式平衡的 x", ["32", "4", "7"]),
  "tutor-bal-recall-001-v1": values("选择两边平均分开后的 x", ["4", "5", "6"]),
  "tutor-bal-guided-001-v1": values("选择两边同时减 3 后的 x", ["3", "8", "5"]),
  "tutor-bal-transfer-001-v1": values("选择最后能让天平平衡的 x", ["5", "3", "15"]),
  "tutor-word-recall-001-v1": values("在线段图中选择未知的一段", ["9", "4", "5"]),
  "tutor-word-guided-001-v1": values("选择每一段代表的钱数", ["6", "18", "3"]),
  "tutor-word-transfer-001-v1": values("选择每个相同部分代表的数", ["10", "7", "14"]),
};

const BALANCE_SCENARIOS = {
  "tutor-bal-recall-001-v1": balanceScenario("2x", "10", 2, 0, 10, 5, [
    state("先找到等式两边", "2x", "10"),
    state("两边同时平均分成 2 份", "2x ÷ 2", "10 ÷ 2"),
    state("每一份保持相等", "x", "5"),
  ]),
  "tutor-bal-transfer-001-v1": balanceScenario("3x + 2", "17", 3, 2, 17, 5, [
    state("先看未知数旁边的 2", "3x + 2", "17"),
    state("两边同时减去 2", "3x", "15"),
    state("两边再同时除以 3", "x", "5"),
  ]),
};

export function privateTutorVisualTemplateCatalog() {
  return TEMPLATE_CATALOG.map((item) => ({ ...item, supportedKnowledgeIds: [...item.supportedKnowledgeIds] }));
}

export function buildPrivateTutorVisualScene({ knowledgeId, activityKind, teachingMethod, questionRevisionId = null } = {}) {
  const definition = sceneDefinition(knowledgeId, questionRevisionId);
  if (!definition) return null;
  const revisionId = `${definition.id}-${activityKind ?? "lesson"}-${teachingMethod ?? "default"}-v1`;
  const scene = {
    schemaVersion: PRIVATE_TUTOR_VISUAL_SCENE_SCHEMA_VERSION,
    revisionId,
    template: definition.template,
    title: definition.title,
    ariaLabel: definition.ariaLabel,
    parameters: structuredClone(definition.parameters),
    steps: definition.steps.map((step, index) => ({
      id: `step-${index + 1}`,
      index,
      startMs: definition.steps.slice(0, index).reduce((sum, item) => sum + item.durationMs, 0),
      durationMs: step.durationMs,
      narration: step.narration,
      stateIndex: index,
    })),
    interaction: questionRevisionId ? structuredClone(QUESTION_INTERACTIONS[questionRevisionId] ?? null) : null,
    publication: {
      status: "engineering_preview",
      contentVersion: "p7.1",
      mathValidated: true,
      reviewedAt: null,
    },
  };
  const validation = validatePrivateTutorVisualScene(scene);
  if (!validation.ok) throw new Error(`invalid_private_tutor_visual_scene:${validation.errors.join(",")}`);
  return scene;
}

export function validatePrivateTutorVisualScene(scene) {
  const errors = [];
  if (scene?.schemaVersion !== PRIVATE_TUTOR_VISUAL_SCENE_SCHEMA_VERSION) errors.push("schema_version");
  if (!TEMPLATE_CATALOG.some((item) => item.id === scene?.template)) errors.push("template");
  if (!scene?.revisionId || !Array.isArray(scene?.steps) || scene.steps.length < 2) errors.push("steps");
  if (Array.isArray(scene?.steps)) {
    const ids = new Set();
    let expectedStart = 0;
    for (const [index, step] of scene.steps.entries()) {
      if (!step.id || ids.has(step.id) || step.index !== index || step.startMs !== expectedStart || step.durationMs < 500 || !step.narration) errors.push(`step_${index}`);
      ids.add(step.id);
      expectedStart += step.durationMs;
    }
  }
  if (!parametersAreMathematicallyValid(scene?.template, scene?.parameters)) errors.push("math_parameters");
  return { ok: errors.length === 0, errors: [...new Set(errors)] };
}

function sceneDefinition(knowledgeId, questionRevisionId) {
  if (knowledgeId === "integer") {
    const scenario = {
      "tutor-int-guided-001-v1": { start: -5, delta: 9, result: 4 },
      "tutor-int-transfer-001-v1": { start: 12, delta: 4, result: 16 },
    }[questionRevisionId] ?? { start: 4, delta: -7, result: -3 };
    return {
      id: `number-line-${questionRevisionId ?? "concept"}`,
      template: "number_line",
      title: "在数轴上看方向和距离",
      ariaLabel: `从 ${scenario.start} 出发移动 ${scenario.delta} 格，到达 ${scenario.result}`,
      parameters: { minimum: -12, maximum: 18, ...scenario },
      steps: [
        timed(`先在数轴上找到起点 ${scenario.start}。`),
        timed(`${scenario.delta < 0 ? "向左" : "向右"}移动 ${Math.abs(scenario.delta)} 格。`),
        timed(`落点是 ${scenario.result}，它就是计算结果。`),
      ],
    };
  }
  if (knowledgeId === "equation-meaning") {
    return {
      id: `comparison-${questionRevisionId ?? "concept"}`,
      template: "comparison",
      title: "对比等式和方程",
      ariaLabel: "对比没有未知数的等式与含未知数的方程",
      parameters: { left: "6 + 2 = 8", right: "x + 2 = 8", emphasis: "x" },
      steps: [
        timed("先看两张卡片，它们都有相等关系。"),
        timed("右边还含有不知道的数 x。"),
        timed("含有未知数的等式，才是这里要找的方程。"),
      ],
    };
  }
  if (knowledgeId === "balance") {
    const scenario = BALANCE_SCENARIOS[questionRevisionId]
      ?? balanceScenario("x + 3", "8", 1, 3, 8, 5, [
        state("先看天平两边", "x + 3", "8"),
        state("两边同时减去 3", "x + 3 - 3", "8 - 3"),
        state("天平仍然平衡", "x", "5"),
      ]);
    return {
      id: `balance-${questionRevisionId ?? "concept"}`,
      template: "equation_balance",
      title: "等式是一架平衡的天平",
      ariaLabel: `${scenario.initialLeft} 等于 ${scenario.initialRight}，等式两边做相同运算后仍然平衡`,
      parameters: scenario,
      steps: scenario.states.map((item) => timed(item.narration)),
    };
  }
  if (knowledgeId === "word-problem") {
    const scenario = {
      "tutor-word-guided-001-v1": { total: 18, equalParts: 3, extra: 0, unitValue: 6, unitLabel: "每本" },
      "tutor-word-transfer-001-v1": { total: 17, equalParts: 2, extra: 3, unitValue: 7, unitLabel: "每份" },
    }[questionRevisionId] ?? { total: 9, equalParts: 1, extra: 4, unitValue: 5, unitLabel: "未知数" };
    return {
      id: `bar-model-${questionRevisionId ?? "concept"}`,
      template: "bar_model",
      title: "把文字关系画成线段图",
      ariaLabel: `${scenario.equalParts} 个相同部分加 ${scenario.extra} 等于 ${scenario.total}`,
      parameters: scenario,
      steps: [
        timed(`先画出总量 ${scenario.total}。`),
        timed(`分出 ${scenario.equalParts} 个相同部分${scenario.extra ? `和多出的 ${scenario.extra}` : ""}。`),
        timed(`每个${scenario.unitLabel}是 ${scenario.unitValue}。`),
      ],
    };
  }
  return null;
}

function parametersAreMathematicallyValid(templateId, parameters) {
  if (!parameters || typeof parameters !== "object") return false;
  if (templateId === "number_line") {
    return finite(parameters.minimum, parameters.maximum, parameters.start, parameters.delta, parameters.result)
      && parameters.minimum < parameters.maximum
      && parameters.start + parameters.delta === parameters.result
      && parameters.result >= parameters.minimum
      && parameters.result <= parameters.maximum;
  }
  if (templateId === "equation_balance") {
    const equation = parameters.equation;
    const finalState = parameters.states?.at?.(-1);
    return typeof parameters.initialLeft === "string"
      && typeof parameters.initialRight === "string"
      && Array.isArray(parameters.states)
      && parameters.states.length >= 2
      && parameters.states.every((item) => item && typeof item.left === "string" && typeof item.right === "string" && typeof item.narration === "string")
      && equation && typeof equation === "object"
      && finite(equation.coefficient, equation.constant, equation.rightValue, equation.solution)
      && equation.coefficient !== 0
      && equation.coefficient * equation.solution + equation.constant === equation.rightValue
      && finalState?.left === "x"
      && finalState?.right === String(equation.solution);
  }
  if (templateId === "bar_model") {
    return finite(parameters.total, parameters.equalParts, parameters.extra, parameters.unitValue)
      && parameters.equalParts > 0
      && parameters.unitValue * parameters.equalParts + parameters.extra === parameters.total;
  }
  if (templateId === "comparison") return [parameters.left, parameters.right, parameters.emphasis].every((value) => typeof value === "string" && value.length > 0);
  if (templateId === "fraction_strip") return Number.isInteger(parameters.denominator) && parameters.denominator > 1 && Number.isInteger(parameters.numerator) && parameters.numerator >= 0 && parameters.numerator <= parameters.denominator;
  if (templateId === "coordinate_plane") return finite(parameters.x, parameters.y, parameters.minimum, parameters.maximum)
    && parameters.minimum < parameters.maximum
    && parameters.x >= parameters.minimum && parameters.x <= parameters.maximum
    && parameters.y >= parameters.minimum && parameters.y <= parameters.maximum;
  return false;
}

function template(id, title, supportedKnowledgeIds) {
  return { id, revision: 1, title, supportedKnowledgeIds, publicationStatus: "engineering_preview" };
}

function values(prompt, rawValues, labels = rawValues) {
  return { kind: "select_value", prompt, choices: rawValues.map((value, index) => ({ id: `choice-${index + 1}`, label: labels[index], value })) };
}

function balanceScenario(initialLeft, initialRight, coefficient, constant, rightValue, solution, states) {
  return { initialLeft, initialRight, equation: { coefficient, constant, rightValue, solution }, states };
}

function state(narration, left, right) {
  return { narration, left, right };
}

function timed(narration, durationMs = 2_400) {
  return { narration, durationMs };
}

function finite(...values) {
  return values.every(Number.isFinite);
}
