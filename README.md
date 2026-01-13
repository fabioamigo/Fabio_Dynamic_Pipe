# Fabio Dynamic Pipe (ComfyUI Custom Nodes)

**Fabio Dynamic Pipe** is a small utility package for ComfyUI that lets you **pack multiple values into a single connection** (“pipe”) and later **unpack them back into individual outputs**, preserving **order** and using **type-based port names**.

This is designed to keep graphs clean and to route several objects (MODEL / CLIP / LATENT / IMAGE / INT / FLOAT / etc.) through a single link, including across **Reroute** nodes and **Subgraphs**.

---

## Included Nodes

### 1) Fabio Dynamic Pipe In
**Purpose:** Pack N inputs into 1 output.

- **Dynamic inputs:** effectively unlimited.
- Always keeps **one trailing optional** input at the end.
- When the trailing optional input is connected, a **new optional input** is created automatically.
- Provides an **Update** button:
  - Detects connected input types
  - Renames inputs using type-based names (`model`, `clip`, `latent`, `image`, `int`, `float`, ...)
  - Ensures unique names for repeated types (`int`, `int_2`, `int_3`, ...)
  - Propagates the schema downstream to update one or many **Pipe Out** nodes (including through Reroutes and across Subgraphs).

### 2) Fabio Dynaamic Pipe Out
**Purpose:** Unpack 1 pipe into N outputs.

- Outputs mirror the Pipe In schema (**same count, same order**).
- On creation, it starts minimal (only the first output is visible).
- After pressing **Update** on the corresponding Pipe In, outputs are resized and renamed accordingly.

> Note: The backend returns a bounded number of outputs (configurable). The UI shows only the schema-defined outputs.

---

## Installation

1. Copy or clone this repository into:

`ComfyUI/custom_nodes/Fabio_Dynamic_Pipe/`

2. Restart ComfyUI.

3. After updating the JS, hard reload your browser (Ctrl+Shift+R).

---

## Usage

1. Add **Fabio Dynamic Pipe In**
2. Connect as many inputs as you want (INT / FLOAT / IMAGE / etc.)
3. Click **Update** on the Pipe In node
4. Connect Pipe In **pipe** output to **Fabio Dynaamic Pipe Out**
5. Use the mirrored outputs from Pipe Out

---

## Configuration

### Environment Variables

- `FABIO_DYNAMIC_PIPE_MAX_OUTPUTS`
  - Default: `128`
  - Maximum number of unpacked outputs returned by the backend.

---

## Subgraphs Support

This package is intended to work when Pipe In and Pipe Out are:
- inside the same Subgraph
- inside different Subgraphs
- connected through one or more Reroute nodes

The Update action is triggered from **Pipe In** and attempts to reach all downstream **Pipe Out** nodes.

---

## License (MIT)

This project is licensed under the **MIT License**.

- See the `LICENSE` file in this repository for the full license text.
