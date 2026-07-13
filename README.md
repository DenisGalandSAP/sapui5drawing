## Application Details
|               |
| ------------- |
|**App Generator**<br>@sap/generator-fiori-freestyle|
|**Template Used**<br>standalone app + SAPUI5 library|
|**Service Type**<br>None (self-contained drawing board)|
|**App Module**<br>ZUI_AB_DRAW_APP — namespace `zab.be.resa.zuidrawapp`|
|**Library Module**<br>ZUIABLIBRDRAW — namespace `zab.be.resa.draw`|
|**Application Title**<br>AB : Draw App|
|**UI5 Theme**<br>sap_fiori_3|
|**UI5 Version**<br>1.71.58 (on-premise ECC, runtime 1.71.76)|
|**Enable TypeScript**<br>True|

## Architecture

The project is split into two fully detached UI5 projects:

```
sapui5drawing/
├─ webapp/            Standalone Fiori app (namespace zab.be.resa.zuidrawapp).
│                     An ObjectPage that consumes the library like any SAPUI5 lib.
├─ library/           Real SAPUI5 library (namespace zab.be.resa.draw).
│   └─ src/zab/be/resa/draw/
│         DrawingBoard.ts   Custom control: canvas drawing board + its own toolbar.
│         DrawingBoardRenderer.ts, library.ts, .library, messagebundle.properties,
│         themes/<theme>/library.source.less
├─ ui5.yaml           App project — consumes the library from DTA 300 (see below).
├─ ui5-local.yaml     App project — fully offline: SAPUI5 framework + library both served from local disk.
├─ ui5-deploy.yaml    App deploy config (the app itself is not deployed).
├─ library/ui5.yaml         Library build (TypeScript → JS).
└─ library/ui5-deploy.yaml  Deploys the flattened library as a BSP (ZUIABLIBRDRAW).
```

### How the app "calls the folder as a real library"

The app never imports the library source directly. Instead:

1. `npm run build:lib` builds `library/` (TypeScript → JS, theme, preload) into
   `library/dist/resources/zab/be/resa/draw/…`.
2. The app declares `zab.be.resa.draw` in `manifest.json` (`sap.ui5/dependencies/libs`)
   and, via **`resourceRoots`** (in `webapp/index.html`, `webapp/test/flpSandbox.html`
   and `manifest.json`), maps that namespace to the library's BSP path
   `/sap/bc/ui5_ui5/sap/zuiablibrdraw/resources/zab/be/resa/draw`.
3. It uses the control in XML: `<draw:DrawingBoard editable="true" height="70vh"/>`.

Where that BSP path is served from depends on which config you run:

| Config / script | Library source |
|---|---|
| Config / script | SAPUI5 framework | Library `zab.be.resa.draw` |
|---|---|---|
| `ui5.yaml` — `npm start`, `npm run start-noflp` | `ui5.sap.com` (CDN) via the `ui5` proxy | **DTA 300** (BSP `ZUIABLIBRDRAW`), via the `/sap` `fiori-tools-proxy` → `http://tec0033wi.tecteo.adms:8000` |
| `ui5-local.yaml` — `npm run start-local` | **local SDK** folder via `fiori-tools-servestatic` (`/resources`) | **local `library/dist`** via `fiori-tools-servestatic` (same BSP path) |

> Because both configs share `flpSandbox.html` (one `resourceRoots` value → the BSP
> path), the two modes differ only in *where the library is served from* — DTA 300 vs.
> local disk.

> **`start-local` is fully offline** — no CDN, no ABAP. It serves both the framework and
> the library from disk. It expects the SAPUI5 SDK unpacked at the path set in
> `ui5-local.yaml` (`fiori-tools-servestatic` → `/resources`, currently
> `C:/Users/dgaland/projects/SAPUI5/resources`); change that `src` to wherever your SDK
> lives. The `framework:` block is intentionally omitted so the tooling doesn't try to
> npm-install SAPUI5.

The `start` scripts run `npm run build:lib` automatically. For `start-local`, re-run
`npm run build:lib` after changing the library so `library/dist` is up to date. For
`start` (DTA 300), redeploy the library (`npm run deploy-lib`) to pick up changes.

> **Using the `DrawingBoard` control in your own SAPUI5 app?** See
> [`library/README.md`](library/README.md) for the consumer guide: wiring the
> library into an app, the control's API, the toolbar features, the PNG
> save/reopen format (including how to read the embedded coordinates), and the
> **backend croquis** save/load to SAP attachments (§7).

### Saving the croquis to SAP (backend attachment)

The board can save/load the drawing straight to SAP as an attachment (OData service
`ZTS_CA_UI5F_ATTA`, object type `CROQ`), keyed by an object id — by spec the
**notification number** (`QMEL-QMNUM`). The standalone app wires this in
`webapp/view/Main.view.xml` / `webapp/controller/Main.controller.ts`:

```xml
<draw:DrawingBoard editable="true" height="70vh"
    otype="CROQ" objid="{context>/objid}" />
```

The controller sets `context>/objid` to the notification number (for the standalone
harness it is hardcoded to a test notification). Once `objid` is set the board
**auto-loads** the croquis on open (silent if none exists); the **☁ Load** / **💾 Save**
toolbar buttons also read/write it manually, and a host can trigger a save in code via
`oBoard.saveCroquis()` (e.g. on popup close). This needs the app to run same-origin with
the ABAP server (deployed BSP, or `npm start` which proxies `/sap`); attachments are
stored per `sap-client`. Full details — request flow, single-version overwrite,
requirements — are in [`library/README.md` §7](library/README.md).

### Starting the app

```
npm start            # builds the library, then runs the app in the FLP sandbox
npm run start-noflp  # builds the library, then runs the app standalone (index.html)
npm run start-local  # builds the library, then runs against the local SAPUI5 framework
```

### Building

```
npm run build:lib    # build only the library  -> library/dist
npm run build:app    # build only the app       -> dist
npm run build        # build both (library first, then app)
```

### Deploying to ABAP

Only the **library** is deployed (as its own BSP); this standalone app is a local
harness and is not deployed. Set the transport in `library/ui5-deploy.yaml`.

```
npm run deploy-lib   # build + flatten + deploy the library (ZUIABLIBRDRAW)
```

Once deployed, any **other** app on the same ABAP server can consume the library — see
[`library/README.md` §2](library/README.md) (a deployed consumer needs only a
`dependencies/libs` entry; the SAPUI5 app-index resolves it — **no `resourceRoots`**).

#### Pre-requisites:

1. Active NodeJS LTS (Long Term Support) version and associated supported NPM version.  (See https://nodejs.org)
