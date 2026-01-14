const { app } = window.comfyAPI.app;

const EXT_NAME = "fabio.dynamic_pipe.named.v7";

const PIPE_IN = "FabioDynamicPipeIn";
const PIPE_OUT = "FabioDynamicPipeOut";

const GLOBAL_STORE_KEY = "__fabio_dynamic_pipe_schema_store__";
const PIPE_NAME_WIDGET = "pipe_name";

const SCHEMA_PROP = "fabio_dynamic_pipe_schema";
const SCHEMA_TS_PROP = "fabio_dynamic_pipe_schema_ts";

console.log("[FabioDynamicPipe] JS loaded:", EXT_NAME);

function getGlobalStore() {
  window[GLOBAL_STORE_KEY] ??= { schemas: {} };
  window[GLOBAL_STORE_KEY].schemas ??= {};
  return window[GLOBAL_STORE_KEY];
}

function markDirty(node) {
  try { node.setDirtyCanvas(true, true); } catch (_) {}
  try { node.graph?.setDirtyCanvas?.(true, true); } catch (_) {}
  try { app.canvas?.setDirty?.(true, true); } catch (_) {}
  try { node.graph?.change?.(); } catch (_) {}
}

function refreshNodeSize(node) {
  try { node.setSize(node.computeSize()); } catch (_) {}
}

function normalizeSlotForRender(slot) {
  if (!slot || typeof slot !== "object") return;
  slot.hidden = false;
  slot.disabled = false;
  slot.computedDisabled = false;
}

function setSlotName(slot, name) {
  if (!slot) return;
  normalizeSlotForRender(slot);
  const n = String(name ?? "");
  slot.name = n;
  slot.label = n;
  slot.localized_name = n;
  slot.display_name = n;
}

function isWidgetSlot(slot) {
  return !!slot?.widget;
}

function isConnectedInput(inp) {
  return inp && inp.link != null;
}

function hasLinks(out) {
  return out && Array.isArray(out.links) && out.links.length > 0;
}

function sanitizeBaseName(s) {
  let base = (s ?? "any").toString().trim().toLowerCase();
  if (!base || base === "*" || base === "any") return "any";
  base = base.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (!base) return "any";
  if (/^[0-9]/.test(base)) base = `t_${base}`;
  return base;
}

function uniqueName(base, counters) {
  const n = (counters[base] ?? 0) + 1;
  counters[base] = n;
  return n === 1 ? base : `${base}_${n}`;
}

// ---------- subgraph traversal ----------
function looksLikeGraph(g) {
  return g && typeof g === "object" && (Array.isArray(g._nodes) || Array.isArray(g.nodes));
}
function getGraphNodes(g) {
  if (!g) return [];
  if (Array.isArray(g._nodes)) return g._nodes;
  if (Array.isArray(g.nodes)) return g.nodes;
  return [];
}
function getSubgraphGraphFromNode(node) {
  const cands = [
    node?.subgraph,
    node?.subgraph?.graph,
    node?.subGraph,
    node?.subGraph?.graph,
    node?.inner_graph,
    node?.innerGraph,
    node?.properties?.subgraph,
    node?.properties?.subgraph?.graph,
    node?.properties?.inner_graph,
  ];
  for (const c of cands) if (looksLikeGraph(c)) return c;
  return null;
}
function getRootGraphFrom(graph) {
  let g = graph ?? app?.graph;
  while (g && g._subgraph_node && g._subgraph_node.graph) g = g._subgraph_node.graph;
  return g ?? graph ?? app?.graph;
}
function collectAllGraphs(rootGraph) {
  const root = getRootGraphFrom(rootGraph);
  const visited = new Set();
  const out = [];
  const walk = (g) => {
    if (!looksLikeGraph(g) || visited.has(g)) return;
    visited.add(g);
    out.push(g);
    for (const n of getGraphNodes(g)) {
      const sg = getSubgraphGraphFromNode(n);
      if (sg) walk(sg);
    }
  };
  walk(root);
  return out;
}

function getLinkObjAnyGraph(linkId) {
  if (linkId == null) return null;
  const lid = typeof linkId === "number" ? linkId : Number(linkId);
  const graphs = collectAllGraphs(app?.graph);
  for (const g of graphs) {
    const links = g.links ?? g._links ?? g.graph?.links ?? null;
    if (!links) continue;
    try {
      if (links instanceof Map) {
        const obj = links.get(lid) ?? links.get(String(lid)) ?? null;
        if (obj) return obj;
      }
    } catch (_) {}
    try {
      const obj = links[lid] ?? links[String(lid)] ?? null;
      if (obj) return obj;
    } catch (_) {}
  }
  return null;
}

