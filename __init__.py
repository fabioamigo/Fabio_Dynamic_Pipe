from __future__ import annotations

from typing import Any, Dict, Tuple, List

from .nodes import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS

WEB_DIRECTORY = "./js"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]


PIPE_IN_CLASS_TYPE = "FabioDynamicPipeIn"
PIPE_OUT_CLASS_TYPE = "FabioDynamicPipeOut"


def _sorted_prompt_items(prompt: Dict[str, Any]):
    def key_fn(kv: Tuple[str, Any]):
        k, _ = kv
        try:
            return int(k)
        except Exception:
            return 10**18
    return sorted(prompt.items(), key=key_fn)


def _get_pipe_name(inputs: Any) -> str:
    if not isinstance(inputs, dict):
        return ""
    v = inputs.get("pipe_name")
    if isinstance(v, str):
        s = v.strip()
        if s:
            return s
    return ""


def onprompt(json_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Cabo virtual: conecta PipeOut.pipe -> PipeIn.pipe baseado em pipe_name.
    Atravessa subgraphs porque opera no prompt flattenado.

    Regras:
    - Se PipeOut já tiver "pipe" conectado no prompt, NÃO mexe.
    - Duplicidade de pipe_name em múltiplos Pipe In: ERRO (strict).
    """
    prompt = json_data.get("prompt")
    if not isinstance(prompt, dict):
        return json_data

    name_to_pipein: Dict[str, str] = {}
    duplicates: Dict[str, List[str]] = {}

    for node_id, node in _sorted_prompt_items(prompt):
        if not isinstance(node, dict):
            continue
        if node.get("class_type") != PIPE_IN_CLASS_TYPE:
            continue

        inputs = node.get("inputs")
        pname = _get_pipe_name(inputs)
        if not pname:
            continue

        if pname in name_to_pipein and name_to_pipein[pname] != node_id:
            duplicates.setdefault(pname, []).extend([name_to_pipein[pname], node_id])
        else:
            name_to_pipein[pname] = node_id

    if duplicates:
        lines = []
        for pname, ids in duplicates.items():
            uniq = sorted(set(ids), key=lambda x: int(x) if str(x).isdigit() else x)
            lines.append(f'- "{pname}": Pipe In nodes {", ".join(uniq)}')
        raise Exception(
            "Fabio Dynamic Pipe: duplicated pipe_name in multiple Pipe In nodes (strict mode).\n"
            "Make pipe_name unique.\n\n" + "\n".join(lines)
        )

    for _, node in _sorted_prompt_items(prompt):
        if not isinstance(node, dict):
            continue
        if node.get("class_type") != PIPE_OUT_CLASS_TYPE:
            continue

        inputs = node.get("inputs")
        if not isinstance(inputs, dict):
            continue

        if "pipe" in inputs:
            continue

        pname = _get_pipe_name(inputs)
        if not pname:
            continue

        pipein_id = name_to_pipein.get(pname)
        if not pipein_id:
            continue

        inputs["pipe"] = [pipein_id, 0]

    return json_data


try:
    from server import PromptServer
    PromptServer.instance.add_on_prompt_handler(onprompt)
except Exception as e:
    print(f"[FabioDynamicPipe] Failed to register onprompt handler: {e}")
