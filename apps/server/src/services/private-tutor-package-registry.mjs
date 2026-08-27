import { createHash } from "node:crypto";
import { demoMathFoundationsPackage } from "./packages/demo-math-foundations.mjs";
import { csLogicFoundationsPackage } from "./packages/cs-logic-foundations.mjs";
import { languageCausalExplanationsPackage } from "./packages/language-causal-explanations.mjs";
import { programmingFunctionsPackage } from "./packages/programming-functions.mjs";
import { conceptualSourceReasoningPackage } from "./packages/conceptual-source-reasoning.mjs";
import { mathSubjectPlugin } from "./plugins/math-plugin.mjs";
import { computerScienceSubjectPlugin } from "./plugins/computer-science-plugin.mjs";
import { languageSubjectPlugin } from "./plugins/language-plugin.mjs";
import { programmingSubjectPlugin } from "./plugins/programming-plugin.mjs";
import { conceptualSubjectPlugin } from "./plugins/conceptual-plugin.mjs";

const PACKAGE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,99}$/;
const SOURCE_TYPES = new Set(["textbook", "university_course", "professional_skill", "user_material"]);

export const CONTENT_PACKAGE_SCHEMA_VERSION = 1;

export function createPrivateTutorPackageRegistry({ packages = [], modules = [], topics = [], knowledgeComponents = [], subjectPlugins = [] } = {}) {
  const packageMap = new Map();
  const pluginMap = new Map();
  for (const plugin of builtInPlugins().concat(subjectPlugins)) registerSubjectPlugin(pluginMap, plugin);
  for (const pkg of builtInPackages().concat(packages)) registerPackage(packageMap, pkg);
  return {
    listPackages(filters) {
      return [...packageMap.values()]
        .filter((pkg) => pkg.status == null || pkg.status === "published")
        .filter((pkg) => !filters?.sourceType || pkg.sourceType === filters.sourceType)
        .filter((pkg) => !filters?.domain || pkg.domain === filters.domain)
        .filter((pkg) => pkg.sourceType !== "user_material"
          || !filters?.learningProfileId
          || pkg.learningProfileId === filters.learningProfileId)
        .map((pkg) => packageSummary(pkg));
    },
    getPackage(packageId) {
      const pkg = packageMap.get(packageId);
      return pkg ? materializePackage(pkg, { modules, topics, knowledgeComponents }) : null;
    },
    getSubjectPlugin(subjectId) {
      return pluginMap.get(subjectId) ?? null;
    },
    knowledgeGraph(packageId) {
      const pkg = packageMap.get(packageId);
      if (!pkg) return null;
      const materialized = materializePackage(pkg, { modules, topics, knowledgeComponents });
      return {
        packageId,
        knowledge: topologicalKnowledge(materialized.knowledgeComponents),
        edges: materialized.knowledgeComponents.flatMap((item) => item.prerequisiteKnowledgeIds.map((prerequisiteId) => ({ from: prerequisiteId, to: item.id }))),
      };
    },
  };
}

export function seedPrivateTutorContentPackages(state, at) {
  ensureCollections(state);
  let changed = false;
  for (const pkg of builtInPackages()) {
    if (state.privateTutorContentPackages.some((item) => item.id === pkg.id)) continue;
    const serialized = serializePackage(pkg, at);
    state.privateTutorContentPackages.push(serialized.package);
    state.privateTutorModules.push(...serialized.modules);
    state.privateTutorTopics.push(...serialized.topics);
    state.privateTutorKnowledgeComponents.push(...serialized.knowledgeComponents);
    changed = true;
  }
  for (const plugin of builtInPlugins()) {
    if (state.privateTutorSubjectPlugins.some((item) => item.subjectId === plugin.subjectId)) continue;
    state.privateTutorSubjectPlugins.push(serializePlugin(plugin, at));
    changed = true;
  }
  return changed;
}

export function privateTutorPackageRegistryFromState(state) {
  ensureCollections(state);
  return createPrivateTutorPackageRegistry({
    packages: state.privateTutorContentPackages,
    modules: state.privateTutorModules,
    topics: state.privateTutorTopics,
    knowledgeComponents: state.privateTutorKnowledgeComponents,
    subjectPlugins: state.privateTutorSubjectPlugins,
  });
}