function getTypeFromInputLink(inp) {
  const link = getLinkObjAnyGraph(inp?.link);
  let t = link?.type ?? link?.datatype ?? link?.data_type ?? link?.dataType ?? "*";
  if (!t) t = "*";
  return t;
}

// ---------- pipe_name ----------
function getPipeName(node) {
  const w = Array.isArray(node?.widgets) ? node.widgets.find(x => x?.name === PIPE_NAME_WIDGET) : null;
  if (w && typeof w.value === "string" && w.value.trim()) return w.value.trim();
  const p = node?.properties?.[PIPE_NAME_WIDGET];
  if (typeof p === "string" && p.trim()) return p.trim();
  return "";
}

// ---------- Update button ----------
function ensureUpdateButton(node, handlerPropName) {
  node.widgets = node.widgets ?? [];
  let w = node.widgets.find(x => x?.type === "button" && x?.name === "Update" && x?.options?.fabio_update === true);
  if (!w) {
    w = node.addWidget("button", "Update", "update", () => node?.[handlerPropName]?.());
    w.options = w.options ?? {};
    w.options.fabio_update = true;
    w.serialize = false;
  } else {
    w.callback = () => node?.[handlerPropName]?.();
  }
}

// ============ NOVA ABORDAGEM (CORRETA): só mexe em inputs dinâmicos (sem slot.widget) ============

function dynamicInputIndexes(node) {
  if (!Array.isArray(node.inputs)) return [];
  const idxs = [];
  for (let i = 0; i < node.inputs.length; i++) {
    if (!isWidgetSlot(node.inputs[i])) idxs.push(i);
  }
  return idxs;
}

function ensureSeedDynamicInput(node) {
  node.inputs = node.inputs ?? [];
  const dyn = dynamicInputIndexes(node);
  if (dyn.length > 0) {
    // normaliza render dos dinâmicos existentes
    for (const i of dyn) normalizeSlotForRender(node.inputs[i]);
    return;
  }

  // cria um socket real (não-widget) no final
  try {
    node.addInput("optional", "*");
  } catch (_) {
    node.inputs.push({ name: "optional", type: "*", link: null });
  }

  // garantir que o último criado é dinâmico (sem widget)
  const last = node.inputs[node.inputs.length - 1];
  if (last) {
    // se por algum motivo virou widget-slot, força criar outro
    if (isWidgetSlot(last)) {
      try { node.addInput("optional", "*"); } catch (_) { node.inputs.push({ name: "optional", type: "*", link: null }); }
    }
  }

  // normaliza o último dinâmico
  const dyn2 = dynamicInputIndexes(node);
  const tailIdx = dyn2[dyn2.length - 1];
  const tail = node.inputs[tailIdx];
  if (tail) {
    normalizeSlotForRender(tail);
    setSlotName(tail, "optional");
    tail.type = "*";
    tail.link = null;
  }
}

function cleanupPipeInInputs(node) {
  if (!node) return;
  node.inputs = node.inputs ?? [];

  // 1) garante ao menos 1 socket dinâmico real
  ensureSeedDynamicInput(node);

  // 2) remove dinâmicos desconectados exceto o último dinâmico (varre de trás pra frente)
  const dynIdxs = dynamicInputIndexes(node);
  if (dynIdxs.length >= 2) {
    const lastDynIdx = dynIdxs[dynIdxs.length - 1];
    for (let k = dynIdxs.length - 2; k >= 0; k--) {
      const idx = dynIdxs[k];
      const inp = node.inputs[idx];
      if (!inp) continue;
      if (idx === lastDynIdx) continue;
      if (inp.link == null) {
        try { node.removeInput(idx); } catch (_) {}
      }
    }
  }

  // 3) se o último dinâmico está conectado, adiciona mais um dinâmico
  let dynIdxs2 = dynamicInputIndexes(node);
  let lastDynIdx2 = dynIdxs2[dynIdxs2.length - 1];
  let lastDyn2 = node.inputs[lastDynIdx2];

  if (lastDyn2 && isConnectedInput(lastDyn2)) {
    try { node.addInput("optional", "*"); } catch (_) { node.inputs.push({ name: "optional", type: "*", link: null }); }
  }

  // 4) renomeia todo dinâmico desconectado como optional; preserva widget slots SEM TOCAR
  dynIdxs2 = dynamicInputIndexes(node);
  lastDynIdx2 = dynIdxs2[dynIdxs2.length - 1];

  for (const idx of dynIdxs2) {
    const inp = node.inputs[idx];
    if (!inp) continue;
    normalizeSlotForRender(inp);
    if (idx === lastDynIdx2 || inp.link == null) {
      setSlotName(inp, "optional");
      inp.type = "*";
    }
  }

  refreshNodeSize(node);
  markDirty(node);
}

