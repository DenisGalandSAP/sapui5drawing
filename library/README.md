# zab.be.resa.draw — DrawingBoard

A self-contained SAPUI5 library that provides a single custom control,
**`zab.be.resa.draw.DrawingBoard`**: a canvas-based drawing board with its own
toolbar. It works standalone in any XML view or JS controller — no service, no
model, no wiring required.

- **Two modes** — *Canvas* (free drawing on a grid) and *Photo* (annotate an
  uploaded / captured / drag-and-dropped picture).
- **Tools** — freehand pen, line, rectangle, circle, select, pan.
- **Objects** — insert presets (Route, Voiture, Arbres, Croix, Maison) and text
  zones (e.g. house number / street).
- **Transforms** — move, resize, rotate, recolor, delete a selection.
- **History** — full step-by-step undo/redo (Ctrl+Z / Ctrl+Y).
- **Save / reopen** — download a single PNG that shows the annotated image *and*
  carries the re-editable project (image + vector lines in image-pixel
  coordinates) in a hidden metadata chunk; reopen it later to keep editing.

---

## 1. Requirements

| | |
|---|---|
| SAPUI5 | 1.71 or newer |
| Library dependencies | `sap.ui.core`, `sap.m` |
| Secure context | Camera capture needs `https://` or `localhost` (browser rule) |

---

## 2. Reference the library from another app (`manifest.json`)

This library is **not** on `ui5.sap.com`, so a consuming app has to tell UI5 two
things in its own `manifest.json`:

1. **that it depends on the library** — under `sap.ui5/dependencies/libs`, and
2. **where the library's files live** — under `sap.ui5/resourceRoots`.

### How `resourceRoots` works

UI5 turns a module/namespace into a path by replacing dots with slashes:

```
namespace  zab.be.resa.draw
path       zab/be/resa/draw
```

By default UI5 would look for it under `/resources/zab/be/resa/draw` (next to
`sap.m` etc.). Since it isn't there, `resourceRoots` **remaps that namespace to a
URL you control**. A request for `zab/be/resa/draw/library.js` is then loaded from
`<your-url>/library.js`.

> Point the URL at the folder that **contains the library files directly**
> (`library.js`, `library-preload.js`, `DrawingBoard.js`, `themes/…`) — i.e. the
> built `…/resources/zab/be/resa/draw` folder. Do **not** append the namespace
> path again; `resourceRoots` already stands for that namespace.

### Full `manifest.json` example

```json
{
  "sap.ui5": {
    "dependencies": {
      "minUI5Version": "1.71.58",
      "libs": {
        "sap.ui.core": {},
        "sap.m": {},
        "zab.be.resa.draw": {}
      }
    },
    "resourceRoots": {
      "zab.be.resa.draw": "./thirdparty/zab/be/resa/draw"
    }
  }
}
```

The `resourceRoots` **value** is what changes per setup:

| Where the library is hosted | `resourceRoots` value |
|---|---|
| Copied inside your app (e.g. `webapp/thirdparty/zab/be/resa/draw`) | `"./thirdparty/zab/be/resa/draw"` (relative to the app's `Component`/`webapp` root) |
| Deployed as its own ABAP BSP (e.g. `ZUI_AB_LIBR_DRAW`) | `"/sap/bc/ui5_ui5/sap/zui_ab_libr_draw/resources/zab/be/resa/draw"` |
| Any static host / CDN | `"https://host/path/to/resources/zab/be/resa/draw"` |

> A **relative** value is resolved against the consuming app, so it survives being
> deployed under different server prefixes — prefer it when you bundle the library
> into the app. Use an **absolute** value when the library is deployed separately;
> deploy the library **before** the app so the URL resolves at runtime.

### Getting the library files

Build the library to get the folder you point `resourceRoots` at:

```bash
npm run build:lib     # -> library/dist/resources/zab/be/resa/draw
```

- **Bundle into your app:** copy `library/dist/resources/zab/be/resa/draw` into
  your app (e.g. `webapp/thirdparty/zab/be/resa/draw`) and use the relative
  `resourceRoots` value above.
- **Deploy separately:** deploy that same folder as its own BSP / static app and
  use the absolute value.

### Local dev shortcut (UI5 tooling)

If you don't want to copy files while developing, you can instead serve the built
`dist` folder statically from the dev server and skip `resourceRoots` entirely —
this is what the sample app in this repo does. In the app's `ui5.yaml`:

```yaml
server:
  customMiddleware:
    - name: fiori-tools-servestatic
      afterMiddleware: compression
      configuration:
        paths:
          - path: /resources/zab/be/resa/draw
            src: "library/dist/resources/zab/be/resa/draw"
    # IMPORTANT: register the UI5 proxy AFTER servestatic so this path is served
    # locally and not forwarded to ui5.sap.com.
    - name: fiori-tools-proxy
      afterMiddleware: fiori-tools-servestatic
      configuration:
        ui5:
          path: [/resources, /test-resources]
          url: https://ui5.sap.com
```

Here the library is reachable under the standard `/resources/zab/be/resa/draw`, so
only the `dependencies/libs` entry is needed (no `resourceRoots`). For a
**deployed** app, use `resourceRoots` as shown above.

---

## 3. Use the control

### In an XML view

Declare the namespace, then drop the control anywhere:

```xml
<mvc:View
    xmlns:mvc="sap.ui.core.mvc"
    xmlns:draw="zab.be.resa.draw"
    height="100%">

    <draw:DrawingBoard
        editable="true"
        width="100%"
        height="70vh" />

</mvc:View>
```

> The board needs a real height to render its canvas. Give it an explicit
> `height` (e.g. `70vh`, `600px`) or place it in a container that has one.

### In a controller (JS/TS)

```ts
import DrawingBoard from "zab/be/resa/draw/DrawingBoard";

const oBoard = new DrawingBoard({
    editable: true,
    width: "100%",
    height: "70vh"
});
this.getView().byId("page").addContent(oBoard);
```

---

## 4. Control API

### Properties

| Property | Type | Default | Description |
|---|---|---|---|
| `editable` | `boolean` | `true` | When `false`, the toolbar and pointer interactions are disabled (view-only). |
| `width` | `sap.ui.core.CSSSize` | `"100%"` | Width of the control. |
| `height` | `sap.ui.core.CSSSize` | `"100%"` | Height of the control. |

```xml
<draw:DrawingBoard editable="{= ${ui>/mode} === 'edit' }" height="80vh" />
```

Toggle editability at runtime:

```ts
oBoard.setEditable(false);   // lock (view-only)
oBoard.setEditable(true);    // unlock
```

The control is self-contained: it builds and manages its own toolbar, canvas,
history and file dialogs. There are currently no public events or a
shapes-getter API — persistence is done through the PNG export (see §7).

---

## 5. What the user can do

| Toolbar group | Actions |
|---|---|
| **Mode** | Switch between *Canvas* (grid) and *Photo* (annotate an image). |
| **Photo** (Photo mode) | Add an image by **upload**, **camera** (choose the device), or **drag-and-drop** onto the canvas. Drawing tools stay disabled until an image is present. |
| **Tools** | Pen, line, rectangle, circle, **select**, pan. |
| **Color** | Pick the stroke color (defaults to white in Photo mode). Applies to new strokes and to the current selection. |
| **Objects** | Insert a preset (Route, Voiture, Arbres, Croix, Maison) or a **text zone**. |
| **Transform** | With a shape selected: resize (grow/shrink), **rotate** left/right, recolor, **delete**. |
| **Zoom** | Slider, reset view, wheel to zoom, pan tool to move the viewport. |
| **History** | Undo / Redo (also **Ctrl+Z** / **Ctrl+Y** / **Ctrl+Shift+Z**). **Delete**/**Backspace** removes the selection. |
| **Files** | **Open** a project (PNG/JSON) and **Download** the annotated PNG with embedded coordinates. |

To transform an object: pick the **Select** tool, click the drawing (a dashed
box shows the selection), then move/resize/rotate/recolor/delete it.

---

## 6. Save format & reading the coordinates

**Download** produces a single **PNG**:

- The **pixels** are the composite (photo + strokes) at the image's native
  resolution — a normal, viewable image.
- A hidden **`tEXt` metadata chunk** (keyword `zabDrawProject`) carries the full,
  re-editable project as **Base64-encoded UTF-8 JSON**.

**Open** reads that chunk and restores the original image plus the vector lines,
so editing is lossless (opening a plain PNG with no chunk simply loads it as a
photo to annotate).

### Project JSON shape

```jsonc
{
  "type": "zab.be.resa.draw.project",
  "version": 1,
  "mode": "photo",                 // or "draw"
  "strokeColor": "#ffffff",
  "coordinateSpace": "image-pixels", // "image-pixels" in Photo mode, else "world"
  "width": 1920,                   // composite pixel size
  "height": 1080,
  "image": {                       // null in Canvas mode
    "dataUrl": "data:image/png;base64,....",
    "width": 1920,
    "height": 1080
  },
  "shapes": [
    { "id": "3", "type": "line",  "x1": 120, "y1": 80, "x2": 340, "y2": 200, "stroke": "#ffffff", "lineWidth": 3 },
    { "id": "4", "type": "circle","cx": 500, "cy": 300, "r": 45,  "stroke": "#ff0000", "lineWidth": 3 },
    { "id": "5", "type": "pen",   "points": [{ "x": 10, "y": 10 }, { "x": 60, "y": 40 }], "stroke": "#ffffff", "lineWidth": 3 },
    { "id": "6", "type": "text",  "x": 700, "y": 120, "text": "N° 12", "fontSize": 48, "stroke": "#ffffff", "lineWidth": 1 },
    { "id": "7", "type": "rect",  "x1": 50, "y1": 50, "x2": 150, "y2": 120, "stroke": "#00aaff", "lineWidth": 3, "groupId": "g-2" }
  ],
  "shapeIdCounter": 8,
  "groupIdCounter": 3
}
```

- In **Photo mode**, shape coordinates are in **image pixels** (origin top-left of
  the photo, `0..width` / `0..height`) — meaningful independent of zoom / screen
  size, ideal for a backend (e.g. SAP) to interpret.
- Shapes sharing a `groupId` were inserted together (e.g. a preset). A rotated
  rectangle is stored as a closed `pen` polygon.

### Extracting the JSON without the control

The payload is a standard PNG `tEXt` chunk. Any PNG reader can get it:

1. Read the PNG chunks and find the `tEXt` chunk whose keyword is
   `zabDrawProject`.
2. Base64-decode its text value, then UTF-8-decode and `JSON.parse` it.

Browser example:

```js
async function readProjectFromPng(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  // iterate chunks after the 8-byte signature: [len(4)][type(4)][data][crc(4)]
  let off = 8;
  const dv = new DataView(bytes.buffer);
  while (off + 8 <= bytes.length) {
    const len = dv.getUint32(off);
    const type = String.fromCharCode(...bytes.slice(off + 4, off + 8));
    if (type === "tEXt") {
      const data = bytes.slice(off + 8, off + 8 + len);
      const sep = data.indexOf(0);                      // keyword \0 text
      const keyword = String.fromCharCode(...data.slice(0, sep));
      if (keyword === "zabDrawProject") {
        const b64 = String.fromCharCode(...data.slice(sep + 1));
        return JSON.parse(new TextDecoder().decode(
          Uint8Array.from(atob(b64), c => c.charCodeAt(0))));
      }
    }
    if (type === "IEND") break;
    off += 12 + len;
  }
  return null;
}
```

---

## 7. Notes & limitations

- **Rebuild after changes** — the app serves the built `library/dist`; run
  `npm run build:lib` after editing the library, and hard-refresh (the UI5
  preload is cached).
- **Camera** requires a secure context (`https` or `localhost`) and user
  permission; the device list appears once permission is granted.
- **Cross-origin images** dragged in from another site can *taint* the canvas and
  block PNG export — dropping a local file (a data URL) is unaffected.
- If a downloaded PNG is later **re-encoded** by another tool (e.g. PNG→JPG or a
  metadata-stripping editor), the embedded project is lost; the flat picture
  remains.
- Localization: UI texts come from the library resource bundle
  (`messagebundle.properties`, currently French).