function registerPackage(packageMap, pkg) {
  if (!pkg || !PACKAGE_ID_PATTERN.test(pkg.id)) throw new Error("invalid_or_duplicate_content_package");
  if (packageMap.has(pkg.id)) return; // Idempotent if already registered
  if (!SOURCE_TYPES.has(pkg.sourceType) || !pkg.version || !pkg.subjectId || !pkg.domain) throw new Error("invalid_content_package_metadata");
  packageMap.set(pkg.id, deepFreeze(structuredClone(pkg)));
}

function registerSubjectPlugin(pluginMap, plugin) {
  if (!plugin?.subjectId || pluginMap.has(plugin.subjectId)) return;
  pluginMap.set(plugin.subjectId, plugin);
}

function packageSummary(pkg) {
  return {
    id: pkg.id,
    name: pkg.name,
    subjectId: pkg.subjectId,
    domain: pkg.domain,
    sourceType: pkg.sourceType,
    version: pkg.version,
    status: pkg.status ?? "published",
    license: pkg.license,
    targetAudience: structuredClone(pkg.targetAudience),
    evaluationCapabilities: structuredClone(pkg.evaluationCapabilities),
    moduleCount: pkg.modules?.length ?? 0,
    knowledgeComponentCount: pkg.knowledgeComponents?.length ?? 0,
  };
}

function materializePackage(pkg, persisted) {
  const sourceModules = pkg.modules?.length ? pkg.modules : persisted.modules.filter((item) => item.packageId === pkg.id);
  const modules = sourceModules.map((module) => ({
    ...module,
    topics: (module.topics ?? persisted.topics.filter((item) => item.moduleId === module.id)).map((topic) => ({
      ...topic,
      knowledgeComponents: (topic.knowledgeComponentIds ?? []).map((id) => findKnowledge(pkg, persisted, id)).filter(Boolean),
    })),
  }));
  return { ...structuredClone(pkg), modules, knowledgeComponents: pkg.knowledgeComponents?.length ? structuredClone(pkg.knowledgeComponents) : persisted.knowledgeComponents.filter((item) => item.packageId === pkg.id) };
}

function findKnowledge(pkg, persisted, id) {
  return pkg.knowledgeComponents?.find((item) => item.id === id) ?? persisted.knowledgeComponents.find((item) => item.id === id) ?? null;
}

function topologicalKnowledge(knowledge) {
  const byId = new Map(knowledge.map((item) => [item.id, item]));
  const visiting = new Set();
  const visited = new Set();
  const result = [];
  function visit(item) {
    if (visited.has(item.id)) return;
    if (visiting.has(item.id)) throw new Error("content_package_prerequisite_cycle");
    visiting.add(item.id);
    for (const id of item.prerequisiteKnowledgeIds ?? []) if (byId.has(id)) visit(byId.get(id));
    visiting.delete(item.id);
    visited.add(item.id);
    result.push(item);
  }
  for (const item of knowledge) visit(item);
  return result;
}

function serializePackage(pkg, at) {
  const content = { ...pkg, modules: undefined, knowledgeComponents: undefined };
  return {
    package: { ...content, schemaVersion: CONTENT_PACKAGE_SCHEMA_VERSION, contentChecksum: checksum(content), createdAt: at, releasedAt: at, status: "published" },
    modules: pkg.modules.map((module) => ({ ...module, packageId: pkg.id, createdAt: at })),
    topics: pkg.modules.flatMap((module) => module.topics.map((topic) => ({ ...topic, packageId: pkg.id, moduleId: module.id, createdAt: at }))),
    knowledgeComponents: pkg.knowledgeComponents.map((item) => ({ ...item, packageId: pkg.id, createdAt: at })),
  };
}

function serializePlugin(plugin, at) {
  return {
    subjectId: plugin.subjectId,
    version: plugin.version,
    visualTemplates: [...plugin.visualTemplates],
    capabilities: plugin.getCapabilities(),
    createdAt: at,
  };
}

function ensureCollections(state) {
  for (const key of ["privateTutorContentPackages", "privateTutorModules", "privateTutorTopics", "privateTutorKnowledgeComponents", "privateTutorSubjectPlugins"]) {
    if (!Array.isArray(state[key])) state[key] = [];
  }
}

function checksum(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function builtInPackages() {
  return [demoMathFoundationsPackage, csLogicFoundationsPackage, languageCausalExplanationsPackage, programmingFunctionsPackage, conceptualSourceReasoningPackage];
}

function builtInPlugins() {
  return [mathSubjectPlugin, computerScienceSubjectPlugin, languageSubjectPlugin, programmingSubjectPlugin, conceptualSubjectPlugin];
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}
