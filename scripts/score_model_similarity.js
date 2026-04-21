#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const OUTPUT_DIR = path.join(ROOT, "analysis");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "model_similarity_scores.csv");

const CATEGORY_WEIGHTS = {
  structure: 0.45,
  behavior: 0.35,
  data: 0.2
};

const CATEGORY_LIMITS = {
  structure: 24,
  behavior: 24,
  data: 18
};

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "been",
  "being",
  "by",
  "can",
  "could",
  "def",
  "diagram",
  "do",
  "does",
  "for",
  "from",
  "if",
  "in",
  "into",
  "is",
  "it",
  "its",
  "mode",
  "model",
  "of",
  "on",
  "or",
  "overall",
  "s",
  "si",
  "such",
  "than",
  "that",
  "the",
  "their",
  "them",
  "then",
  "there",
  "these",
  "this",
  "those",
  "through",
  "to",
  "type",
  "unit",
  "used",
  "using",
  "system",
  "interaction",
  "inline",
  "toolvariable",
  "name",
  "uri",
  "localhost",
  "real",
  "boolean",
  "integer",
  "string",
  "value",
  "values",
  "scalarvalues",
  "via",
  "view",
  "with"
]);

function createClassList() {
  return {
    add() {},
    remove() {},
    toggle() {},
    contains() {
      return false;
    }
  };
}

function createElement(tagName = "div") {
  const node = {
    tagName: String(tagName).toUpperCase(),
    attributes: {},
    style: {},
    dataset: {},
    childNodes: [],
    classList: createClassList(),
    value: "",
    textContent: "",
    innerHTML: "",
    clientWidth: 1440,
    clientHeight: 900,
    scrollWidth: 1440,
    scrollHeight: 900,
    appendChild(child) {
      this.childNodes.push(child);
      return child;
    },
    append(...children) {
      children.forEach((child) => this.appendChild(child));
    },
    prepend(child) {
      this.childNodes.unshift(child);
      return child;
    },
    replaceChildren(...children) {
      this.childNodes = [];
      children.forEach((child) => this.appendChild(child));
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
    getAttribute(name) {
      return this.attributes[name];
    },
    addEventListener() {},
    removeEventListener() {},
    querySelector() {
      return createElement("div");
    },
    querySelectorAll() {
      return [];
    },
    getBoundingClientRect() {
      return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight };
    }
  };
  Object.defineProperty(node, "children", {
    get() {
      return this.childNodes;
    }
  });
  return node;
}

function createDocument() {
  const elementCache = new Map();
  return {
    body: createElement("body"),
    createElement,
    createElementNS(_namespace, tagName) {
      return createElement(tagName);
    },
    createTextNode(text) {
      return { nodeType: 3, textContent: String(text) };
    },
    getElementById(id) {
      if (!elementCache.has(id)) {
        const element = createElement("div");
        element.id = id;
        if (id === "diagram") {
          element.viewBox = { baseVal: { x: 0, y: 0, width: 1600, height: 1000 } };
          element.setAttribute("viewBox", "0 0 1600 1000");
        }
        if (id === "diagram-shell") {
          element.clientWidth = 1600;
          element.clientHeight = 1000;
        }
        elementCache.set(id, element);
      }
      return elementCache.get(id);
    },
    querySelectorAll(selector) {
      if (selector === ".view-button") {
        return ["ov1", "bdd", "ibd", "activity", "sequence"].map((view) => {
          const button = createElement("button");
          button.dataset.view = view;
          return button;
        });
      }
      return [];
    },
    addEventListener() {}
  };
}

function loadParser() {
  const source = fs.readFileSync(path.join(ROOT, "static", "app.js"), "utf8");
  const context = {
    console,
    module: { exports: {} },
    exports: {},
    structuredClone: global.structuredClone || ((value) => JSON.parse(JSON.stringify(value))),
    document: createDocument(),
    navigator: { userAgent: "node" },
    fetch: async () => ({ ok: false, text: async () => "", json: async () => ({}) }),
    performance: { now: () => 0 },
    requestAnimationFrame: (callback) => callback(0),
    cancelAnimationFrame: () => {},
    setTimeout,
    clearTimeout
  };
  context.window = {
    document: context.document,
    structuredClone: context.structuredClone,
    addEventListener() {},
    removeEventListener() {}
  };
  context.globalThis = context;
  vm.runInNewContext(`${source}\nmodule.exports = { parseModelText };`, context, {
    filename: "static/app.js"
  });
  return context.module.exports.parseModelText;
}

function normalizeWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function humanizeIdentifier(value) {
  return normalizeWhitespace(
    String(value || "")
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/[_~:/.-]+/g, " ")
      .replace(/[<>()[\]{}]/g, " ")
  );
}