function schedulePipeInCleanup(node) {
  setTimeout(() => cleanupPipeInInputs(node), 0);
  setTimeout(() => cleanupPipeInInputs(node), 50);
  setTimeout(() => cleanupPipeInInputs(node), 200);
}

function computeSchemaFromPipeIn(node) {
  const counters = {};
  const schema = [];

  const dynIdxs = dynamicInputIndexes(node);
  for (const idx of dynIdxs) {
    const inp = node.inputs[idx];
    if (!inp || inp.link == null) continue;
    const linkType = getTypeFromInputLink(inp);
    const base = sanitizeBaseName(linkType);
    const name = uniqueName(base, counters);
    schema.push({ name, type: linkType });
  }
  return schema;
}

function normalizeSchema(schema) {
  if (!Array.isArray(schema)) return [];
  return schema
    .filter(x => x && typeof x === "object")
    .map(x => ({ name: String(x.name ?? "any"), type: x.type ?? "*" }));
}

function applySchemaToPipeInInputs(node, schemaRaw) {
  const schema = normalizeSchema(schemaRaw);
  let j = 0;

  const dynIdxs = dynamicInputIndexes(node);
  for (const idx of dynIdxs) {
    const inp = node.inputs[idx];
    if (!inp) continue;
    normalizeSlotForRender(inp);

    if (inp.link != null) {
      const item = schema[j++];
      if (item?.name) setSlotName(inp, item.name);
    } else {
      setSlotName(inp, "optional");
    }
    inp.type = "*";
  }

  cleanupPipeInInputs(node);
  refreshNodeSize(node);
  markDirty(node);
}

// ---------- Pipe Out ----------
function applyPipeOutDefault(node) {
  node.outputs = node.outputs ?? [];

  if (node.outputs.length === 0) {
    try { node.addOutput("out_1", "*"); } catch (_) {}
  }

  const first = node.outputs[0];
  if (first) {
    first.hidden = false;
    first.disabled = false;
    setSlotName(first, "out_1");
    first.type = "*";
  }

  for (let i = node.outputs.length - 1; i >= 1; i--) {
    const out = node.outputs[i];
    if (hasLinks(out)) continue;
    try { node.removeOutput(i); } catch (_) {}
  }

  refreshNodeSize(node);
  markDirty(node);
}

function applySchemaToPipeOutOutputs(node, schemaRaw) {
  const schema = normalizeSchema(schemaRaw);
  node.outputs = node.outputs ?? [];

  let maxConnected = -1;
  for (let i = 0; i < node.outputs.length; i++) if (hasLinks(node.outputs[i])) maxConnected = i;

  const desired = Math.max(schema.length, maxConnected + 1, 1);

  while (node.outputs.length < desired) {
    try { node.addOutput("unused", "*"); } catch (_) { break; }
  }

  for (let i = 0; i < desired; i++) {
    const out = node.outputs[i];
    if (!out) continue;
    out.hidden = false;
    out.disabled = false;
    if (i < schema.length) setSlotName(out, schema[i].name);
    else setSlotName(out, `out_${i + 1}`);
    out.type = "*";
  }

  for (let i = node.outputs.length - 1; i >= desired; i--) {
    const out = node.outputs[i];
    if (hasLinks(out)) continue;
    try { node.removeOutput(i); } catch (_) {}
  }

  refreshNodeSize(node);
  markDirty(node);
}

// ---------- store rebuild ----------
function rebuildStoreFromAllPipeIns() {
  const store = getGlobalStore();
  const schemas = store.schemas;
  for (const k of Object.keys(schemas)) delete schemas[k];

  const graphs = collectAllGraphs(app?.graph);
  for (const g of graphs) {
    for (const n of getGraphNodes(g)) {
      if (n?.comfyClass !== PIPE_IN && n?.type !== PIPE_IN) continue;
      const pname = getPipeName(n);
      if (!pname) continue;

      let schema = n?.properties?.[SCHEMA_PROP];
      if (!Array.isArray(schema) || schema.length === 0) schema = computeSchemaFromPipeIn(n);
      schema = normalizeSchema(schema);

      if (schema.length) schemas[pname] = schema;
    }
  }
}

