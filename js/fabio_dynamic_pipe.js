import { app } from "../../scripts/app.js";

const EXT_NAME = "fabio.dynamic_pipe";

const PIPE_IN = "FabioDynamicPipeIn";
const PIPE_OUT = "FabioDynamicPipeOut";
const PIPE_LINK_TYPE = "FABIO_PIPE";

const DEBUG = false;
function log(...args) {
  if (DEBUG) console.log("[FabioDynamicPipe]", ...args);
}

function sanitizeBaseName(s) {
  let base = (s ?? "any").toString().trim().toLowerCase();
  if (!base || base === "*" || base === "any") return "any";
  base = base.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (!base) return "any";
  if (/^[0-9]/.test(base)) base = `t_${base}`;
  return base;
}

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
  if (!node || typeof node !== "object") return null;

  const candidates = [
    node.subgraph,
    node.subgraph?.graph,
    node.subGraph,
    node.subGraph?.graph,
    node.subgraph_graph,
    node.subgraphGraph,
    node.inner_graph,
    node.innerGraph,
    node.properties?.subgraph,
    node.properties?.subgraph?.graph,
    node.properties?.subGraph,
    node.properties?.subGraph?.graph,
    node.properties?.inner_graph,
  ];

  for (const c of candidates) {
    if (looksLikeGraph(c)) return c;
  }
  return null;
}

function collectAllGraphs(rootGraph) {
  const root = rootGraph ?? app?.graph;
  const graphs = [];
  const visited = new Set();

  const walk = (g) => {
    if (!looksLikeGraph(g) || visited.has(g)) return;
    visited.add(g);
    graphs.push(g);

    for (const n of getGraphNodes(g)) {
      const sg = getSubgraphGraphFromNode(n);
      if (sg) walk(sg);
    }
  };

  walk(root);
  return graphs;
}

function buildNodeIndexDeep() {
  const graphs = collectAllGraphs(app?.graph);
  const map = new Map();

  for (const g of graphs) {
    for (const n of getGraphNodes(g)) {
      if (!n || n.id == null) continue;
      const idNum = Number(n.id);
      if (!Number.isNaN(idNum) && !map.has(idNum)) map.set(idNum, n);
    }
  }

  return { graphs, map };
}

function isConnectedInput(inp) {
  return inp && inp.link != null;
}

function hasLinks(out) {
  return out && Array.isArray(out.links) && out.links.length > 0;
}

function markDirty(node) {
  try { node.setDirtyCanvas(true, true); } catch (e) {}
  try { app.canvas.setDirty(true, true); } catch (e) {}
}

function refreshNodeSize(node) {
  try { node.setSize(node.computeSize()); } catch (e) {}
}

function setSlotName(slot, name) {
  slot.name = name;
  slot.label = name;
  slot.localized_name = name;
  slot.display_name = name;
}

function getNodeByIdGlobal(id) {
  try {
    if (app?.graph?._nodes_by_id) return app.graph._nodes_by_id(id);
  } catch (e) {}
  try {
    if (app?.graph?.getNodeById) return app.graph.getNodeById(id);
  } catch (e) {}
  try {
    const nodes = app?.graph?._nodes;
    if (Array.isArray(nodes)) return nodes.find((n) => n.id === id) ?? null;
  } catch (e) {}
  return null;
}

function getLinkObj(graph, linkId) {
  if (!graph || linkId == null) return null;

  const lid = typeof linkId === "number" ? linkId : Number(linkId);
  const links = graph.links ?? graph._links ?? graph.graph?.links ?? null;
  if (!links) return null;

  try {
    if (links instanceof Map) return links.get(lid) ?? links.get(String(lid)) ?? null;
  } catch (e) {}

  try {
    return links[lid] ?? links[String(lid)] ?? null;
  } catch (e) {}

  return null;
}

function getLinkObjDeep(graphs, preferredGraph, linkId) {
  let link = getLinkObj(preferredGraph, linkId) ?? getLinkObj(app?.graph, linkId);
  if (link) return link;

  for (const g of graphs) {
    if (!g || g === preferredGraph || g === app?.graph) continue;
    link = getLinkObj(g, linkId);
    if (link) return link;
  }

  return null;
}

