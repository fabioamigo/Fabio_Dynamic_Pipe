import { app } from "../../scripts/app.js";

const EXT_NAME = "fabio.dynamic_pipe";

// Ajuste se você gerou mais/menos no Python:
const MAX_SLOTS = 64;

const META_KEY_LABELS = "__fabio_dynamic_pipe_labels";
const META_KEY_KIND = "__fabio_dynamic_pipe_kind";

function pad2(n) {
  return String(n).padStart(2, "0");
}

function inName(i1) {
  return `in_${pad2(i1)}`;
}

function outFallbackName(i1) {
  return `out_${pad2(i1)}`;
}

function normalizeType(t) {
  if (t === undefined || t === null) return "any";
  const s = String(t).split(",")[0].trim().toLowerCase();
  if (!s || s === "*" || s === "0" || s === "any") return "any";
  return s;
}

function uniquifyKeepingType(names) {
  const counts = {};
  return names.map((baseRaw) => {
    const base = baseRaw || "any";
    counts[base] = (counts[base] || 0) + 1;
    return counts[base] === 1 ? base : `${base}_${counts[base]}`;
  });
}

function refreshNodeSize(node) {
  try {
    const s = node.computeSize?.();
    if (Array.isArray(s)) node.size = s;
  } catch (_) {}
  node.setDirtyCanvas?.(true, true);
  node.graph?.setDirtyCanvas?.(true, true);
}

function getLinkInfoFromInput(node, inputIndex) {
  const inp = node.inputs?.[inputIndex];
  const linkId = inp?.link;
  if (linkId === null || linkId === undefined) return null;

  const graph = node.graph;
  const link = graph?.links?.[linkId];
  if (!link) return null;

  const origin = graph.getNodeById?.(link.origin_id);
  const out = origin?.outputs?.[link.origin_slot];
  return { link, origin, out };
}

function ensureDynamicInputsOnPipeIn(node) {
  const inputs = node.inputs || [];

  let highestConnected = -1;
  for (let i = 0; i < inputs.length; i++) {
    if (inputs[i]?.link !== null && inputs[i]?.link !== undefined) {
      highestConnected = i;
    }
  }

  // Queremos sempre “+1 entrada sobrando no final”
  const desired = Math.min(MAX_SLOTS, Math.max(1, highestConnected + 2));

  // Se veio do Python com 64 inputs, reduzimos removendo do fim.
  while ((node.inputs?.length || 0) > desired) {
    const lastIdx = node.inputs.length - 1;
    const last = node.inputs[lastIdx];
    if (last?.link !== null && last?.link !== undefined) break;
    node.removeInput?.(lastIdx);
  }

  // Se precisa crescer, adiciona até desired.
  while ((node.inputs?.length || 0) < desired) {
    const nextIdx = node.inputs.length; // 0-based
    const name = inName(nextIdx + 1);
    node.addInput?.(name, "*");
  }

  // Garante que sempre exista 1 slot “sobrando” no final
  // (se o último ficou conectado por carga de workflow, adiciona mais um)
  const lastIdx = node.inputs.length - 1;
  const last = node.inputs[lastIdx];
  if (last?.link !== null && last?.link !== undefined && node.inputs.length < MAX_SLOTS) {
    const name = inName(node.inputs.length + 1);
    node.addInput?.(name, "*");
  }
}

function updateLabelsOnPipeIn(node) {
  const inputs = node.inputs || [];
  const rawLabels = [];

  for (let i = 0; i < inputs.length; i++) {
    const info = getLinkInfoFromInput(node, i);
    if (!info) {
      rawLabels.push("any");
      continue;
    }
    rawLabels.push(normalizeType(info.out?.type));
  }

  const labels = uniquifyKeepingType(rawLabels);

  for (let i = 0; i < inputs.length; i++) {
    // NÃO mexe em inputs[i].name (isso é usado no prompt/backend).
    // Só muda o label exibido no canvas.
    inputs[i].label = labels[i];
  }

  node.properties = node.properties || {};
  node.properties[META_KEY_LABELS] = labels;

  return labels;
}

function notifyConnectedPipeOuts(pipeInNode) {
  const graph = pipeInNode.graph;
  if (!graph) return;

  const out0 = pipeInNode.outputs?.[0];
  const links = out0?.links || [];
  for (const linkId of links) {
    const link = graph.links?.[linkId];
    if (!link) continue;

    const target = graph.getNodeById?.(link.target_id);
    if (!target) continue;

    if (target?.[META_KEY_KIND] === "out" && typeof target._fabioDynamicPipeUpdate === "function") {
      target._fabioDynamicPipeUpdate();
    }
  }
}

