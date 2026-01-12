# Fabio Dynamic Pipe (ComfyUI Custom Nodes)

Pacote de custom nodes para ComfyUI que permite **empacotar múltiplas conexões em um único "pipe"** e depois **desempacotar** do outro lado, preservando a **ordem**.

---

## O que isso resolve

No ComfyUI, às vezes você quer “passar” vários objetos diferentes (ex.: `model`, `clip`, `latent`, `int`, `float`…) por **uma única conexão** no grafo — seja para simplificar o layout, evitar fios cruzando tudo ou modularizar sub-grafos.

Este pacote cria um **pipe** que carrega uma lista ordenada de valores, e no outro lado você recupera cada item em portas separadas, mantendo a ordem original.

---

## Nodes

### 1) Fabio Pipe In

**Função:** empacotar N entradas em 1 saída (`FABIO_PIPE`).

**Características:**
- Entradas **dinâmicas** (sem limite prático, limitado por `MAX_SLOTS` no código).
- Regra de UI: sempre existe **1 entrada extra** no final; quando essa entrada final for **conectada/preenchida**, o nó cria automaticamente **mais uma** entrada opcional.

**Nome das portas (UI):**
- As entradas são rotuladas pelo **tipo do dado** do que estiver conectado (ex.: `int`, `float`, `model`, `clip`, `latent`…).
- Se houver tipos repetidos, o rótulo ganha sufixos: `model`, `model_2`, `model_3`…

> Observação: o nome interno dos inputs (ex.: `in_01`, `in_02`…) não é alterado para não quebrar o workflow; apenas o **label visual** muda.

---

### 2) Fabio Pipe Out

**Função:** receber a saída do Pipe In (`FABIO_PIPE`) e **desempacotar** em múltiplas saídas.

**Características:**
- As saídas **espelham** as entradas do Pipe In: mesma quantidade e **mesma ordem**.
- Quando surge uma nova entrada no Pipe In, surge automaticamente uma nova saída no Pipe Out (via UI).

**Nome das portas (UI):**
- As saídas recebem nomes conforme os labels calculados no Pipe In:
  - Ex.: `int`, `float`, `model`, `model_2`, etc.

---

## Instalação

### Via git clone

Dentro de `ComfyUI/custom_nodes`:

```bash
git clone https://github.com/SEU_USUARIO/Fabio_Dynamic_Pipe.git
````

Depois:

1. Reinicie o ComfyUI
2. Faça hard refresh no navegador (Ctrl+F5)

---

## Estrutura do projeto

```
Fabio_Dynamic_Pipe/
  __init__.py
  nodes.py
  js/
    fabio_dynamic_pipe.js
  README.md
  LICENSE
  .gitignore
```

* Backend (Python): define tipos, empacota e desempacota.
* Frontend (JS): controla a UI dinâmica (criar/remover portas e atualizar labels).

---

## Configuração / Limites

Por padrão, o projeto usa:

* `MAX_SLOTS = 64`

Você pode aumentar para 128/256 alterando:

* `MAX_SLOTS` em `nodes.py`
* `MAX_SLOTS` em `js/fabio_dynamic_pipe.js`

---

## Categoria no ComfyUI

Os nodes aparecem na categoria:

* `Fabio Dynamic Pipe`

(Se você mudar a string `CATEGORY` no Python, ajuste também se o JS depender do match por categoria.)

---

## Licença

MIT