function normalizePhrase(value) {
  return humanizeIdentifier(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanSignalLabel(value) {
  return normalizeWhitespace(
    String(value || "")
      .replace(/@\w+/g, " ")
      .replace(/\[[^\]]*\]/g, " ")
      .replace(/\{.*$/g, " ")
      .replace(/:>>/g, " ")
      .replace(/:>/g, " ")
      .replace(/::/g, " ")
      .replace(/^[\s]*(in|out|item|part|port|action|attribute|metadata|connection|enum|calc|state|transition)\b/gi, " ")
      .replace(/\b(first|then|entry|exit)\b/gi, " ")
  );
}

function stemToken(token) {
  if (token.length > 5 && token.endsWith("ies")) {
    return `${token.slice(0, -3)}y`;
  }
  if (token.length > 5 && token.endsWith("ing")) {
    return token.slice(0, -3);
  }
  if (token.length > 4 && token.endsWith("ed")) {
    return token.slice(0, -2);
  }
  if (token.length > 4 && token.endsWith("es")) {
    return token.slice(0, -2);
  }
  if (token.length > 3 && token.endsWith("s")) {
    return token.slice(0, -1);
  }
  return token;
}

function tokenize(value) {
  return normalizePhrase(value)
    .split(" ")
    .map((token) => stemToken(token))
    .filter((token) => {
      if (!token) {
        return false;
      }
      if (STOPWORDS.has(token)) {
        return false;
      }
      if (token.length <= 1 && !/^\d+$/.test(token)) {
        return false;
      }
      return true;
    });
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  const output = [];
  items.forEach((item) => {
    const key = keyFn(item);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    output.push(item);
  });
  return output;
}

function takeSignals(signals, limit) {
  return signals
    .sort((left, right) => {
      if (right.weight !== left.weight) {
        return right.weight - left.weight;
      }
      if (right.tokens.length !== left.tokens.length) {
        return right.tokens.length - left.tokens.length;
      }
      return right.label.length - left.label.length;
    })
    .slice(0, limit);
}

function collectSignals(model) {
  const collected = [];
  const seen = new Set();

  const addSignal = (rawLabel, category, weight) => {
    const label = cleanSignalLabel(rawLabel);
    if (!label) {
      return;
    }
    const phrase = normalizePhrase(label);
    const tokens = uniqueBy(tokenize(label), (token) => token);
    if (!phrase || !tokens.length) {
      return;
    }
    const key = `${category}:${tokens.join("|")}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    collected.push({ label, phrase, tokens, category, weight });
  };

  addSignal(model.title, "structure", 2.4);

  model.views.ov1.actors.forEach((actor) => addSignal(actor.label, "structure", 1.8));
  model.views.ov1.flows.forEach((flow) => addSignal(flow.label, "behavior", 1.0));

  model.views.bdd.blocks.forEach((block) => {
    const stereotype = normalizePhrase(block.stereotype);
    const blockWeight =
      stereotype.includes("part") || stereotype.includes("item") || stereotype.includes("action")
        ? 1.7
        : stereotype.includes("calc")
          ? 1.5
          : stereotype.includes("port")
            ? 1.0
            : 0.9;
    addSignal(block.name || block.id, "structure", blockWeight);
    (block.properties || []).slice(0, 4).forEach((property) => addSignal(property, "data", 0.55));
    (block.operations || []).slice(0, 4).forEach((operation) => addSignal(operation, "behavior", 0.8));
  });
  model.views.bdd.relationships.forEach((relationship) => addSignal(relationship.label || relationship.kind, "behavior", 0.75));

  model.views.ibd.parts.forEach((part) => addSignal(part.name, "structure", 1.25));
  model.views.ibd.connectors.forEach((connector) => addSignal(connector.label, "behavior", 0.85));

  model.views.activity.lanes.forEach((lane) => addSignal(lane.label, "structure", 1.2));
  model.views.activity.nodes
    .filter((node) => !["start", "end", "fork", "join", "decision", "merge"].includes(node.kind))
    .forEach((node) => {
      addSignal(node.label, "behavior", node.kind === "accept" ? 1.1 : 1.45);
      addSignal(node.subtitle, "behavior", 0.8);
      (node.inputs || []).slice(0, 3).forEach((input) => addSignal(`${input.name} ${input.type || ""}`, "data", 0.65));
      (node.outputs || []).slice(0, 3).forEach((output) => addSignal(`${output.name} ${output.type || ""}`, "data", 0.65));
    });
  model.views.activity.edges.forEach((edge) => {
    addSignal(edge.controlLabel, "behavior", 0.75);
    addSignal(edge.dataLabel, "data", 0.9);
    addSignal(edge.label, "data", 0.6);
  });

  model.views.sequence.participants.forEach((participant) => addSignal(participant.label, "structure", 1.0));
  model.views.sequence.executions.forEach((execution) => addSignal(execution.label, "behavior", 0.75));
  model.views.sequence.messages.forEach((message) => addSignal(message.label, "behavior", 0.8));

  const grouped = {
    structure: [],
    behavior: [],
    data: []
  };
  collected.forEach((signal) => grouped[signal.category].push(signal));

  return {
    structure: takeSignals(grouped.structure, CATEGORY_LIMITS.structure),
    behavior: takeSignals(grouped.behavior, CATEGORY_LIMITS.behavior),
    data: takeSignals(grouped.data, CATEGORY_LIMITS.data)
  };
}

function scoreSignal(signal, normalizedText, textTokens) {
  if (normalizedText.includes(signal.phrase)) {
    return 1;
  }
  const matched = signal.tokens.filter((token) => textTokens.has(token));
  if (!matched.length) {
    return 0;
  }
  const coverage = matched.length / signal.tokens.length;
  if (signal.tokens.length === 1) {
    return 0.86;
  }
  if (coverage >= 1) {
    return 0.94;
  }
  return Math.max(0.24, coverage * 0.82);
}

function scoreCategory(signals, normalizedText, textTokens) {
  if (!signals.length) {
    return null;
  }
  let weightedScore = 0;
  let totalWeight = 0;
  const matches = [];

  signals.forEach((signal) => {
    const signalScore = scoreSignal(signal, normalizedText, textTokens);
    weightedScore += signalScore * signal.weight;
    totalWeight += signal.weight;
    matches.push({ ...signal, signalScore });
  });

  return {
    score: totalWeight ? weightedScore / totalWeight : 0,
    matches
  };
}

function scoreTokens(groupedSignals, textTokens) {
  const tokenWeights = new Map();
  Object.values(groupedSignals)
    .flat()
    .forEach((signal) => {
      const share = signal.weight / signal.tokens.length;
      signal.tokens.forEach((token) => {
        tokenWeights.set(token, (tokenWeights.get(token) || 0) + share);
      });
    });

  let matchedWeight = 0;
  let totalWeight = 0;
  tokenWeights.forEach((weight, token) => {
    totalWeight += weight;
    if (textTokens.has(token)) {
      matchedWeight += weight;
    }
  });

  return totalWeight ? matchedWeight / totalWeight : 0;
}

function overallCategoryScore(categoryScores) {
  const active = Object.entries(CATEGORY_WEIGHTS).filter(([category]) => categoryScores[category] !== null);
  if (!active.length) {
    return 0;
  }
  const activeWeight = active.reduce((sum, [category]) => sum + CATEGORY_WEIGHTS[category], 0);
  return active.reduce(
    (sum, [category]) => sum + (CATEGORY_WEIGHTS[category] / activeWeight) * categoryScores[category],
    0
  );
}

function toLikert(score) {
  if (score >= 0.84) {
    return 5;
  }
  if (score >= 0.66) {
    return 4;
  }
  if (score >= 0.46) {
    return 3;
  }
  if (score >= 0.24) {
    return 2;
  }
  return 1;
}

function summarizeMatches(allMatches, predicate) {
  return allMatches
    .filter(predicate)
    .sort((left, right) => {
      if (right.signalScore !== left.signalScore) {
        return right.signalScore - left.signalScore;
      }
      return right.weight - left.weight;
    })
    .slice(0, 6)
    .map((entry) => entry.label)
    .join(" | ");
}

function csvEscape(value) {
  const raw = String(value ?? "");
  if (/[",\n]/.test(raw)) {
    return `"${raw.replace(/"/g, "\"\"")}"`;
  }
  return raw;
}

