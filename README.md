## Application Details
|               |
| ------------- |
|**App Generator**<br>@sap/generator-fiori-freestyle|
|**Template Used**<br>standalone app + SAPUI5 library|
|**Service Type**<br>OData V2 `ZTS_CA_UI5F_ATTA` (croquis attachments, optional)|
|**App Module**<br>`zab.be.resa.zuidrawapp` — HTML5 app `zabberesazuidrawapp`|
|**Library Module**<br>`zab.be.resa.draw` — HTML5 app `zabberesadraw`|
|**Application Title**<br>AB : Draw App|
|**UI5 Theme**<br>sap_fiori_3|
|**UI5 Version**<br>1.142.0 (SAP BTP)|
|**Enable TypeScript**<br>True|

## Branches

| Branch | Target | UI5 / typings | Deployment |
|---|---|---|---|
| `main` | On-premise ABAP (BSP `ZUIABLIBRDRAW`) | 1.71 runtime, `@sapui5/ts-types-esm@1.90` | `npm run deploy-lib` (ABAP) |
| `BTP` (this one) | SAP BTP, HTML5 Application Repository (managed approuter) | 1.142, `@sapui5/types@1.142` | `npm run deploy:cf` (MTA) |

The **DrawingBoard features are identical on both branches** — `BTP` is aligned with
`main` by merging it (`git merge main` on `BTP`). When merging, keep the BTP versions of
the environment files: `ui5*.yaml`, `ui5-deploy.yaml`, `webapp/manifest.json`,
`webapp/index.html`, `webapp/test/flpSandbox.html`, `README.md`, `package.json` /
`library/package.json` typings, and do not re-add `library/package-lock.json`. In
`DrawingBoard.ts`, keep the typed 1.142 event signatures (`Slider$LiveChangeEvent`,
`Select$ChangeEvent`, …) instead of the generic `sap/ui/base/Event`.

> `node_modules` is not versioned and the branches need different typings: use a
> separate worktree (e.g. `git worktree add ../sapui5drawing-btp BTP`) with its own
> `npm ci` rather than running `npm install` on one branch inside the other's checkout.

## Architecture

The project is split into two fully detached UI5 projects:

```
sapui5drawing/
├─ webapp/            Standalone Fiori app (namespace zab.be.resa.zuidrawapp).
│                     An ObjectPage that consumes the library like any SAPUI5 lib.
│   Component.ts        Loads the library (lazy) before creating the root view.
│   controller/Main.controller.ts  Test context: objid + app-relative serviceUrl.
├─ library/           Real SAPUI5 library (namespace zab.be.resa.draw).
│   └─ src/zab/be/resa/draw/
│         DrawingBoard.ts   Custom control: canvas drawing board + its own toolbar
│                           (+ croquis load/save to SAP attachments).
│         DrawingBoardRenderer.ts, PngMetadata.ts, library.ts, .library,
│         messagebundle.properties, themes/<theme>/library.source.less
├─ ui5.yaml / ui5-local.yaml   Local dev server (serves library/dist statically).
├─ ui5-cf.yaml                 App build for the HTML5 repo (zip + xs-app.json).
├─ library/ui5-cf.yaml         Library build for the HTML5 repo (zip + xs-app.json).
├─ xs-app.json / library/xs-app.json   Managed-approuter routes.
├─ xs-security.json            XSUAA (xsappname zabberesadraw).
├─ mta.yaml                    MTA zabberesadraw: app + library + services.
└─ ui5-deploy.yaml / library/ui5-deploy.yaml   Legacy ABAP deploy configs (unused here).
```

### How the app consumes the library

The app never imports the library source directly:

1. The library is built on its own (`npm run build:lib` → `library/dist/…`, or
   `library/ui5-cf.yaml` → `zabberesadraw.zip` for BTP).
2. `manifest.json` declares it as a **lazy** dependency:
   `"zab.be.resa.draw": { "lazy": true }`.
3. `Component.ts` (`IAsyncContentCreation`) calls `Lib.load({ name, url })` in
   `createContent()` and only then creates the root view that uses
   `<draw:DrawingBoard/>`. The URL is derived from the app's own URL:
   - **BTP**: the app is served under
     `/[<destination-instance-guid>.]zabberesadraw.zabberesazuidrawapp[-<version>]/…`,
     the library under the **same prefix** `…zabberesadraw.zabberesadraw/` (same
     app-host). Extra segments Work Zone may add after the app folder are tolerated.
   - **Local**: no match → `/resources/zab/be/resa/draw/`, served by
     `fiori-tools-servestatic` from `library/dist`.