function resolveConnectedPipeInFromPipeOut(pipeOutNode) {
  const graph = pipeOutNode.graph;
  if (!graph) return null;

  // PipeOut tem 1 input “pipe”, normalmente index 0
  const inp = pipeOutNode.inputs?.[0];
  const linkId = inp?.link;
  if (linkId === null || linkId === undefined) return null;

  const link = graph.links?.[linkId];
  if (!link) return null;

  const origin = graph.getNodeById?.(link.origin_id);
  if (!origin) return null;

  // pode existir reroute no meio; sobe alguns passos
  let cur = origin;
  for (let depth = 0; depth < 50; depth++) {
    if (cur?.[META_KEY_KIND] === "in") return cur;

    const curInp0 = cur.inputs?.[0];
    const curLinkId = curInp0?.link;
    if (curLinkId === null || curLinkId === undefined) return null;

    const curLink = graph.links?.[curLinkId];
    if (!curLink) return null;

    cur = graph.getNodeById?.(curLink.origin_id);
    if (!cur) return null;
  }

  return null;
}

function setPipeOutOutputsFromLabels(pipeOutNode, labels) {
  const desired = Math.min(MAX_SLOTS, labels.length);

  while ((pipeOutNode.outputs?.length || 0) > desired) {
    pipeOutNode.removeOutput?.(pipeOutNode.outputs.length - 1);
  }

  while ((pipeOutNode.outputs?.length || 0) < desired) {
    const nextIdx = pipeOutNode.outputs.length; // 0-based
    pipeOutNode.addOutput?.(outFallbackName(nextIdx + 1), "*");
  }

  for (let i = 0; i < desired; i++) {
    const out = pipeOutNode.outputs[i];
    // Aqui podemos mudar name sem “quebrar” backend, pois backend liga por índice.
    out.name = labels[i];
    out.label = labels[i];
  }
}

function classifyOurNode(nodeType, nodeData) {
  // Estratégia:
  // 1) categoria do Python (recomendado você usar "Fabio Dynamic Pipe")
  // 2) fallback: heurística pelo número de outputs
  const cat = String(nodeData?.category || "");
  const isOurs = cat.toLowerCase().includes("fabio") && cat.toLowerCase().includes("dynamic") && cat.toLowerCase().includes("pipe");
  if (!isOurs) return null;

  const outNames = nodeData?.output_name;
  if (Array.isArray(outNames)) {
    if (outNames.length === 1) return "in";
    if (outNames.length > 1) return "out";
  }

  // fallback pelo nome
  const n = String(nodeData?.name || nodeType?.comfyClass || "").toLowerCase();
  if (n.includes("pipe in")) return "in";
  if (n.includes("pipe out")) return "out";

  return null;
}

app.registerExtension({
  name: EXT_NAME,

  async beforeRegisterNodeDef(nodeType, nodeData) {
    const kind = classifyOurNode(nodeType, nodeData);
    if (!kind) return;

    // marca no prototype para ficar fácil reconhecer instâncias
    nodeType.prototype[META_KEY_KIND] = kind;

    const origOnConnectionsChange = nodeType.prototype.onConnectionsChange;
    const origOnConfigure = nodeType.prototype.onConfigure;
    const origOnAdded = nodeType.prototype.onAdded;

    if (kind === "in") {
      nodeType.prototype._fabioDynamicPipeUpdate = function () {
        ensureDynamicInputsOnPipeIn(this);
        updateLabelsOnPipeIn(this);
        refreshNodeSize(this);
        notifyConnectedPipeOuts(this);
      };

      nodeType.prototype.onConnectionsChange = function () {
        const r = origOnConnectionsChange?.apply(this, arguments);
        this._fabioDynamicPipeUpdate();
        return r;
      };

      nodeType.prototype.onAdded = function () {
        const r = origOnAdded?.apply(this, arguments);
        this._fabioDynamicPipeUpdate();
        return r;
      };

      nodeType.prototype.onConfigure = function () {
        const r = origOnConfigure?.apply(this, arguments);
        this._fabioDynamicPipeUpdate();
        return r;
      };
    }

    if (kind === "out") {
      nodeType.prototype._fabioDynamicPipeUpdate = function () {
        const src = resolveConnectedPipeInFromPipeOut(this);
        const labels =
          src?.properties?.[META_KEY_LABELS] ||
          (src ? updateLabelsOnPipeIn(src) : []);

        setPipeOutOutputsFromLabels(this, labels || []);
        refreshNodeSize(this);
      };

      nodeType.prototype.onConnectionsChange = function () {
        const r = origOnConnectionsChange?.apply(this, arguments);
        this._fabioDynamicPipeUpdate();
        return r;
      };

      nodeType.prototype.onAdded = function () {
        const r = origOnAdded?.apply(this, arguments);
        this._fabioDynamicPipeUpdate();
        return r;
      };

      nodeType.prototype.onConfigure = function () {
        const r = origOnConfigure?.apply(this, arguments);
        this._fabioDynamicPipeUpdate();
        return r;
      };
    }
  },
});
