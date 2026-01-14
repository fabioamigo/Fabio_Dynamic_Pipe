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
        # Mantemos pipe_name como widget STRING.
        # NÃO dependemos mais do seed aqui para a UI, porque o JS cria o socket dinâmico "real".
        # (mas deixo um optional declarado para compatibilidade)
        return {
            "required": {
                "pipe_name": ("STRING", {"default": "Pipe Principal"}),
            },
            "optional": {
                "optional": ("*",),
            },
        }

    RETURN_TYPES = (FABIO_PIPE_TYPE,)
    RETURN_NAMES = ("pipe",)
    FUNCTION = "pack"
    CATEGORY = "Fabio/Dynamic Pipe"

    def pack(self, pipe_name: str, **kwargs):
        pname = (pipe_name or "").strip()

        names: List[str] = []
        values: List[Any] = []

        for k, v in kwargs.items():
            if v is None:
                continue
            names.append(k)
            values.append(v)

        pipe = {
            PIPE_MARKER: True,
            "pipe_name": pname,
            "names": names,
            "values": values,
        }
        return (pipe,)


class FabioDynamicPipeOut:
    @classmethod
    def INPUT_TYPES(cls) -> Dict[str, Dict[str, Any]]:
        return {
            "required": {
                "pipe_name": ("STRING", {"default": "Pipe Principal"}),
            },
            "optional": {
                "pipe": (FABIO_PIPE_TYPE,),
            },
        }

    RETURN_TYPES = tuple(["*"] * MAX_OUTPUTS)
    RETURN_NAMES = tuple([f"out_{i+1}" for i in range(MAX_OUTPUTS)])
    FUNCTION = "unpack"
    CATEGORY = "Fabio/Dynamic Pipe"

    def unpack(self, pipe_name: str, pipe=None):
        if not (isinstance(pipe, dict) and pipe.get(PIPE_MARKER) is True):
            raise Exception(
                f'FabioDynamicPipeOut("{pipe_name}"): missing/invalid pipe. '
                f'Ensure pipe_name matches a Pipe In and queue the workflow (or connect pipe manually).'
            )

        v = pipe.get("values", [])
        if not isinstance(v, list):
            v = []

        out: List[Any] = []
        for i in range(MAX_OUTPUTS):
            out.append(v[i] if i < len(v) else None)

        return tuple(out)


NODE_CLASS_MAPPINGS = {
    "FabioDynamicPipeIn": FabioDynamicPipeIn,
    "FabioDynamicPipeOut": FabioDynamicPipeOut,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "FabioDynamicPipeIn": "Fabio Dynamic Pipe In",
    "FabioDynamicPipeOut": "Fabio Dynamic Pipe Out",
}