function findAllPipeOutsByName(pipeName) {
  const out = [];
  const graphs = collectAllGraphs(app?.graph);
  for (const g of graphs) {
    for (const n of getGraphNodes(g)) {
      if (n?.comfyClass !== PIPE_OUT && n?.type !== PIPE_OUT) continue;
      if (getPipeName(n) === pipeName) out.push(n);
    }
  }
  return out;
}

// ---------- init instances ----------
function initPipeInInstance(node) {
  if (node.__fabio_inited_in) return;
  node.__fabio_inited_in = true;

  cleanupPipeInInputs(node);
  schedulePipeInCleanup(node);

  node.fabioUpdateDynamicPipeIn = () => {
    cleanupPipeInInputs(node);
    rebuildStoreFromAllPipeIns();

    const pname = getPipeName(node);
    const schema = normalizeSchema(computeSchemaFromPipeIn(node));

    node.properties = node.properties ?? {};
    node.properties[SCHEMA_PROP] = schema;
    node.properties[SCHEMA_TS_PROP] = Date.now();

    const store = getGlobalStore();
    if (pname) store.schemas[pname] = schema;

    applySchemaToPipeInInputs(node, schema);

    if (pname) {
      const outs = findAllPipeOutsByName(pname);
      for (const o of outs) o.fabioUpdateDynamicPipeOut?.();
    }

    markDirty(node);
  };

  ensureUpdateButton(node, "fabioUpdateDynamicPipeIn");

  const origConn = node.onConnectionsChange;
  node.onConnectionsChange = function (type) {
    const r = origConn?.apply(this, arguments);
    if (type === 1) cleanupPipeInInputs(this);
    return r;
  };
}

function initPipeOutInstance(node) {
  if (node.__fabio_inited_out) return;
  node.__fabio_inited_out = true;

  applyPipeOutDefault(node);

  node.fabioUpdateDynamicPipeOut = () => {
    rebuildStoreFromAllPipeIns();
    const pname = getPipeName(node);
    const store = getGlobalStore();
    const schema = pname ? store.schemas[pname] : null;

    if (Array.isArray(schema) && schema.length) {
      const norm = normalizeSchema(schema);
      applySchemaToPipeOutOutputs(node, norm);
      node.properties = node.properties ?? {};
      node.properties[SCHEMA_PROP] = norm;
      node.properties[SCHEMA_TS_PROP] = Date.now();
    } else {
      applyPipeOutDefault(node);
    }
  };

  ensureUpdateButton(node, "fabioUpdateDynamicPipeOut");
}

// ---------- patch via beforeRegisterNodeDef ----------
function patchNodeType(nodeType, kind) {
  const p = nodeType.prototype;

  const origCreated = p.onNodeCreated;
  p.onNodeCreated = function () {
    const r = origCreated?.apply(this, arguments);
    if (kind === "in") {
      initPipeInInstance(this);
      schedulePipeInCleanup(this);
    } else {
      initPipeOutInstance(this);
      setTimeout(() => applyPipeOutDefault(this), 0);
      setTimeout(() => applyPipeOutDefault(this), 50);
    }
    return r;
  };

  const origConfigure = p.onConfigure;
  p.onConfigure = function () {
    const r = origConfigure?.apply(this, arguments);
    if (kind === "in") {
      initPipeInInstance(this);
      schedulePipeInCleanup(this);
    } else {
      initPipeOutInstance(this);
      setTimeout(() => applyPipeOutDefault(this), 0);
      setTimeout(() => applyPipeOutDefault(this), 50);
    }
    return r;
  };

  const origAdded = p.onAdded;
  p.onAdded = function () {
    const r = origAdded?.apply(this, arguments);
    if (kind === "in") {
      initPipeInInstance(this);
      schedulePipeInCleanup(this);
    } else {
      initPipeOutInstance(this);
      setTimeout(() => applyPipeOutDefault(this), 0);
    }
    return r;
  };
}

app.registerExtension({
  name: EXT_NAME,
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name === PIPE_IN) patchNodeType(nodeType, "in");
    if (nodeData?.name === PIPE_OUT) patchNodeType(nodeType, "out");
  },
});
