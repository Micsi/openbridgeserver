---
title: Canvas and elements
---

# Canvas and elements

The page takes shape on the canvas. Elements come from the palette; their data
point binding and their visibility rule live in the form below.

## The canvas {#visu-editor-canvas}

The canvas shows the elements of the selected page. Above it sit two toolbars:
the upper one for layout and alignment, the lower one for ergonomics.

What the canvas can do:

- **Drag and resize** set position and size. Both snap to the configured
  **grid size**.
- **Alignment guides** appear as soon as two edges come close to each other.
- **Distribute** equalises the gaps. That is only a statement from three
  selected elements on; with two elements the button stays disabled.
- **Same size** applies the dimensions of the first selected element.
- **To front** and **To back** change the z-order.
- **Locked** protects an element from changes, **Hidden** removes it from the
  display without deleting it.
- **Multi-selection** by rubber band or with the shift key held; selected
  elements can be dragged together and **grouped**.
- **Copy**, **Paste** and **Duplicate** work across page boundaries too.
- **Undo** and **Redo** keep a stack of recent states. The arrow keys nudge the
  selected element pixel by pixel.

Saving happens through **Save**. The single exception is the order in responsive
mode: it is persisted immediately, because there it is the only statement about
the arrangement.

The canvas also shows the layers that do not belong to the page itself:
**global layers** and **include layers** can be shown and hidden, so the author
sees what they build on without editing it by accident.

## Pixel-precise or responsive {#visu-layout-modes}

Every page is authored in exactly one of the two modes. The **layout mode** sits
in the upper toolbar.

| Mode | What counts | For |
|---|---|---|
| **Pixel** | coordinates X, Y, width, height | floor plans, plant diagrams, fixed screens |
| **Responsive** | order and grouping only | phone, tablet, varying window widths |

Pixel-precise authoring is an **offer, not an obligation**. Working responsively
means no coordinate fields at all; the arrangement comes from dragging within
the order.

**The coordinates stay in place regardless.** Switching to responsive deletes no
number, it only switches off its effect; switching back to pixel returns exactly
the position that was last set. That is also why Visu 1 can read the same page
unchanged.

**Which mode is actually drawn is decided by the skin.** A page-owning skin
evaluates coordinates, a list-style skin only the order. The editor states below
the toolbar what the chosen skin makes of it.

The **breakpoints** belong to the page, not to the element. They are a list of
pixel widths in the toolbar; **preview width** sets the frame to one of them to
check the page at that width.

## Widget palette {#visu-widget-palette}

The palette offers the core widget types: light, switch, blind, venetian blind,
sensor, scene, media, camera, climate. A click places a new element on the page.

Every type has its own form, and the fields in it are not invented: they come
from the same mapping the Visu uses when rendering. A type the preview does not
render yet is marked as such in the palette instead of quietly staying empty.

## Data point binding {#visu-datapoint-binding}

An element is bound to a data point through **Choose data point**. The picker
searches **on the server**, not in a list held in the browser, and additionally
filters by data type. That keeps it usable in an installation with thousands of
data points.

Depending on the widget type there are several bindings: a light knows switching,
dimming and the matching status data points, a blind knows position and lock, and
so on. Every field has its own picker.

The bound value appears in the [preview](/en/visu/#visu-editor-preview) right
away, as a **live value from the server**. Toggling the data point for a check
shows up in the editor without a reload.

## Conditional visibility {#visu-visibility-rule}

**Visibility rule** gives an element a condition: it only appears when the
condition holds.

A rule consists of three parts:

- the **data point** whose value is watched,
- the **condition**: equal, not equal, less than, less than or equal, greater
  than, greater than or equal, truthy, falsy,
- the **threshold** to compare against. For "truthy" and "falsy" it is omitted.

The rule takes effect **in the host**, that is at the same place as in the
running Visu. That is why the preview shows exactly what the user will see, and
why the rule also applies on include and popup layers. A logged-in viewer sees
the change almost instantly, a guest at the polling interval of the guest view.

**Remove rule** takes the condition away again; the element is then always
visible.
