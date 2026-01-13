import os
from typing import Any, Dict, List

PIPE_MARKER = "__fabio_dynamic_pipe__"


def _env_int(name: str, default: int) -> int:
    try:
        v = int(os.environ.get(name, "").strip())
        return v if v > 0 else default
    except Exception:
        return default


MAX_OUTPUTS = _env_int("FABIO_DYNAMIC_PIPE_MAX_OUTPUTS", 128)

FABIO_PIPE_TYPE = "FABIO_PIPE"


class FabioDynamicPipeIn:
    @classmethod
    def INPUT_TYPES(cls) -> Dict[str, Dict[str, Any]]:
        # Entradas são dinâmicas via JS; o backend aceita **kwargs.
        return {"required": {}, "optional": {}}

    RETURN_TYPES = (FABIO_PIPE_TYPE,)
    RETURN_NAMES = ("pipe",)
    FUNCTION = "pack"
    CATEGORY = "Fabio/Dynamic Pipe"

    def pack(self, **kwargs):
        names: List[str] = []
        values: List[Any] = []

        for k, v in kwargs.items():
            if v is None:
                continue
            names.append(k)
            values.append(v)

        pipe = {
            PIPE_MARKER: True,
            "names": names,
            "values": values,
        }
        return (pipe,)


class FabioDynamicPipeOut:
    @classmethod
    def INPUT_TYPES(cls) -> Dict[str, Dict[str, Any]]:
        return {"required": {"pipe": (FABIO_PIPE_TYPE,)}}

    RETURN_TYPES = tuple(["*"] * MAX_OUTPUTS)
    RETURN_NAMES = tuple([f"out_{i+1}" for i in range(MAX_OUTPUTS)])
    FUNCTION = "unpack"
    CATEGORY = "Fabio/Dynamic Pipe"

    def unpack(self, pipe):
        values: List[Any] = []

        if isinstance(pipe, dict) and pipe.get(PIPE_MARKER) is True:
            v = pipe.get("values", [])
            if isinstance(v, list):
                values = v
            else:
                values = [v]
        elif isinstance(pipe, (list, tuple)):
            values = list(pipe)
        else:
            values = [pipe]

        out: List[Any] = [None] * MAX_OUTPUTS
        for i, val in enumerate(values[:MAX_OUTPUTS]):
            out[i] = val

        return tuple(out)


NODE_CLASS_MAPPINGS = {
    "FabioDynamicPipeIn": FabioDynamicPipeIn,
    "FabioDynamicPipeOut": FabioDynamicPipeOut,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "FabioDynamicPipeIn": "Fabio Dynamic Pipe In",
    "FabioDynamicPipeOut": "Fabio Dynaamic Pipe Out",
}
