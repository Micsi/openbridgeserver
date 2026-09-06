---
title: Page kinds
---

# Page kinds

Every Visu page has a kind. It decides where the page appears, what it may embed
and how it is drawn. It is set in the **page properties** of the Visu editor.

## Page kinds {#visu-page-kinds}

The editor offers four kinds:

| Kind | What it means |
|---|---|
| **Normal page** | A page of the navigation. It receives the global include pages. |
| **Include page** | An ordinary page that is embedded by at least one other page. |
| **Global include page** | Embedded automatically into every normal page. |
| **Popup** | Sits above the page, is opened through a link and is not part of the navigation. |

**Include page is a derived role, not a setting.** A page becomes an include
page as soon as another page adds it to its include list, and it stops being one
when the last reference disappears. That is why the editor refuses to save
"include page": it says so beforehand instead of silently falling back to
"normal page".

The kind also appears as a badge in the page tree, and the Visu navigation hides
global include pages and popups. Existing pages from before page kinds are
normal pages; nothing about them changes.

## Popups and their parameters {#visu-page-popup}

A popup is a page of its own. It is not part of the navigation but opened from
another page. Any number of **different** popups may be open at the same time;
the same popup is never opened twice.

The page properties offer these settings:

| Parameter | Effect |
|---|---|
| **X**, **Y** | Position in pixels. If either is missing, the popup is centred. |
| **Width**, **Height** | Size in pixels. Without a value the skin decides. |
| **Auto close (ms)** | Time span in milliseconds. The popup then closes by itself. |
| **Open exclusively** | Modal: while the popup is open, everything below it is inert. |
| **Animation** | The popup fades in instead of appearing instantly. |
| **Drop shadow** | The popup is lifted off the page with a shadow. |
| **Dim backdrop** | The area behind the popup is dimmed. |

Two rules that easily surprise:

- **The auto-close deadline is not extended by opening the popup again.**
  Reopening an already open popup does not grant a new time span; it closes at
  the deadline that started with the first opening.
- **A popup receives no global include pages.** It is a section above the page,
  not a page of the navigation, and it may not include anything itself either.

## Individual include pages {#visu-page-includes}

A normal page can embed other pages. The selection is an ordered list in the
page properties; the order of the list is the order of the rendering.

The rules:

- The target may be a **normal page** or a **global include page**, never a
  popup.
- A page cannot embed itself.
- Cycles are rejected: A embeds B, B embeds A, is refused. This holds across
  several levels too.
- A target appears in the list at most once. Duplicate entries are removed
  silently; the first occurrence keeps its place.

A change to the embedded page takes effect immediately in **all** pages that
embed it. There is nothing to re-import and nothing to pull along: the pages
reference the same source, they do not copy it.

If an embedded source is not readable for the viewer, the spot is concealed
without an error message. If the source is readable but not operable, its
controls appear locked. If it requires a PIN, the spot is marked as locked
instead of silently disappearing.

## Global include pages {#visu-page-global-includes}

A global include page is embedded into **every normal page** without further
action. Typical use: a header, a status bar or a navigation column that should
be present on all pages.

- **Several global include pages are stacked**, ascending by their order in the
  page tree: the smallest order sits at the bottom. The order is therefore
  visible in the editor and under the author's control.
- **A global include page cannot embed anything itself.** There is exactly one
  level. The attempt is rejected on save.
- **When a global include page is opened directly**, it does not show the other
  global include pages. It stands on its own.
- **Popups never contain global include pages.**

A single normal page can opt out: the **Ignore global include pages** switch in
the page properties leaves that one page without the global layers.

## Access and audience {#visu-page-access}

Access is set in the same place as the page kind. Four levels are available:

| Level | Who sees the page |
|---|---|
| **Public** | Everyone, even without login. |
| **Read only** | Everyone, but controls are locked. |
| **PIN protected** | Whoever enters the PIN of that page. |
| **Audience only (user)** | Only the selected users. |

The additional fields appear exactly where they apply: the **PIN** only for
`protected`, the **audience** only for `user`. The editor catches forbidden
combinations before saving.

**Inherit from parent** is the default. A page without its own level takes the
one of its parent; only when inheritance is switched off does the level chosen
here apply.

Concealment happens at the navigation level: a page the viewer may not see does
not appear in the tree in the first place.
