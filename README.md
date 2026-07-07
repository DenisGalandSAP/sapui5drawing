## Application Details
|               |
| ------------- |
|**App Generator**<br>@sap/generator-fiori-freestyle|
|**Template Used**<br>standalone app + SAPUI5 library|
|**Service Type**<br>None (self-contained drawing board)|
|**App Module**<br>ZUI_AB_DRAW_APP — namespace `zab.be.resa.zuidrawapp`|
|**Library Module**<br>ZUI_AB_LIBR_DRAW — namespace `zab.be.resa.draw`|
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
├─ ui5.yaml           App project (serves the built library statically, see below).
├─ ui5-local.yaml     App project against the local SAPUI5 framework.
├─ ui5-deploy.yaml    Deploys the app as a BSP (ZUI_AB_DRAW_APP).
├─ library/ui5.yaml         Library build (TypeScript → JS).
└─ library/ui5-deploy.yaml  Deploys the flattened library as a BSP (ZUI_AB_LIBR_DRAW).
```

### How the app "calls the folder as a real library"

The app never imports the library source directly. Instead:

1. `npm run build:lib` builds `library/` (TypeScript → JS, theme, preload) into
   `library/dist/resources/zab/be/resa/draw/…`.
2. In `ui5.yaml` / `ui5-local.yaml`, the **`fiori-tools-servestatic`** middleware mounts
   that folder at `/resources/zab/be/resa/draw`, so the dev server serves it exactly
   like `sap.m` or `sap.uxap`.
3. The app declares `zab.be.resa.draw` in `manifest.json` (`sap.ui5/dependencies/libs`)
   and uses the control in XML: `<draw:DrawingBoard editable="true" height="70vh"/>`.

> Ordering note: in `ui5.yaml`, `fiori-tools-proxy` is chained
> `afterMiddleware: fiori-tools-servestatic` so that `/resources/zab/be/resa/draw` is
> served locally and **not** proxied to `ui5.sap.com`.

Because the library is served statically, it must be built first — the `start` scripts
run `npm run build:lib` automatically. Re-run `npm run build:lib` after changing the
library.

> **Using the `DrawingBoard` control in your own SAPUI5 app?** See
> [`library/README.md`](library/README.md) for the consumer guide: wiring the
> library into an app, the control's API, the toolbar features, and the PNG
> save/reopen format (including how to read the embedded coordinates).

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

The app and the library deploy as **two separate BSP applications**. Set the transport
in `ui5-deploy.yaml` / `library/ui5-deploy.yaml` (currently `REPLACE_WITH_TRANSPORT`).

```
npm run deploy-lib   # build + flatten + deploy the library (ZUI_AB_LIBR_DRAW)
npm run deploy       # build + deploy the app (ZUI_AB_DRAW_APP)
```

Deploy the library first so the app can resolve `/resources/zab/be/resa/draw` at runtime.

#### Pre-requisites:

1. Active NodeJS LTS (Long Term Support) version and associated supported NPM version.  (See https://nodejs.org)