function linkTargetId(link) {
  if (!link) return null;
  if (Array.isArray(link)) return link[3] ?? null; // [id, origin_id, origin_slot, target_id, target_slot, type]
  return (
    link.target_id ??
    link.targetId ??
    link.to_id ??
    link.toId ??
    link.target ??
    null
  );
}

function linkType(link) {
  if (!link) return "*";
  if (Array.isArray(link)) return link[5] ?? "*";
  return link.type ?? link.datatype ?? link.data_type ?? link.dataType ?? "*";
}

function getLinkTypeFromInputDeep(node, inp, graphs) {
  let t = "*";
  const g = node?.graph ?? app?.graph;
  const link = getLinkObjDeep(graphs, g, inp?.link);
  if (link) t = linkType(link) ?? t;
  return t ?? "*";
}

function ensureTrailingOptionalInput(node) {
  if (!node.inputs) node.inputs = [];

  if (node.inputs.length === 0) {
    node.addInput("optional", "*");
    return;
  }

  const last = () => node.inputs[node.inputs.length - 1];

  while (node.inputs.length > 0 && isConnectedInput(last())) {
    node.addInput("optional", "*");
  }

  while (node.inputs.length >= 2) {
    const a = node.inputs[node.inputs.length - 1];
    const b = node.inputs[node.inputs.length - 2];

    const aOpt = String(a?.name ?? "") === "optional" || String(a?.name ?? "") === "";
    const bOpt = String(b?.name ?? "") === "optional" || String(b?.name ?? "") === "";

    const aRem = aOpt && !isConnectedInput(a);
    const bRem = bOpt && !isConnectedInput(b);

    if (aRem && bRem) node.removeInput(node.inputs.length - 1);
    else break;
  }
}

/**
 * Fix: ao mover Pipe In para dentro de subgraph, algumas versões reidratam
 * com 1 input "optional" extra no começo. Regra do pacote: optional só no final.
 */
function normalizePipeInInputs(node) {
  if (!node || !Array.isArray(node.inputs)) return;

  while (node.inputs.length > 1) {
    const first = node.inputs[0];
    const nm = String(first?.name ?? "");
    const isOptLike = nm === "optional" || nm === "";
    if (!isOptLike) break;
    if (isConnectedInput(first)) break;

    const hasConnectedLater = node.inputs.slice(1).some((x) => isConnectedInput(x));
    if (!hasConnectedLater) break;

    node.removeInput(0);
  }

  ensureTrailingOptionalInput(node);
  refreshNodeSize(node);
}

function computeSchemaFromInputsDeep(node, graphs) {
  const counters = {};
  const schema = [];

  if (!Array.isArray(node.inputs)) return schema;

  for (const inp of node.inputs) {
    if (!isConnectedInput(inp)) continue;

    const t = getLinkTypeFromInputDeep(node, inp, graphs);
    const base = sanitizeBaseName(t);
    counters[base] = (counters[base] ?? 0) + 1;
    const name = counters[base] === 1 ? base : `${base}_${counters[base]}`;

    schema.push({ name, type: t });
  }

  return schema;
}

function normalizeSchema(schema) {
  if (!Array.isArray(schema)) return [];
  return schema
    .filter((x) => x && typeof x === "object")
    .map((x) => ({ name: String(x.name ?? "any"), type: x.type ?? "*" }));
}

function applySchemaToPipeInInputs(node, schema) {
  if (!Array.isArray(node.inputs)) return;

  let j = 0;
  for (let i = 0; i < node.inputs.length; i++) {
    const inp = node.inputs[i];
    if (isConnectedInput(inp)) {
      const item = schema[j++];
      setSlotName(inp, item?.name ?? inp.name);
      inp.type = "*";
    } else {
      setSlotName(inp, "optional");
      inp.type = "*";
    }
  }

  ensureTrailingOptionalInput(node);
  refreshNodeSize(node);
}

function applyPipeOutDefault(node) {
  if (!Array.isArray(node.outputs)) node.outputs = [];

  if (node.outputs.length === 0) node.addOutput("out_1", "*");

  const first = node.outputs[0];
  setSlotName(first, first?.name ?? "out_1");
  first.type = first.type ?? "*";
  first.hidden = false;

  // nascer “enxuto”: remove outputs >0 que não têm links
  for (let i = node.outputs.length - 1; i >= 1; i--) {
    const out = node.outputs[i];
    if (hasLinks(out)) out.hidden = false;
    else node.removeOutput(i);
  }

  refreshNodeSize(node);
  markDirty(node);
}

