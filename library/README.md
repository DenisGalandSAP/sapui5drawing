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
- **Backend croquis** — optionally load / save the drawing straight to SAP as an
  attachment (via the `ZTS_CA_UI5F_ATTA` OData service), keyed by an object id such
  as a notification number — no local file step. The board **auto-loads** the croquis
  when it opens, and a host app can trigger a save itself with `saveCroquis()`. See §7.
- **Responsive toolbar** — the toolbar controls sit on one row when there is room and
  **wrap** onto extra rows as the width shrinks.
- **Non-destructive mode switch** — toggling *Canvas* ⇄ *Photo* keeps the current
  drawing, photo and undo history.

---

## 1. Requirements

| | |
|---|---|
| SAPUI5 | 1.71 or newer (the `BTP` branch builds against 1.142) |
| Library dependencies | `sap.ui.core`, `sap.m` |
| Secure context | Camera capture needs `https://` or `localhost` (browser rule) |

---

## 2. Reference the library from another app

Every consuming app must declare the dependency — under `sap.ui5/dependencies/libs`
in its `manifest.json`:

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
    }
  }
}
```

Whether you *also* need `resourceRoots` (to tell UI5 **where** the files live) depends
on how the app and the library are hosted. Pick the scenario that matches you:

### Scenario A — Deployed app on the same ABAP server (no `resourceRoots` needed)

If your consuming app is deployed as a BSP on the **same** ABAP front-end server where
the library BSP (`ZUIABLIBRDRAW`) lives, you need **only** the `dependencies/libs` entry
above. The SAPUI5 **application index** resolves the `zab.be.resa.draw` namespace to the
library BSP automatically — **do not add a `resourceRoots` block**.

> Real example in this landscape: `ZUI_AB_UI5F_AP` consumes the reuse library
> `zab.be.resa.zuiablibrleaf` with a plain `dependencies/libs` entry and **no**
> `resourceRoots`.

Prerequisites:

- Deploy the library BSP **first** (`npm run deploy-lib` → `ZUIABLIBRDRAW`), then the app.
- The app index must be current. It is normally recalculated on deploy; if the library
  isn't found, run `/UI5/APP_INDEX_CALCULATE` (report `/UI5/APP_INDEX_CALCULATE`) on the
  ABAP system.

### Scenario B — Local development of a consumer app

While developing locally with the UI5 tooling, the app index isn't available, so map the
namespace explicitly and serve the files. Point `resourceRoots` at the library's BSP
path and then either:

- **(b1) serve it from a built `library/dist`** with `fiori-tools-servestatic` — this is
  what this repo's `ui5-local.yaml` does (fully offline), or
- **(b2) proxy `/sap` to the ABAP server** so the deployed BSP is fetched live — this is
  what this repo's `ui5.yaml` does.

Shared bootstrap mapping (in `index.html` / `flpSandbox.html`, absolute so it also works
for a standalone launch of a deployed app):

```html
data-sap-ui-resourceroots='{
    "your.consumer.app": "./",
    "zab.be.resa.draw": "/sap/bc/ui5_ui5/sap/zuiablibrdraw/resources/zab/be/resa/draw"
}'
```

`ui5-local.yaml` (b1 — serve the built library statically under the BSP path, **before**
the proxy):

```yaml
server:
  customMiddleware:
    - name: fiori-tools-servestatic
      afterMiddleware: compression
      configuration:
        paths:
          - path: /sap/bc/ui5_ui5/sap/zuiablibrdraw/resources/zab/be/resa/draw
            src: "library/dist/resources/zab/be/resa/draw"
    - name: fiori-tools-proxy
      afterMiddleware: fiori-tools-servestatic   # after servestatic, so BSP path is local
      configuration:
        backend:
          - path: /sap
            url: http://<abap-host>:<port>
```

`ui5.yaml` (b2 — no servestatic; the proxy fetches the live BSP):

```yaml
server:
  customMiddleware:
    - name: fiori-tools-proxy
      afterMiddleware: compression
      configuration:
        ui5:
          path: [/resources, /test-resources]
          url: https://ui5.sap.com
        backend:
          - path: /sap
            url: http://<abap-host>:<port>