> Why not a static `resourceRoots`? On BTP the app URL carries the
> destination-instance GUID prefix, which a relative/absolute manifest path can't
> know in advance — the library 404s. Deriving it at runtime works everywhere.

### Backend croquis (test context)

The board loads/saves the croquis as a SAP attachment (OData `ZTS_CA_UI5F_ATTA`,
Otype `CROQ`, Objid = notification number). `Main.controller.ts` sets:

- `objid` = **`420004467`** — notification E2 "test LMRA" (order `000110008999`) on
  **DTA 310**, which already has a photo croquis. Croquis saved by the host apps are
  keyed by the notification number **without leading zeros**; the board looks up the
  exact `objid`.
- `serviceUrl` = `sap.ui.require.toUrl("zab/be/resa/zuidrawapp") + "/sap/opu/odata/sap/ZTS_CA_UI5F_ATTA"`
  — **app-relative**, so it resolves to `/sap/…` locally (dev-server proxy) and to
  `<app>/sap/…` on BTP (app route `/sap` → destination `erp`).

The library rewrites the attachment download URL returned by SAP (`/sap/opu/…/$value`)
under the same prefix as `serviceUrl`, so it also goes through the app route on BTP.
Details: [`library/README.md` §7](library/README.md).

> **Client**: the BTP `erp` destination logs on to **client 310**, and its `sap-client`
> overrides any `?sap-client=` in the request. `main` runs against client 300 —
> attachments are stored per client, so the same `objid` can show a different croquis.

### Starting the app locally

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
npm run build:mta    # build the BTP archive    -> mta_archives/zabberesadraw_<ver>.mtar
```

## Deploying to SAP BTP

One MTA (`mta.yaml`, ID `zabberesadraw`) deploys **both** the library and the app into
the same HTML5 Application Repository app-host (managed approuter, business service
`zabberesadraw`), with its own destination, XSUAA and app-host service instances:

```
cf target -o <org> -s <space>    # Work Zone dev subaccount / space
npm run deploy:cf                # mbt build + cf deploy
npm run undeploy:cf              # remove the MTA and its services
cf html5-list                    # check: zabberesazuidrawapp + zabberesadraw
```

- Library: `library/ui5-cf.yaml` → `zabberesadraw.zip` (+ `library/xs-app.json`).
  `ui5-task-zipper` strips the `/resources/zab/be/resa/draw/` prefix itself (no
  flatten step) and must run **`afterTask: buildThemes`**, otherwise the theme CSS is
  missing from the zip.
- App: `ui5-cf.yaml` → `zabberesazuidrawapp.zip` (+ `xs-app.json`: `/sap` → destination
  `erp`, `/resources` and `/test-resources` → ui5.sap.com, rest → HTML5 repo).
- The app manifest carries `sap.cloud` (`public: true`, `service: zabberesadraw`).

### Running it (standalone)

The destinations are created at **destination-instance level** (like the other apps of
the subaccount), so the URL needs the destination service instance GUID as prefix —
without it the launchpad answers a plain "Not Found":

```
https://<subdomain>.launchpad.cfapps.<region>.hana.ondemand.com/<destination-instance-guid>.zabberesadraw.zabberesazuidrawapp/index.html
```

`<destination-instance-guid>` = `cf service zabberesadraw-destination-service --guid`.

Notes:
- Log in through the subaccount's IdP first (any launchpad page triggers it).
- Right after a redeploy the HTML5 repo can answer slowly (504 / pending requests) for
  a minute — reload.
- 404s on `i18n/i18n_fr*.properties` / `i18n_en.properties` are the normal UI5 locale
  fallbacks.
- The app is **intentionally not added to any Work Zone site** — it is a standalone test
  harness. (Should that change: Channel Manager → refresh *HTML5 Apps*, Content Explorer
  → add `zab.be.resa.zuidrawapp`, assign it to a role/page.)

## Deploying to ABAP (legacy)

`ui5-deploy.yaml` / `library/ui5-deploy.yaml` are kept from the original setup; the ABAP
deployment is maintained on the `main` branch (`npm run deploy-lib`).

#### Pre-requisites:

1. Active NodeJS LTS (Long Term Support) version and associated supported NPM version.  (See https://nodejs.org)
2. For BTP: Cloud Foundry CLI with the `multiapps` and `html5-plugin` plugins, and `mbt`
   (installed as a dev dependency).