function applySchemaToPipeOutOutputs(node, schemaRaw) {
  const schema = normalizeSchema(schemaRaw);

  if (!Array.isArray(node.outputs)) node.outputs = [];

  const maxConnectedIndex = (() => {
    let max = -1;
    for (let i = 0; i < node.outputs.length; i++) {
      if (hasLinks(node.outputs[i])) max = i;
    }
    return max;
  })();

  const desired = Math.max(schema.length, maxConnectedIndex + 1, 1);

  while (node.outputs.length < desired) node.addOutput("unused", "*");

  for (let i = 0; i < node.outputs.length; i++) {
    const out = node.outputs[i];
    const connected = hasLinks(out);

    if (i < schema.length) {
      setSlotName(out, schema[i].name);
      out.type = schema[i].type ?? "*";
      out.hidden = false;
    } else {
      const nm = connected ? `orphan_${i + 1}` : `unused_${i + 1}`;
      setSlotName(out, nm);
      out.type = "*";
      out.hidden = !connected;
    }
  }

  while (node.outputs.length > Math.max(schema.length, 1)) {
    const lastIndex = node.outputs.length - 1;
    const last = node.outputs[lastIndex];
    if (hasLinks(last)) break;
    if (lastIndex < schema.length) break;
    node.removeOutput(lastIndex);
  }

  refreshNodeSize(node);
}

function isPipeOut(n) {
  return n && (n.comfyClass === PIPE_OUT || n.type === PIPE_OUT);
}

function isPipeIn(n) {
  return n && (n.comfyClass === PIPE_IN || n.type === PIPE_IN);
}