```

### Scenario C — Bundle the library into the app, or host it elsewhere

When the library is **not** deployed as its own BSP on the app's server (e.g. you copy it
into the app, or host it on a static server / CDN), give `resourceRoots` a value that
points at the folder containing the library files directly.

### Scenario D — SAP BTP, HTML5 Application Repository (managed approuter)

On BTP the library is deployed as its own HTML5 app (`zabberesadraw`) in the **same
app-host** as the consuming app (one MTA, one business service — see the root
`mta.yaml`). The app URL then looks like
`/[<destination-instance-guid>.]<service>.<appname>[-<version>]/…`, and the library
sits next to it under the same prefix: `/[<guid>.]<service>.zabberesadraw/`.

Because that prefix isn't known in advance, **don't use a static `resourceRoots`**.
Declare the library `lazy` and load it in the component before the view is created:

```json
"zab.be.resa.draw": { "lazy": true }
```

```ts
// Component.ts — metadata: interfaces: ["sap.ui.core.IAsyncContentCreation"]
public createContent(): Promise<Control> {
	const sAppPath = new URL(sap.ui.require.toUrl("my/app/namespace") + "/", document.baseURI).pathname;
	const oMatch = /^(.*\/)([^/]*?)myappname(?:-[^/]*)?\//.exec(sAppPath);
	const sUrl = oMatch ? oMatch[1] + oMatch[2] + "zabberesadraw/" : "/resources/zab/be/resa/draw/";
	return Lib.load({ name: "zab.be.resa.draw", url: sUrl })
		.then(() => super.createContent() as Control | Promise<Control>);
}
```

(`myappname` = your `sap.app.id` without dots; the fallback is for local dev.) The
library's own HTML5 app needs an `xs-app.json` with a catch-all
`html5-apps-repo-rt` route; build it with `ui5-task-zipper` **after `buildThemes`**.
For the croquis service on BTP, also see §7 (*app-relative `serviceUrl`*).

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
| Deployed as its own ABAP BSP (`ZUIABLIBRDRAW`) | `"/sap/bc/ui5_ui5/sap/zuiablibrdraw/resources/zab/be/resa/draw"` |
| Any static host / CDN | `"https://host/path/to/resources/zab/be/resa/draw"` |

> For a BSP-deployed library consumed by a **deployed** app on the **same** server,
> prefer Scenario A (no `resourceRoots`). The absolute BSP value above is for local dev
> (Scenario B) or a standalone launch.

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

For the UI5-tooling dev-server recipes (serve from `library/dist` statically, or proxy
`/sap` to the ABAP server), see **Scenario B** above — that is what this repo's
`ui5-local.yaml` and `ui5.yaml` do respectively.

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
| `serviceUrl` | `string` | `"/sap/opu/odata/sap/ZTS_CA_UI5F_ATTA"` | Base URL of the attachment OData service used by the croquis Load/Save buttons (§7). |
| `otype` | `string` | `""` | Attachment object type. For a croquis: `"CROQ"`. |
| `objid` | `string` | `""` | Attachment object id = the storage key of the croquis (e.g. the notification number `QMNUM`). The croquis Load/Save buttons are enabled only when **both** `otype` and `objid` are set. |

```xml
<draw:DrawingBoard editable="{= ${ui>/mode} === 'edit' }" height="80vh" />
```

Toggle editability at runtime:

```ts
oBoard.setEditable(false);   // lock (view-only)
oBoard.setEditable(true);    // unlock
```

Set the backend context at runtime too:

```ts
oBoard.setOtype("CROQ");
oBoard.setObjid("000010000020");   // e.g. the notification number (QMNUM)
```

### Public methods

| Method | Returns | Description |
|---|---|---|
| `setEditable(bEditable)` | `this` | Lock / unlock the board (view-only when `false`). |
| `setOtype(sOtype)` / `setObjid(sObjid)` | `this` | Set the backend context at runtime (§7). |
| `saveCroquis()` | `Promise<void>` | Save the current drawing to the backend — identical to the **💾 Save** button. Lets a host trigger the save **itself**, e.g. from a dialog's *Close* / *OK* handler so nothing is lost when the user leaves a popup without pressing Save. |
| `loadCroquis()` | `Promise<void>` | (Re)load the croquis for the current `otype`/`objid` from the backend — identical to the **☁ Load** button. |

```ts
// e.g. persist when a hosting dialog closes, even if the user didn't press Save
oDialog.attachAfterClose(() => { void oBoard.saveCroquis(); });
```

> **Auto-load on open** — once the board is rendered and **both** `otype` and `objid`
> are set, it **loads the croquis automatically** (no **☁ Load** press needed). This
> runs once and stays silent if no croquis exists yet for the object.

The control is otherwise self-contained: it builds and manages its own toolbar, canvas,
history and file dialogs. Beyond the methods above, persistence is done through the PNG
export (§6) or, when a backend context is set, through the attachment service (§7).

---

## 5. What the user can do

> The toolbar is **responsive**: its controls sit on a single row when there is room
> and wrap onto a 2nd (then 3rd…) row automatically as the width shrinks.

| Toolbar group | Actions |
|---|---|
| **Mode** | Switch between *Canvas* (grid) and *Photo* (annotate an image). **Your current drawing, photo and history are kept** when you switch modes. |
| **Photo** (Photo mode) | Add an image by **upload**, **camera** (choose the device), or **drag-and-drop** onto the canvas. Drawing tools stay disabled until an image is present. |
| **Tools** | Pen, line, rectangle, circle, **select**, pan. |
| **Color** | Pick the stroke color (defaults to white in Photo mode). Applies to new strokes and to the current selection. |
| **Objects** | Insert a preset (Route, Voiture, Arbres, Croix, Maison) or a **text zone**. |
| **Transform** | With a shape selected: resize (grow/shrink), **rotate** left/right, recolor, **delete**. |
| **Zoom** | Slider, reset view, wheel to zoom, pan tool to move the viewport. |
| **History** | Undo / Redo (also **Ctrl+Z** / **Ctrl+Y** / **Ctrl+Shift+Z**). **Delete**/**Backspace** removes the selection. |
| **Files** | **Open** a project (PNG/JSON) and **Download** the annotated PNG with embedded coordinates. |
| **Backend** (croquis) | Only when `otype`+`objid` are set: **☁ Load croquis** pulls the saved croquis back into the board, and **💾 Save croquis** stores the current drawing as a SAP attachment. See §7. |

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

## 7. Backend persistence — save/load a croquis as a SAP attachment

Besides the local PNG download/open (§6), the board can load and save the drawing
directly to SAP as an **attachment**, with no local file step. It is driven by the
`otype` / `objid` properties and two extra toolbar buttons.

### Wiring

```xml
<draw:DrawingBoard
    editable="true"
    height="70vh"
    otype="CROQ"
    objid="{context>/objid}" />
