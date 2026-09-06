---
title: Visu editor
---

# The Visu editor in the Admin GUI

The Visu editor lives in the Admin GUI under **Visu editor** in the sidebar
navigation. It is where the pages of Visu 2.0 are created and laid out: normal
pages, popups, include pages and global include pages.

## Overview and access {#visu-editor}

The editor is an admin area. The menu entry only appears for a logged-in
administrator, and the `/visu-editor` route sends anyone else back to the
dashboard. That is deliberate: the Visu itself is the user-facing endpoint
(optionally without any login at all), while authoring belongs in the
administration, where permissions are evaluated.

The editor always works on exactly **one** page. The address is shareable:

```
/visu-editor/<page-id>
```

Without a page id the area still opens: the page tree is there, and the editor
says that the page selection is missing.

The screen has five areas:

| Area | Purpose |
|---|---|
| Page tree | create, select, reorder, move and delete pages and folders |
| Canvas | arrange elements, pixel-precise or responsive |
| Page properties | name, page kind, popup parameters, includes, access, skin |
| Preview | the real Visu showing the current draft |
| Authoring panel | widget palette, elements of the page, binding of the selected element |

Every area has its own help icon. Clicking it opens exactly the section of this
help that belongs to it.

## Page tree {#visu-page-tree}

The page tree shows the hierarchy of the Visu. A badge on each entry says what
it is: **folder**, **page**, **include page**, **global** or **popup**.

What the tree can do:

- **New page** and **New folder** create a node. A folder is structure only; it
  carries no content and no page kind.
- **Move up** and **Move down** change the order under the same parent. The
  order is not just a display question: for global include pages it decides the
  stacking (see
  [Global include pages](/en/visu/seitentypen#visu-page-global-includes)).
- **Move** attaches a node to a different parent or to the top level. Its own
  subtree is not offered as a target.
- **Delete** asks back by name. Deleting takes the whole subtree with it.

A page is not renamed in the tree but through the **Name** field in the page
properties. There is deliberately only one write path for the same value.

## Preview {#visu-editor-preview}

The preview is **not a re-implementation**. The frame runs the real Visu, in
preview mode, with the same skin and the same rendering chain the user sees. The
draft travels into the frame as a message; nothing is saved on the way.

Two things follow from that:

- What the preview shows is what the Visu shows after saving. An element the
  preview does not render will not be shown to the user either.
- Data point values in the preview are **real live values** from the server, not
  placeholders.

The preview carries the session of the logged-in administrator. It receives it
exclusively over the message bridge, never through the address: the frame URL
holds no token, and there is no query string that could contain one.

The preview is served by the server itself, at

```
/visu-v2/preview
```

The same deployment serves Visu 2.0 as a whole under `/visu-v2/`. Visu 1 remains
reachable, unchanged, under `/visu/`.

If the frame shows a notice instead of a preview, nothing answers at the preview
address. Two causes are common:

1. Visu 2.0 is not built, so there is nothing to serve.
2. In a development setup the Admin GUI and the Visu run on separate servers.
   Then `VITE_VISU_PREVIEW_URL` points at the preview path of the Visu server,
   and `VITE_PREVIEW_ALLOWED_ORIGINS` names the origin of the Admin GUI. The two
   settings belong together.

## Skin per page {#visu-page-skin}

The skin decides how a page is drawn, and it also decides which
[layout mode](/en/visu/canvas#visu-layout-modes) is honoured at all. The editor
states per skin what it renders: a page-owning skin evaluates coordinates, a
list-style skin only the order.
