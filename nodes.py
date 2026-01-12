from __future__ import annotations

from typing import Any, Dict, List, Tuple


# ===== Ajuste aqui se quiser mais/menos portas =====
MAX_SLOTS = 64


class AnyType(str):
    """
    Tipo "coringa" que tende a passar pelos checks de tipo do Comfy/LiteGraph
    (usa o truque de nunca ser "diferente" em comparações de desigualdade).
    """
    def __ne__(self, __value: object) -> bool:
        return False


ANY_TYPE = AnyType("*")


class FabioPipeIn:
    """
    Empacota N entradas (dinâmicas na UI) em uma única saída do tipo FABIO_PIPE.
    """

    @classmethod
    def INPUT_TYPES(cls):
        # O Comfy exige a chave "required" (pode ser vazia).
        # Inputs "optional" só entram na execução se estiverem conectados.
        optional: Dict[str, Tuple[Any, Dict[str, Any]]] = {}
        for i in range(1, MAX_SLOTS + 1):
            key = f"in_{i:02d}"
            optional[key] = (ANY_TYPE, {"forceInput": True})
        return {"required": {}, "optional": optional}

    RETURN_TYPES = ("FABIO_PIPE",)
    RETURN_NAMES = ("pipe",)
    FUNCTION = "pack"
    CATEGORY = "Fabio/Dynamic Pipe"

    @classmethod
    def VALIDATE_INPUTS(cls, input_types=None, **kwargs):
        # Ao aceitar `input_types`, o Comfy pula a validação padrão de tipos.
        # Isso é útil para entradas coringa/dinâmicas. :contentReference[oaicite:2]{index=2}
        return True

    def pack(self, **kwargs):
        # kwargs conterá apenas os inputs opcionais conectados.
        items: List[Any] = []

        def idx(k: str) -> int:
            # "in_01" -> 1
            try:
                return int(k.split("_", 1)[1])
            except Exception:
                return 10**9

        for k in sorted(kwargs.keys(), key=idx):
            v = kwargs.get(k, None)
            if v is not None:
                items.append(v)

        pipe = {"items": items}
        return (pipe,)


class FabioPipeOut:
    """
    Desempacota o pipe em até MAX_SLOTS saídas (a UI esconde/mostra conforme necessário).
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"pipe": ("FABIO_PIPE", {})}}

    RETURN_TYPES = tuple([ANY_TYPE] * MAX_SLOTS)
    RETURN_NAMES = tuple([f"out_{i:02d}" for i in range(1, MAX_SLOTS + 1)])
    FUNCTION = "unpack"
    CATEGORY = "Fabio/Dynamic Pipe"

    @classmethod
    def VALIDATE_INPUTS(cls, input_types=None, **kwargs):
        # Mantém o contrato: precisa ser FABIO_PIPE.
        # Se input_types não vier, deixa passar e o erro (se houver) aparece na execução.
        if isinstance(input_types, dict):
            t = input_types.get("pipe")
            if t != "FABIO_PIPE":
                return "Entrada 'pipe' deve ser do tipo FABIO_PIPE (saída do Fabio Pipe In)."
        return True

    def unpack(self, pipe):
        items = []
        if isinstance(pipe, dict):
            items = pipe.get("items", [])
        if not isinstance(items, list):
            items = []

        outs: List[Any] = [None] * MAX_SLOTS
        for i in range(min(len(items), MAX_SLOTS)):
            outs[i] = items[i]
        return tuple(outs)
