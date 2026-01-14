# Fabio Dynamic Pipe (ComfyUI Custom Nodes)

**Fabio Dynamic Pipe** lets you pack multiple values into a single “pipe” connection and then unpack them later, preserving **order**.  
It is designed to stay usable even when nodes live in **different Subgraphs**, including **nested Subgraphs**.

## What this solves

In ComfyUI graphs it’s common to want to “carry” multiple things together (MODEL, CLIP, LATENT, INT, FLOAT, etc.) through a single edge to keep the graph clean.

This package provides two nodes:

- **Fabio Dynamic Pipe In**: packs **N inputs** into **one pipe output**
- **Fabio Dynamic Pipe Out**: unpacks the pipe into **N outputs** (same order)

## Key features

- **Dynamic inputs** on Pipe In (no practical limit)
  - Pipe In always keeps **one trailing optional input**
  - When the last optional input is connected, a new optional input is created automatically
- **Update buttons** on both nodes
  - Pipe In `Update` computes the schema (names/types) and propagates to Pipe Outs
  - Pipe Out `Update` re-applies the schema (useful if you changed pipe_name or imported a workflow)
- **Works across Subgraphs**
  - Update/propagation works even if Pipe In and Pipe Out are in different Subgraphs, including nested Subgraphs
- **Clean defaults**
  - Pipe In starts with a single visible optional input
  - Pipe Out starts with a single output (and grows only when schema is applied)
- **Virtual cable support**
  - You can keep the graph clean by using a shared **pipe_name**
  - At queue time, Pipe Out is auto-wired to the matching Pipe In (strict mode)

## Demo video

The repository includes a short demo video:

- `pipevideo.mp4`

If GitHub does not render the embedded player in your view, open the file directly from the repo.

```html
<video src="pipevideo.mp4" controls muted></video>
```

## How it works

### 1) Pipe naming (`pipe_name`)

Both Pipe In and Pipe Out have a `pipe_name` (string).
Use the same name on the Pipe Out(s) that should read the pipe.

**Important:** `pipe_name` must be unique per Pipe In (strict mode).
If two Pipe In nodes share the same name, the workflow will fail with a clear error.

### 2) Schema vs runtime values

* **Schema (structure)**: names + types used to build Pipe Out ports (UI)
* **Runtime values (ephemeral)**: the actual objects passed during execution

The schema is computed from the Pipe In inputs (based on connected link types) and stored globally in the frontend to make port updates robust (especially with Subgraphs).

### 3) Update flow (recommended)

1. Put **Pipe In** somewhere (root or Subgraph)
2. Connect the desired inputs (MODEL/CLIP/LATENT/INT/FLOAT/…)
3. Click **Update** on **Pipe In**

   * This updates input labels and propagates the output schema to all Pipe Outs with the same `pipe_name`
4. Place one or more **Pipe Out** nodes anywhere (root or other Subgraphs)
5. Set the same `pipe_name`
6. Click **Update** on Pipe Out (optional, but useful after import/rename)

## Port naming rules

* Inputs on Pipe In and outputs on Pipe Out are named from their **data type**

  * Examples: `model`, `clip`, `latent`, `int`, `float`
* If the same type appears multiple times:

  * `int`, `int_2`, `int_3`, ...

## Installation

1. Copy this repository into your ComfyUI custom nodes folder:

`ComfyUI/custom_nodes/Fabio_Dynamic_Pipe/`

Expected structure:

* `__init__.py`
* `nodes.py`
* `js/fabio_dynamic_pipe.js`
* `pipevideo.mp4`
* `LICENSE`

2. Restart ComfyUI
3. Hard refresh your browser (Ctrl+F5)

## Configuration

You can change the maximum number of available outputs on Pipe Out:

* `FABIO_DYNAMIC_PIPE_MAX_OUTPUTS` (default: 128)

## Troubleshooting

* **Pipe In shows no dynamic input socket**

  * Hard refresh (Ctrl+F5) and ensure the extension JS is loaded
* **Pipe Out doesn’t change ports after Update**

  * Make sure `pipe_name` matches
  * Click Update on Pipe In first (recommended)
* **Workflow error about duplicated pipe_name**

  * Rename one Pipe In to a unique name

## Release v0.3 highlights

* Fixed dynamic input initialization: dynamic sockets no longer conflict with widget-sockets (e.g., `pipe_name`)
* Pipe In now reliably starts with a single visible optional input (clean default)
* Update/propagation is robust across multiple Subgraph levels (including nested Subgraphs)
* Update buttons restored and consistent on both Pipe In and Pipe Out
* Virtual-cable wiring remains stable and compatible with Subgraph flattening

## License

MIT. See `LICENSE`.

```
::contentReference[oaicite:0]{index=0}
```