function uniqueById(nodes) {
  const out = [];
  const seen = new Set();
  for (const n of nodes) {
    const id = Number(n?.id);
    if (Number.isNaN(id)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(n);
  }
  return out;
}

/**
 * Tenta achar PipeOuts “downstream” por BFS (funciona em muitos casos),
 * mas pode falhar em fronteiras de subgraph dependendo da versão/impl.
 */
function findDownstreamPipeOutNodesLive(startNode) {
  const { graphs, map } = buildNodeIndexDeep();

  const visited = new Set();
  const queue = [startNode];
  const outNodes = [];

  while (queue.length) {
    const node = queue.shift();
    if (!node || node.id == null) continue;

    const idNum = Number(node.id);
    if (visited.has(idNum)) continue;
    visited.add(idNum);

    if (isPipeOut(node) && node !== startNode) outNodes.push(node);

    const outs = Array.isArray(node.outputs) ? node.outputs : [];
    for (const o of outs) {
      if (!o || !Array.isArray(o.links)) continue;

      for (const linkId of o.links) {
        const preferredGraph = node?.graph ?? startNode?.graph ?? app?.graph;
        const link = getLinkObjDeep(graphs, preferredGraph, linkId);
        if (!link) continue;

        const tid = linkTargetId(link);
        if (tid == null) continue;

        const targetNode = map.get(Number(tid)) ?? getNodeByIdGlobal(Number(tid));
        if (targetNode) queue.push(targetNode);
      }
    }
  }

  return uniqueById(outNodes);
}

/**
 * Fallback 1: pega PipeOuts já marcados pelo mesmo PipeIn (evita “puxar” outros pipes).
 */
function findPipeOutNodesTaggedBy(pipeInId) {
  const { graphs } = buildNodeIndexDeep();
  const result = [];

  for (const g of graphs) {
    for (const n of getGraphNodes(g)) {
      if (!isPipeOut(n)) continue;
      const from = n?.properties?.fabio_dynamic_pipe_schema_from;
      if (from == null) continue;
      if (Number(from) !== Number(pipeInId)) continue;
      result.push(n);
    }
  }

  return uniqueById(result);
}

/**
 * Fallback 2: scan profundo — atualiza PipeOuts que estejam conectados a um link FABIO_PIPE.
 * Isso é o que salva quando o ComfyUI “quebra” a travessia entre subgraphs na API de links.
 */
function findPipeOutNodesWithPipeInput() {
  const { graphs } = buildNodeIndexDeep();
  const result = [];

  for (const g of graphs) {
    for (const n of getGraphNodes(g)) {
      if (!isPipeOut(n)) continue;
      const inp0 = Array.isArray(n.inputs) ? n.inputs[0] : null;
      if (!inp0 || inp0.link == null) continue;

      const t = getLinkTypeFromInputDeep(n, inp0, graphs);
      if (t === PIPE_LINK_TYPE) result.push(n);
    }
  }

  return uniqueById(result);
}

function ensureUpdateButton(node) {
  const exists = Array.isArray(node.widgets) && node.widgets.some((w) => w?.options?.fabio_update === true);
  if (exists) return;

  const w = node.addWidget("button", "Update", "update", () => {
    try { node.fabioUpdateDynamicPipe?.(); }
    catch (e) { console.error("[FabioDynamicPipe] update error:", e); }
  });

  w.options = w.options ?? {};
  w.options.fabio_update = true;
  w.serialize = false;
}

function initPipeInNode(node) {
  normalizePipeInInputs(node);
  ensureUpdateButton(node);

  node.fabioUpdateDynamicPipe = () => {
    normalizePipeInInputs(node);

    const { graphs } = buildNodeIndexDeep();
    const schema = normalizeSchema(computeSchemaFromInputsDeep(node, graphs));
    log("PipeIn schema:", schema);

    node.properties = node.properties ?? {};
    node.properties.fabio_dynamic_pipe_schema = schema;
    node.properties.fabio_dynamic_pipe_schema_ts = Date.now();

    applySchemaToPipeInInputs(node, schema);

    // 1) BFS (quando dá)
    let outs = findDownstreamPipeOutNodesLive(node);

    // 2) Se BFS falhar: os que já foram marcados anteriormente por este PipeIn
    if (!outs.length) outs = findPipeOutNodesTaggedBy(node.id);

    // 3) Último fallback: scan profundo por tipo de link (funciona atravessando subgraphs)
    if (!outs.length) outs = findPipeOutNodesWithPipeInput();

    for (const outNode of outs) {
      outNode.properties = outNode.properties ?? {};
      outNode.properties.fabio_dynamic_pipe_schema = schema;
      outNode.properties.fabio_dynamic_pipe_schema_from = node.id;
      outNode.properties.fabio_dynamic_pipe_schema_ts = Date.now();

      applySchemaToPipeOutOutputs(outNode, schema);
      markDirty(outNode);
    }

    markDirty(node);
  };
}

function initPipeOutNode(node) {
  const schema = node?.properties?.fabio_dynamic_pipe_schema;
  if (Array.isArray(schema)) applySchemaToPipeOutOutputs(node, schema);
  else applyPipeOutDefault(node);

  markDirty(node);
}

app.registerExtension({
  name: EXT_NAME,

  async beforeRegisterNodeDef(nodeType) {
    const comfy = nodeType?.comfyClass ?? nodeType?.ComfyClass ?? nodeType?.type;

    if (comfy === PIPE_IN) {
      const orig = nodeType.prototype.onConnectionsChange;
      nodeType.prototype.onConnectionsChange = function (side) {
        const r = orig?.apply(this, arguments);
        if (side === 1) {
          normalizePipeInInputs(this);
          refreshNodeSize(this);
          markDirty(this);
        }
        return r;
      };
    }
  },

  async nodeCreated(node) {
    if (node?.comfyClass === PIPE_IN || node?.type === PIPE_IN) initPipeInNode(node);
    if (node?.comfyClass === PIPE_OUT || node?.type === PIPE_OUT) initPipeOutNode(node);
  },

  loadedGraphNode(node) {
    if (node?.comfyClass === PIPE_IN || node?.type === PIPE_IN) {
      initPipeInNode(node);
      const schema = node?.properties?.fabio_dynamic_pipe_schema;
      if (Array.isArray(schema)) applySchemaToPipeInInputs(node, schema);
      normalizePipeInInputs(node);
      refreshNodeSize(node);
      markDirty(node);
    }

    if (node?.comfyClass === PIPE_OUT || node?.type === PIPE_OUT) {
      initPipeOutNode(node);
    }
  },
});