```

- `otype` — the attachment object type; for a croquis it is **`CROQ`**.
- `objid` — the **storage key**: there is one croquis per `objid`. By spec the key is
  the **notification number** (`QMEL-QMNUM`). The board may be entered from a
  notification *or* an order — when you start from an order, resolve its notification
  (`AFIH-QMNUM`) and pass that `QMNUM` as `objid`.
- `serviceUrl` — defaults to `/sap/opu/odata/sap/ZTS_CA_UI5F_ATTA`; override only if the
  attachment service lives elsewhere. **On SAP BTP (managed approuter) set it
  app-relative**, so the call goes through the app's own `/sap` route:
  `sap.ui.require.toUrl("<app/namespace>") + "/sap/opu/odata/sap/ZTS_CA_UI5F_ATTA"`.
  The attachment download URL returned by SAP (`/sap/opu/…/$value`) is rewritten by the
  board under the same prefix as `serviceUrl` (no-op on ABAP, where the prefix is empty).
- Key format — `objid` must match **exactly** what was stored: croquis saved by the
  host apps use the notification number **without leading zeros** (e.g. `420004467`).

The two buttons (**☁ Load**, **💾 Save**) sit at the end of the toolbar and are enabled
only when `editable` is `true` **and** both `otype` and `objid` are set.

### What the buttons do

- **💾 Save** builds the composite PNG (photo + strokes, with the re-editable project
  embedded exactly as in §6) and stores it on `otype`/`objid`. Because only **one
  version** of a croquis exists, Save first deletes any existing croquis for that key,
  then uploads the new one under the deterministic file name `"<objid>-croquis.png"`.
- **☁ Load** fetches that croquis back and opens it — the embedded `zabDrawProject`
  chunk is restored, so you keep full vector editing.
- **The photo is always kept** — once a photo has been added, it's part of the saved
  croquis even if you switch to the Canvas view (where it's hidden while drawing). The
  croquis then **reopens in Photo mode** so the photo is visible again on load.
- **Auto-load on open** — once the board is rendered and both `otype`/`objid` are set,
  it loads the croquis automatically (no **☁ Load** press needed). It runs once and is
  silent when there is no croquis yet for the object.
- **Trigger from your app** — call `oBoard.saveCroquis()` / `oBoard.loadCroquis()`
  (both return a `Promise`) to drive save/load yourself — e.g. save on a dialog's
  *Close* handler so a croquis edited inside a popup isn't lost when the user leaves
  without pressing **💾 Save**.

### How it talks to the service

The control calls the `ZTS_CA_UI5F_ATTA` OData V2 service directly (`fetch`, same
origin, cookie session):

| Step | Request |
|---|---|
| Read | `GET …/zv_ca_c_ui5f_atta_head(Otype='…',Objid='…')?$expand=to_Attachment` — the `to_Attachment` list is filtered to `*croquis*.png`. |
| Save | `GET …/` with header `x-csrf-token: Fetch` → token, then `POST …/zv_ca_c_ui5f_atta_info` with headers `x-csrf-token` + `slug: <otype>&&<objid>&&<fileName>` and the raw PNG bytes. |
| Overwrite | `DELETE …/zv_ca_c_ui5f_atta_info(Otype='…',Objid='…',Attid='…')` for each existing croquis before the POST. |

On success the backend stores the row in table `ztca_ui5f_atta` (keyed by
`otype/objid/attid/fname`). Errors surface in a `MessageToast` with the HTTP status
and the SAP message.

### Requirements & gotchas

- The object type must be configured in the attachment customizing (max size, and the
  allowed extensions must include `png`). `CROQ` is configured for this.
- The app must run **same-origin** with the ABAP server so the session cookie and CSRF
  token apply — a deployed BSP app, or a dev server that proxies `/sap` (this repo's
  `ui5.yaml`). The `slug` file name must be ASCII.
- Attachments are stored **per client**: check the `sap-client` you run on when
  verifying the row in `ztca_ui5f_atta`. On BTP the client is fixed by the
  destination (`erp` → DTA **310**); a `?sap-client=` in the URL is ignored.
- A successful `POST` returns `201` with an **empty** entity body (`Otype=''`,
  `Attid='000000'`) — that is normal here; the backend clears its context before
  building the response. The row is still inserted.

---

## 8. Notes & limitations

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
