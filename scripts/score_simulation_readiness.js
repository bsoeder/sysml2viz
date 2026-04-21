#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const OUTPUT_DIR = path.join(ROOT, "analysis");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "simulation_readiness_scores.csv");

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
        if (id === "diagram" || id === "overview") {
          element.viewBox = { baseVal: { x: 0, y: 0, width: 1600, height: 1000 } };
          element.setAttribute("viewBox", "0 0 1600 1000");
        }
        elementCache.set(id, element);
      }
      return elementCache.get(id);
    },
    querySelectorAll(selector) {
      if (selector === ".view-button") {
        return ["ov1", "bdd", "ibd", "activity", "sequence", "analysis", "simulation"].map((view) => {
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

function loadScorers() {
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
    removeEventListener() {},
    prompt() {
      return null;
    }
  };
  context.globalThis = context;
  vm.runInNewContext(
    `${source}\nmodule.exports = { parseModelText, evaluateSimulationReadiness };`,
    context,
    { filename: "static/app.js" }
  );
  return context.module.exports;
}

function findSysmlFiles(rootDir) {
  const files = [];
  const queue = [rootDir];
  while (queue.length) {
    const current = queue.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".sysml")) {
        files.push(fullPath);
      }
    }
  }
  return files.sort();
}

function csvEscape(value) {
  const normalized = String(value ?? "");
  return /[",\n]/.test(normalized) ? `"${normalized.replace(/"/g, "\"\"")}"` : normalized;
}

function formatScore(value) {
  return Number.isFinite(value) ? value.toFixed(1) : "";
}

function cardById(result, id) {
  return (result.cards || []).find((card) => card.id === id) || null;
}

function joinedTerms(card, key) {
  return ((card && card[key]) || []).join(" | ");
}

function main() {
  const { parseModelText, evaluateSimulationReadiness } = loadScorers();
  const rows = [];
  let okCount = 0;
  let errorCount = 0;
  let totalScore = 0;

  for (const filePath of findSysmlFiles(DATA_DIR)) {
    const relativePath = path.relative(ROOT, filePath).replace(/\\/g, "/");
    try {
      const text = fs.readFileSync(filePath, "utf8");
      const model = parseModelText(text);
      const readiness = evaluateSimulationReadiness(model, relativePath, text);
      const overallCard = cardById(readiness, "simulation:overall");
      const structuralCard = cardById(readiness, "simulation:l1");
      const behavioralCard = cardById(readiness, "simulation:l2");
      const propertyCard = cardById(readiness, "simulation:l3");
      const traceCard = cardById(readiness, "simulation:trace");
      const repairCard = cardById(readiness, "simulation:repair");

      rows.push({
        sysml_path: relativePath,
        readiness_percent: formatScore(readiness.overallScore),
        readiness_band: readiness.band?.label || "",
        l1_structural_score: formatScore(structuralCard?.scoreValue),
        l2_behavioral_score: formatScore(behavioralCard?.scoreValue),
        l3_property_score: formatScore(propertyCard?.scoreValue),
        observability_score: formatScore(traceCard?.scoreValue),
        repair_score: formatScore(repairCard?.scoreValue),
        sequence_validity: readiness.sequenceValidityText || "",
        ready_signals: joinedTerms(overallCard, "matchedTerms"),
        improvement_cues: joinedTerms(overallCard, "missingTerms"),
        parse_status: "ok"
      });
      okCount += 1;
      totalScore += readiness.overallScore || 0;
    } catch (error) {
      rows.push({
        sysml_path: relativePath,
        readiness_percent: "",
        readiness_band: "",
        l1_structural_score: "",
        l2_behavioral_score: "",
        l3_property_score: "",
        observability_score: "",
        repair_score: "",
        sequence_validity: "",
        ready_signals: "",
        improvement_cues: String(error.message || error),
        parse_status: "error"
      });
      errorCount += 1;
    }
  }

  const headers = [
    "sysml_path",
    "readiness_percent",
    "readiness_band",
    "l1_structural_score",
    "l2_behavioral_score",
    "l3_property_score",
    "observability_score",
    "repair_score",
    "sequence_validity",
    "ready_signals",
    "improvement_cues",
    "parse_status"
  ];

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const csv = [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(","))
  ].join("\n");
  fs.writeFileSync(OUTPUT_FILE, `${csv}\n`, "utf8");

  const averageScore = okCount ? totalScore / okCount : 0;
  console.log(
    `Wrote ${rows.length} rows to ${OUTPUT_FILE} (${okCount} scored, ${errorCount} errors, average readiness ${averageScore.toFixed(1)}%).`
  );
}

main();
