from .nodes import FabioPipeIn, FabioPipeOut

WEB_DIRECTORY = "./js"

NODE_CLASS_MAPPINGS = {
    "Fabio Pipe In": FabioPipeIn,
    "Fabio Pipe Out": FabioPipeOut,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "Fabio Pipe In": "Fabio Pipe In",
    "Fabio Pipe Out": "Fabio Pipe Out",
}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
