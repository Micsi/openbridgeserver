---
title: Versions, JSON, export and import
---

# Versions, JSON, export and import

Three ways to handle a page outside the canvas: the history brings back an
earlier state, the JSON view shows the same page as text, and export and import
carry it out of the installation as a file and back in again.

## Versions {#visu-versions}

**History** opens the list of saved states of this page. The topmost entry is
**Last saved**, the earlier versions are below it.

**Restore** sets the page back to the selected state. What happens then, in this
order:

1. The canvas is taken off the screen. It holds a draft that stops describing the
   page at that moment.
2. The page properties are locked, so that a click on their "Save" cannot write
   the old draft over the state just restored.
3. The old state is read and stored through the ordinary save path. There is
   deliberately no separate restore path that would bypass the validation of the
   page-kind model.
4. Only once the page has been read back and really carries the old state does
   the confirmation appear and the canvas return.

Restoring itself creates a new version. The way back to the state of a moment ago
therefore stays open.

## JSON view {#visu-json-view}

The **Visual** and **JSON** tabs show the same page in two views, and both are
editable:

- A move on the canvas appears in the JSON immediately.
- A change in the JSON takes effect on the canvas.

What the editor refuses, it says out loud:

- **Not valid JSON**: the input is not applied, the last good state stays.
- **Not a page document**: the JSON needs a `widgets` list, and every element in
  it needs an `id`.

Saving happens through **Save** here too; the text view is a second look at the
same draft, not a second write path.

## Export and import {#visu-transfer}

**Export** downloads the current page as a file, together with everything below
it in the page tree.

**Import** reads such a file back in. The result is a **separate, new page** at
the top level: new ids, a unique name ("Name (copy 1)" if the name is taken
already). Import is therefore a duplication, not a replacement.

Two things deliberately do **not** come along, and the editor says both out loud:

- **PIN protection without a PIN.** An export carries no secret. A PIN-protected
  page stays protected but has no PIN any more; until a new one is set in the
  page properties, nobody gets in.
- **Fields from a newer version.** When a file from a newer OBS version is read
  in, whatever this version does not know is dropped. The editor lists the
  affected fields instead of discarding them silently.

A file that is not a Visu export at all is rejected right away, so that reaching
into the wrong folder stays recognisable.