function loadMeta(metaPath) {
  try {
    return JSON.parse(fs.readFileSync(metaPath, "utf8"));
  } catch {
    return {};
  }
}

function evaluateModel(parseModelText, modelId) {
  const directory = path.join(DATA_DIR, modelId);
  const sysmlPath = path.join(directory, `${modelId}.sysml`);
  const txtPath = path.join(directory, `${modelId}.txt`);
  const metaPath = path.join(directory, "meta.json");

  const textDescription = fs.readFileSync(txtPath, "utf8");
  const sysmlSource = fs.readFileSync(sysmlPath, "utf8");
  const meta = loadMeta(metaPath);
  const normalizedText = normalizePhrase(textDescription);
  const textTokens = new Set(tokenize(textDescription));

  try {
    const parsed = parseModelText(sysmlSource);
    const groupedSignals = collectSignals(parsed);
    const structure = scoreCategory(groupedSignals.structure, normalizedText, textTokens);
    const behavior = scoreCategory(groupedSignals.behavior, normalizedText, textTokens);
    const data = scoreCategory(groupedSignals.data, normalizedText, textTokens);
    const categoryScores = {
      structure: structure?.score ?? null,
      behavior: behavior?.score ?? null,
      data: data?.score ?? null
    };
    const tokenRecall = scoreTokens(groupedSignals, textTokens);
    const categoryScore = overallCategoryScore(categoryScores);
    const similarity = 0.76 * categoryScore + 0.24 * tokenRecall;
    const allMatches = [structure, behavior, data].flatMap((entry) => entry?.matches || []);

    return {
      model_id: modelId,
      sysml_path: path.relative(ROOT, sysmlPath),
      txt_path: path.relative(ROOT, txtPath),
      split: meta.split || "",
      quality: meta.quality || "",
      category: meta.category || "",
      likert_score: toLikert(similarity),
      similarity_percent: (similarity * 100).toFixed(1),
      structure_score: categoryScores.structure === null ? "" : (categoryScores.structure * 100).toFixed(1),
      behavior_score: categoryScores.behavior === null ? "" : (categoryScores.behavior * 100).toFixed(1),
      data_score: categoryScores.data === null ? "" : (categoryScores.data * 100).toFixed(1),
      token_recall_percent: (tokenRecall * 100).toFixed(1),
      parse_status: "ok",
      matched_terms: summarizeMatches(allMatches, (entry) => entry.signalScore >= 0.68),
      missing_terms: summarizeMatches(allMatches, (entry) => entry.signalScore < 0.34)
    };
  } catch (error) {
    return {
      model_id: modelId,
      sysml_path: path.relative(ROOT, sysmlPath),
      txt_path: path.relative(ROOT, txtPath),
      split: meta.split || "",
      quality: meta.quality || "",
      category: meta.category || "",
      likert_score: 1,
      similarity_percent: "0.0",
      structure_score: "",
      behavior_score: "",
      data_score: "",
      token_recall_percent: "0.0",
      parse_status: `parse_error: ${normalizeWhitespace(error.message)}`,
      matched_terms: "",
      missing_terms: ""
    };
  }
}

