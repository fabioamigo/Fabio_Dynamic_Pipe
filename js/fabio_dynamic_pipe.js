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

function uniqueName(base, counters) {
  const n = (counters[base] ?? 0) + 1;
  counters[base] = n;
  return n === 1 ? base : `${base}_${n}`;
}

function isConnectedInput(inp) {
  return inp && inp.link != null;
}

function hasLinks(out) {
  return out && Array.isArray(out.links) && out.links.length > 0;
}

function markDirty(node) {
  try {
    node.setDirtyCanvas(true, true);
  } catch (e) {}
  try {
    app.canvas.setDirty(true, true);
  } catch (e) {}
}

function refreshNodeSize(node) {
  try {
    node.setSize(node.computeSize());
  } catch (e) {}
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

function getLinkTypeFromInput(node, inp) {
  let t = "*";
  const g = node?.graph ?? app?.graph;
  const link = getLinkObj(g, inp?.link) ?? getLinkObj(app?.graph, inp?.link);
  if (link) {
    t = link.type ?? link.datatype ?? link.data_type ?? link.dataType ?? t;
  }
  return t ?? "*";
}

function ensureTrailingOptionalInput(node) {
  if (!node.inputs) node.inputs = [];
  if (node.inputs.length === 0) {
    node.addInput("optional", "*");
    return;
  }

  while (node.inputs.length > 0 && isConnectedInput(node.inputs[node.inputs.length - 1])) {
    node.addInput("optional", "*");
  }

  while (node.inputs.length >= 2) {
    const last = node.inputs[node.inputs.length - 1];
    const prev = node.inputs[node.inputs.length - 2];

    const lastIsOpt = (last?.name ?? "") === "optional" && !isConnectedInput(last);
    const prevIsOpt = (prev?.name ?? "") === "optional" && !isConnectedInput(prev);

    if (lastIsOpt && prevIsOpt) node.removeInput(node.inputs.length - 1);
    else break;
  }
}

function computeSchemaFromPipeIn(node) {
  const counters = {};
  const schema = [];

  if (!Array.isArray(node.inputs)) return schema;

  for (const inp of node.inputs) {
    if (!isConnectedInput(inp)) continue;

    const linkType = getLinkTypeFromInput(node, inp);
    const base = sanitizeBaseName(linkType);
    const name = uniqueName(base, counters);

    schema.push({ name, type: linkType });
  }

  return schema;
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

function normalizeSchema(schema) {
  if (!Array.isArray(schema)) return [];
  return schema
    .filter((x) => x && typeof x === "object")
    .map((x) => ({ name: String(x.name ?? "any"), type: x.type ?? "*" }));
}

function applyPipeOutDefault(node) {
  if (!Array.isArray(node.outputs)) node.outputs = [];

  // mantém quaisquer outputs que já tenham links (workflow antigo)
  // e garante pelo menos 1 output visível
  if (node.outputs.length === 0) {
    node.addOutput("out_1", "*");
  }

  // garante que o primeiro exista e fique visível
  const first = node.outputs[0];
  setSlotName(first, first?.name ?? "out_1");
  first.type = first.type ?? "*";
  first.hidden = false;

  // para outputs >0: se não estiverem conectados, remove (ou oculta) para o node "nascer" enxuto
  // preferi REMOVER para não aparecer uma lista gigante ao criar o node
  for (let i = node.outputs.length - 1; i >= 1; i--) {
    const out = node.outputs[i];
    if (hasLinks(out)) {
      // se tiver links, mantém visível
      out.hidden = false;
    } else {
      node.removeOutput(i);
    }
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

  while (node.outputs.length < desired) {
    node.addOutput("unused", "*");
  }

  for (let i = 0; i < node.outputs.length; i++) {
    const out = node.outputs[i];
    const connected = hasLinks(out);

    if (i < schema.length) {
      setSlotName(out, schema[i].name);
      out.type = schema[i].type ?? "*";
      out.hidden = false;
    } else {
      // mantém outputs conectados visíveis para não quebrar grafos
      const nm = connected ? `orphan_${i + 1}` : `unused_${i + 1}`;
      setSlotName(out, nm);
      out.type = "*";
      out.hidden = !connected;
    }
  }

  // remove outputs excedentes do fim se não estiverem conectados
  while (node.outputs.length > Math.max(schema.length, 1)) {
    const lastIndex = node.outputs.length - 1;
    const last = node.outputs[lastIndex];
    if (hasLinks(last)) break;
    if (lastIndex < schema.length) break;
    node.removeOutput(lastIndex);
  }

  refreshNodeSize(node);
}

function findDownstreamPipeOutNodesLive(pipeInNode) {
  const g = pipeInNode?.graph ?? app?.graph;
  if (!g) return [];

  const visitedNodeIds = new Set();
  const queue = [pipeInNode];
  const outNodes = [];

  const isPipeOut = (n) => n && (n.comfyClass === PIPE_OUT || n.type === PIPE_OUT);

  while (queue.length) {
    const node = queue.shift();
    if (!node || visitedNodeIds.has(node.id)) continue;
    visitedNodeIds.add(node.id);

    if (isPipeOut(node) && node !== pipeInNode) outNodes.push(node);

    const outs = Array.isArray(node.outputs) ? node.outputs : [];
    for (const o of outs) {
      if (!o || !Array.isArray(o.links)) continue;

      for (const linkId of o.links) {
        const link = getLinkObj(g, linkId) ?? getLinkObj(app?.graph, linkId);
        if (!link) continue;

        const targetId = link.target_id ?? link.targetId ?? link.to_id ?? link.toId;
        if (targetId == null) continue;

        const targetNode = getNodeByIdGlobal(Number(targetId));
        if (targetNode && !visitedNodeIds.has(targetNode.id)) queue.push(targetNode);
      }
    }
  }

  return outNodes;
}

function findPipeOutNodesFallbackAnyConnected() {
  const nodes = app?.graph?._nodes;
  if (!Array.isArray(nodes)) return [];

  const result = [];
  for (const n of nodes) {
    const isPipeOut = n && (n.comfyClass === PIPE_OUT || n.type === PIPE_OUT);
    if (!isPipeOut) continue;

    const inp = Array.isArray(n.inputs) ? n.inputs[0] : null;
    if (inp && inp.link != null) result.push(n);
  }
  return result;
}

function ensureUpdateButton(node) {
  const exists = Array.isArray(node.widgets) && node.widgets.some((w) => w?.options?.fabio_update === true);
  if (exists) return;

  const w = node.addWidget("button", "Update", "update", () => {
    try {
      node.fabioUpdateDynamicPipe?.();
    } catch (e) {
      console.error("[FabioDynamicPipe] update error:", e);
    }
  });

  w.options = w.options ?? {};
  w.options.fabio_update = true;
  w.serialize = false;
}

function initPipeInNode(node) {
  ensureTrailingOptionalInput(node);
  ensureUpdateButton(node);

  node.fabioUpdateDynamicPipe = () => {
    ensureTrailingOptionalInput(node);

    const schema = computeSchemaFromPipeIn(node);
    log("schema:", schema);

    node.properties = node.properties ?? {};
    node.properties.fabio_dynamic_pipe_schema = schema;
    node.properties.fabio_dynamic_pipe_schema_ts = Date.now();

    applySchemaToPipeInInputs(node, schema);

    let outs = findDownstreamPipeOutNodesLive(node);
    if (!outs.length) outs = findPipeOutNodesFallbackAnyConnected();

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

  if (Array.isArray(schema)) {
    applySchemaToPipeOutOutputs(node, schema);
  } else {
    // IMPORTANTE: node "nasce" enxuto: só 1 output
    applyPipeOutDefault(node);
  }

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
          ensureTrailingOptionalInput(this);
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
      refreshNodeSize(node);
      markDirty(node);
    }

    if (node?.comfyClass === PIPE_OUT || node?.type === PIPE_OUT) {
      initPipeOutNode(node);
    }
  },
});