function findModelIds() {
  return fs
    .readdirSync(DATA_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d{6}$/.test(entry.name))
    .map((entry) => entry.name)
    .filter((modelId) => {
      const modelDir = path.join(DATA_DIR, modelId);
      return fs.existsSync(path.join(modelDir, `${modelId}.sysml`)) && fs.existsSync(path.join(modelDir, `${modelId}.txt`));
    })
    .sort();
}

function writeCsv(rows) {
  const headers = [
    "model_id",
    "sysml_path",
    "txt_path",
    "split",
    "quality",
    "category",
    "likert_score",
    "similarity_percent",
    "structure_score",
    "behavior_score",
    "data_score",
    "token_recall_percent",
    "parse_status",
    "matched_terms",
    "missing_terms"
  ];
  const lines = [headers.join(",")];
  rows.forEach((row) => {
    lines.push(headers.map((header) => csvEscape(row[header])).join(","));
  });
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, `${lines.join("\n")}\n`, "utf8");
}

function summarize(rows) {
  const parseErrors = rows.filter((row) => row.parse_status !== "ok").length;
  const averageSimilarity =
    rows.reduce((sum, row) => sum + Number.parseFloat(row.similarity_percent || "0"), 0) / Math.max(rows.length, 1);
  const distribution = rows.reduce((accumulator, row) => {
    accumulator[row.likert_score] = (accumulator[row.likert_score] || 0) + 1;
    return accumulator;
  }, {});

  return {
    total: rows.length,
    parseErrors,
    averageSimilarity: averageSimilarity.toFixed(1),
    distribution
  };
}

function main() {
  const parseModelText = loadParser();
  const modelIds = findModelIds();
  const rows = modelIds.map((modelId) => evaluateModel(parseModelText, modelId));
  writeCsv(rows);
  const summary = summarize(rows);

  console.log(`Scored ${summary.total} models.`);
  console.log(`Average similarity: ${summary.averageSimilarity}%`);
  console.log(`Parse errors: ${summary.parseErrors}`);
  console.log(
    `Likert distribution: 1=${summary.distribution[1] || 0}, 2=${summary.distribution[2] || 0}, 3=${summary.distribution[3] || 0}, 4=${summary.distribution[4] || 0}, 5=${summary.distribution[5] || 0}`
  );
  console.log(`CSV written to ${OUTPUT_FILE}`);
}

main();
