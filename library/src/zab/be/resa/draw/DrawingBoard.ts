import Control from "sap/ui/core/Control";
import Core from "sap/ui/core/Core";
import ResourceBundle from "sap/base/i18n/ResourceBundle";
import Event from "sap/ui/base/Event";
import OverflowToolbar from "sap/m/OverflowToolbar";
import ToolbarSeparator from "sap/m/ToolbarSeparator";
import Title from "sap/m/Title";
import Label from "sap/m/Label";
import Button from "sap/m/Button";
import Slider from "sap/m/Slider";
import Select from "sap/m/Select";
import SegmentedButton from "sap/m/SegmentedButton";
import SegmentedButtonItem from "sap/m/SegmentedButtonItem";
import Item from "sap/ui/core/Item";
import MessageToast from "sap/m/MessageToast";
import DrawingBoardRenderer from "./DrawingBoardRenderer";

interface Point {
	x: number;
	y: number;
}

interface ShapeBase {
	id: string;
	stroke: string;
	lineWidth: number;
	groupId?: string;
}

interface PenShape extends ShapeBase {
	type: "pen";
	points: Point[];
}

interface LineShape extends ShapeBase {
	type: "line";
	x1: number;
	y1: number;
	x2: number;
	y2: number;
}

interface RectShape extends ShapeBase {
	type: "rect";
	x1: number;
	y1: number;
	x2: number;
	y2: number;
}

interface CircleShape extends ShapeBase {
	type: "circle";
	cx: number;
	cy: number;
	r: number;
}

type Shape = PenShape | LineShape | RectShape | CircleShape;

interface Segment {
	x1: number;
	y1: number;
	x2: number;
	y2: number;
}

interface Bounds {
	minX: number;
	maxX: number;
	minY: number;
	maxY: number;
}

interface DrawState {
	tool: string;
	zoom: number;
	panX: number;
	panY: number;
	shapes: Shape[];
	selectedShapeId: string | null;
	draft: Shape | null;
	isDrawing: boolean;
	isDraggingSelection: boolean;
	isPanning: boolean;
	lastWorldPoint: Point | null;
	lastScreenPoint: Point | null;
}

interface BoundHandlers {
	onPointerDown: (oEvent: PointerEvent) => void;
	onPointerMove: (oEvent: PointerEvent) => void;
	onPointerUp: (oEvent: PointerEvent) => void;
	onWheel: (oEvent: WheelEvent) => void;
	onResize: () => void;
	onKeyDown: (oEvent: KeyboardEvent) => void;
}

/**
 * Tableau de dessin autonome basé sur un canevas HTML.
 *
 * Le contrôle construit sa propre barre d'outils (crayon, formes, préréglages,
 * zoom, annulation, export JPG) et gère intégralement le rendu sur canevas.
 * Il peut être posé tel quel dans n'importe quelle vue XML :
 *
 * <pre>
 *   &lt;draw:DrawingBoard editable="true" height="70vh" /&gt;
 * </pre>
 *
 * @namespace zab.be.resa.draw
 */
export default class DrawingBoard extends Control {

	public static readonly metadata = {
		library: "zab.be.resa.draw",
		properties: {
			/** Autorise ou non l'édition (barre d'outils active et interactions pointeur). */
			editable: { type: "boolean", defaultValue: true },
			/** Largeur du contrôle. */
			width: { type: "sap.ui.core.CSSSize", defaultValue: "100%" },
			/** Hauteur du contrôle. */
			height: { type: "sap.ui.core.CSSSize", defaultValue: "100%" }
		},
		aggregations: {
			/** Barre d'outils construite par le contrôle lui-même. */
			_toolbar: { type: "sap.m.OverflowToolbar", multiple: false, visibility: "hidden" }
		}
	};

	public static renderer = DrawingBoardRenderer;

	private _state!: DrawState;
	private _shapeIdCounter!: number;
	private _groupIdCounter!: number;
	private _redoStack!: Shape[][];
	private _boundCanvas!: HTMLCanvasElement | null;
	private _windowBound!: boolean;
	private _retrySetupTimer!: number | null;
	private _resizeObserver!: ResizeObserver | null;
	private _container!: HTMLElement | null;
	private _canvas!: HTMLCanvasElement | null;
	private _ctx!: CanvasRenderingContext2D | null;
	private _boundHandlers!: BoundHandlers;
	private _bundle!: ResourceBundle;

	private _toolSelector!: SegmentedButton;
	private _presetSelect!: Select;
	private _zoomSlider!: Slider;
	private _interactiveControls!: Array<{ setEnabled(b: boolean): unknown }>;

	/* =========================================================== */
	/* méthodes de cycle de vie                                    */
	/* =========================================================== */

	public init(): void {
		this._state = {
			tool: "pen",
			zoom: 1,
			panX: 0,
			panY: 0,
			shapes: [],
			selectedShapeId: null,
			draft: null,
			isDrawing: false,
			isDraggingSelection: false,
			isPanning: false,
			lastWorldPoint: null,
			lastScreenPoint: null
		};

		this._shapeIdCounter = 1;
		this._groupIdCounter = 1;
		this._redoStack = [];
		this._boundCanvas = null;
		this._windowBound = false;
		this._retrySetupTimer = null;
		this._resizeObserver = null;
		this._container = null;
		this._canvas = null;
		this._ctx = null;
		this._boundHandlers = {
			onPointerDown: this._onPointerDown.bind(this),
			onPointerMove: this._onPointerMove.bind(this),
			onPointerUp: this._onPointerUp.bind(this),
			onWheel: this._onWheel.bind(this),
			onResize: this._resizeCanvas.bind(this),
			onKeyDown: this._onKeyDown.bind(this)
		};

		this._bundle = Core.getLibraryResourceBundle("zab.be.resa.draw") as ResourceBundle;
		this._buildToolbar();
		this._applyEditable();
	}

	public onAfterRendering(): void {
		this._setupCanvas();
		if (this._retrySetupTimer) {
			window.clearTimeout(this._retrySetupTimer);
		}
		this._retrySetupTimer = window.setTimeout(this._setupCanvas.bind(this), 0);
	}

	public exit(): void {
		if (this._retrySetupTimer) {
			window.clearTimeout(this._retrySetupTimer);
			this._retrySetupTimer = null;
		}
		if (this._resizeObserver) {
			this._resizeObserver.disconnect();
			this._resizeObserver = null;
		}
		this._detachCanvasListeners(this._boundCanvas);
		this._boundCanvas = null;
		if (this._windowBound) {
			window.removeEventListener("resize", this._boundHandlers.onResize);
			window.removeEventListener("keydown", this._boundHandlers.onKeyDown);
			this._windowBound = false;
		}
	}

	/**
	 * Bascule l'état éditable : (dés)active la barre d'outils sans re-rendu.
	 */
	public setEditable(bEditable: boolean): this {
		this.setProperty("editable", bEditable, true);
		this._applyEditable();
		return this;
	}

	/* =========================================================== */
	/* construction de la barre d'outils                           */
	/* =========================================================== */

	private _getText(sTextId: string): string {
		return this._bundle.getText(sTextId) ?? sTextId;
	}

	private _buildToolbar(): void {
		this._toolSelector = new SegmentedButton({
			selectedKey: "pen",
			selectionChange: this._onToolChange.bind(this),
			items: [
				new SegmentedButtonItem({ key: "pen", text: this._getText("toolPen") }),
				new SegmentedButtonItem({ key: "line", text: this._getText("toolLine") }),
				new SegmentedButtonItem({ key: "rect", text: this._getText("toolRect") }),
				new SegmentedButtonItem({ key: "circle", text: this._getText("toolCircle") }),
				new SegmentedButtonItem({ key: "select", text: this._getText("toolSelect") }),
				new SegmentedButtonItem({ key: "pan", text: this._getText("toolPan") })
			]
		});

		this._presetSelect = new Select({
			width: "11rem",
			selectedKey: "house",
			items: [
				new Item({ key: "house", text: this._getText("presetHouse") }),
				new Item({ key: "car", text: this._getText("presetCar") }),
				new Item({ key: "tree", text: this._getText("presetTree") }),
				new Item({ key: "sun", text: this._getText("presetSun") }),
				new Item({ key: "boat", text: this._getText("presetBoat") }),
				new Item({ key: "cloud", text: this._getText("presetCloud") })
			]
		});

		this._zoomSlider = new Slider({
			width: "11rem",
			min: 0.25,
			max: 4,
			step: 0.05,
			value: 1,
			liveChange: this._onZoomSliderChange.bind(this)
		});

		const oInsertButton = new Button({ text: this._getText("insertObject"), press: this._onInsertPresetButtonPress.bind(this) });
		const oResetButton = new Button({ text: this._getText("resetView"), press: this._onResetView.bind(this) });
		const oUndoButton = new Button({ text: this._getText("undo"), press: this._onUndo.bind(this) });
		const oSmallerButton = new Button({ text: this._getText("decreaseSize"), press: this._onSmallerButtonPress.bind(this) });
		const oLargerButton = new Button({ text: this._getText("increaseSize"), press: this._onLargerButtonPress.bind(this) });
		const oClearButton = new Button({ text: this._getText("clear"), type: "Reject", press: this._onClear.bind(this) });
		const oDownloadButton = new Button({ text: this._getText("downloadJpg"), type: "Emphasized", press: this._onDownloadJpg.bind(this) });

		const oToolbar = new OverflowToolbar({
			content: [
				new Title({ text: this._getText("toolsTitle") }),
				this._toolSelector,
				new ToolbarSeparator(),
				new Label({ text: this._getText("objectsLabel") }),
				this._presetSelect,
				oInsertButton,
				new ToolbarSeparator(),
				new Label({ text: this._getText("zoomLabel") }),
				this._zoomSlider,
				oResetButton,
				oUndoButton,
				oSmallerButton,
				oLargerButton,
				oClearButton,
				oDownloadButton
			]
		});

		this._interactiveControls = [
			this._toolSelector,
			this._presetSelect,
			this._zoomSlider,
			oInsertButton,
			oResetButton,
			oUndoButton,
			oSmallerButton,
			oLargerButton,
			oClearButton,
			oDownloadButton
		];

		this.setAggregation("_toolbar", oToolbar);
	}

	private _applyEditable(): void {
		if (!this._interactiveControls) {
			return;
		}
		const bEditable = this.getProperty("editable") as boolean;
		this._interactiveControls.forEach((oControl) => {
			oControl.setEnabled(bEditable);
		});
	}

	/* =========================================================== */
	/* gestionnaires d'événements                                  */
	/* =========================================================== */

	private _onToolChange(oEvent: Event): void {
		const oItem = oEvent.getParameter("item") as SegmentedButtonItem;
		this._state.tool = oItem.getKey();
		this._state.selectedShapeId = null;
		this._render();
	}

	private _onZoomSliderChange(oEvent: Event): void {
		if (!this._canvas) {
			return;
		}
		const fZoom = oEvent.getParameter("value") as number;
		const oCenter: Point = {
			x: this._canvas.clientWidth / 2,
			y: this._canvas.clientHeight / 2
		};
		this._setZoom(fZoom, oCenter);
	}

	private _onResetView(): void {
		this._state.zoom = 1;
		this._state.panX = 0;
		this._state.panY = 0;
		this._zoomSlider.setValue(1);
		this._render();
	}

	private _onUndo(): void {
		const aUndoneShapes = this._collectUndoBatchFromTail();
		if (aUndoneShapes.length === 0) {
			return;
		}
		this._redoStack.push(aUndoneShapes);
		this._state.selectedShapeId = null;
		this._render();
	}

	private _onRedo(): void {
		const aRedoShapes = this._redoStack.pop();
		if (!aRedoShapes || aRedoShapes.length === 0) {
			return;
		}
		this._state.shapes.push.apply(this._state.shapes, aRedoShapes);
		this._state.selectedShapeId = aRedoShapes[0].groupId || aRedoShapes[0].id;
		this._render();
	}

	private _onSmallerButtonPress(): void {
		this._scaleSelectedShape(0.9);
	}

	private _onLargerButtonPress(): void {
		this._scaleSelectedShape(1.1);
	}

	private _onInsertPresetButtonPress(): void {
		if (!this._canvas) {
			return;
		}

		const sPreset = this._presetSelect.getSelectedKey() || "house";
		const oCenterScreen: Point = {
			x: this._canvas.clientWidth / 2,
			y: this._canvas.clientHeight / 2
		};
		const oCenterWorld = this._screenToWorld(oCenterScreen);
		const sGroupId = "g-" + (this._groupIdCounter++);
		const aPresetShapes = this._createPresetShapes(sPreset, oCenterWorld, sGroupId);
		this._state.shapes.push.apply(this._state.shapes, aPresetShapes);
		this._redoStack = [];
		this._state.selectedShapeId = sGroupId;
		this._render();
	}

	private _onClear(): void {
		this._state.shapes = [];
		this._redoStack = [];
		this._state.draft = null;
		this._state.selectedShapeId = null;
		this._render();
		MessageToast.show(this._getText("canvasCleared"));
	}

	private _onDownloadJpg(): void {
		if (!this._canvas) {
			return;
		}

		const oCanvas = this._canvas;
		const sName = "dessin-" + new Date().toISOString().replace(/[:.]/g, "-") + ".jpg";
		const fnDownload = (sUrl: string): void => {
			const oLink = document.createElement("a");
			oLink.href = sUrl;
			oLink.download = sName;
			document.body.appendChild(oLink);
			oLink.click();
			document.body.removeChild(oLink);
		};

		if (oCanvas.toBlob) {
			oCanvas.toBlob((oBlob: Blob | null) => {
				if (!oBlob) {
					return;
				}
				const sObjectUrl = URL.createObjectURL(oBlob);
				fnDownload(sObjectUrl);
				window.setTimeout(() => {
					URL.revokeObjectURL(sObjectUrl);
				}, 1000);
				MessageToast.show(this._getText("downloadSuccess"));
			}, "image/jpeg", 0.92);
			return;
		}

		fnDownload(oCanvas.toDataURL("image/jpeg", 0.92));
		MessageToast.show(this._getText("downloadSuccess"));
	}

	/* =========================================================== */
	/* mise en place du canevas                                    */
	/* =========================================================== */

	private _setupCanvas(): void {
		const oHost = this.getDomRef();
		if (!oHost) {
			this._retrySetupTimer = window.setTimeout(this._setupCanvas.bind(this), 60);
			return;
		}

		this._container = oHost.querySelector(".db-root") as HTMLElement | null;
		this._canvas = oHost.querySelector(".db-canvas") as HTMLCanvasElement | null;
		if (!this._container || !this._canvas) {
			this._retrySetupTimer = window.setTimeout(this._setupCanvas.bind(this), 60);
			return;
		}

		// UI5 peut recréer l'élément <canvas> à chaque nouveau rendu (une page objet
		// re-rend ses sections lorsqu'elles deviennent visibles). Il faut donc
		// (re)brancher les écouteurs dès que le nœud canevas a changé, sinon la
		// souris cesse de fonctionner après un re-rendu.
		if (this._boundCanvas !== this._canvas) {
			this._detachCanvasListeners(this._boundCanvas);
			this._canvas.style.touchAction = "none";
			this._canvas.addEventListener("pointerdown", this._boundHandlers.onPointerDown);
			this._canvas.addEventListener("pointermove", this._boundHandlers.onPointerMove);
			this._canvas.addEventListener("pointerup", this._boundHandlers.onPointerUp);
			this._canvas.addEventListener("pointerleave", this._boundHandlers.onPointerUp);
			this._canvas.addEventListener("wheel", this._boundHandlers.onWheel, { passive: false });
			this._boundCanvas = this._canvas;
		}

		if (!this._windowBound) {
			window.addEventListener("resize", this._boundHandlers.onResize);
			window.addEventListener("keydown", this._boundHandlers.onKeyDown);
			this._windowBound = true;
		}

		// Posé dans une page objet (ou un shell FLP), le contrôle peut être rendu
		// alors qu'il est encore masqué / dans la zone de préservation du DOM d'UI5,
		// c.-à-d. avec un conteneur de taille nulle, puis révélé plus tard sans qu'aucun
		// événement "resize" ne se déclenche. Un dimensionnement unique dans
		// onAfterRendering fige donc le canevas à 0x0 et il reste vide. Observer le
		// conteneur fait que le canevas se (re)dimensionne et repeint la grille dès
		// qu'il obtient de vraies dimensions, quel que soit le contexte d'hébergement.
		if (typeof ResizeObserver !== "undefined") {
			if (this._resizeObserver) {
				this._resizeObserver.disconnect();
			}
			this._resizeObserver = new ResizeObserver(this._boundHandlers.onResize);
			this._resizeObserver.observe(this._container);
		}

		this._resizeCanvas();
	}

	private _detachCanvasListeners(oCanvas: HTMLCanvasElement | null): void {
		if (!oCanvas) {
			return;
		}
		oCanvas.removeEventListener("pointerdown", this._boundHandlers.onPointerDown);
		oCanvas.removeEventListener("pointermove", this._boundHandlers.onPointerMove);
		oCanvas.removeEventListener("pointerup", this._boundHandlers.onPointerUp);
		oCanvas.removeEventListener("pointerleave", this._boundHandlers.onPointerUp);
		oCanvas.removeEventListener("wheel", this._boundHandlers.onWheel);
	}

	private _resizeCanvas(): void {
		if (!this._canvas || !this._container) {
			return;
		}
		const oRect = this._container.getBoundingClientRect();
		const fDpr = window.devicePixelRatio || 1;
		const iWidth = Math.max(1, Math.floor(oRect.width));
		const iHeight = Math.max(1, Math.floor(oRect.height));
		this._canvas.width = Math.floor(iWidth * fDpr);
		this._canvas.height = Math.floor(iHeight * fDpr);
		this._canvas.style.width = iWidth + "px";
		this._canvas.style.height = iHeight + "px";
		this._ctx = this._canvas.getContext("2d");
		if (!this._ctx) {
			return;
		}
		this._ctx.setTransform(fDpr, 0, 0, fDpr, 0, 0);
		this._render();
	}

	/* =========================================================== */
	/* interaction pointeur / clavier                              */
	/* =========================================================== */

	private _onPointerDown(oEvent: PointerEvent): void {
		if (!this._ctx || !this._canvas || !(this.getProperty("editable") as boolean)) {
			return;
		}
		oEvent.preventDefault();
		this._canvas.setPointerCapture(oEvent.pointerId);

		const oScreen = this._eventToCanvasPoint(oEvent);
		const oWorld = this._screenToWorld(oScreen);
		this._state.lastScreenPoint = oScreen;
		this._state.lastWorldPoint = oWorld;

		if (this._state.tool === "pan" || oEvent.button === 1) {
			this._state.isPanning = true;
			return;
		}

		if (this._state.tool === "select") {
			const oHitShape = this._hitTest(oWorld);
			if (oHitShape) {
				this._state.selectedShapeId = oHitShape.groupId || oHitShape.id;
				this._state.isDraggingSelection = true;
			} else {
				this._state.selectedShapeId = null;
			}
			this._render();
			return;
		}

		this._state.isDrawing = true;
		this._state.draft = this._createDraftShape(this._state.tool, oWorld);
		this._render();
	}

	private _onPointerMove(oEvent: PointerEvent): void {
		if (!this._ctx) {
			return;
		}
		const oScreen = this._eventToCanvasPoint(oEvent);
		const oWorld = this._screenToWorld(oScreen);

		if (this._state.isPanning && this._state.lastScreenPoint) {
			this._state.panX += oScreen.x - this._state.lastScreenPoint.x;
			this._state.panY += oScreen.y - this._state.lastScreenPoint.y;
			this._state.lastScreenPoint = oScreen;
			this._render();
			return;
		}

		if (this._state.isDraggingSelection && this._state.selectedShapeId && this._state.lastWorldPoint) {
			const fDx = oWorld.x - this._state.lastWorldPoint.x;
			const fDy = oWorld.y - this._state.lastWorldPoint.y;
			this._translateSelection(this._state.selectedShapeId, fDx, fDy);
			this._state.lastWorldPoint = oWorld;
			this._render();
			return;
		}

		if (!this._state.isDrawing || !this._state.draft) {
			return;
		}

		if (this._state.draft.type === "pen") {
			this._state.draft.points.push({ x: oWorld.x, y: oWorld.y });
		} else if (this._state.draft.type === "circle") {
			const fRx = oWorld.x - this._state.draft.cx;
			const fRy = oWorld.y - this._state.draft.cy;
			this._state.draft.r = Math.sqrt(fRx * fRx + fRy * fRy);
		} else {
			this._state.draft.x2 = oWorld.x;
			this._state.draft.y2 = oWorld.y;
		}
		this._render();
	}

	private _onPointerUp(oEvent: PointerEvent): void {
		if (!this._ctx || !this._canvas) {
			return;
		}

		if (oEvent.pointerId !== undefined && this._canvas.hasPointerCapture(oEvent.pointerId)) {
			this._canvas.releasePointerCapture(oEvent.pointerId);
		}

		if (this._state.isDrawing && this._state.draft) {
			if (this._isShapeVisible(this._state.draft)) {
				this._state.shapes.push(this._state.draft);
				this._redoStack = [];
			}
		}

		this._state.draft = null;
		this._state.isDrawing = false;
		this._state.isDraggingSelection = false;
		this._state.isPanning = false;
		this._state.lastScreenPoint = null;
		this._state.lastWorldPoint = null;
		this._render();
	}

	private _onKeyDown(oEvent: KeyboardEvent): void {
		if (!(this.getProperty("editable") as boolean)) {
			return;
		}

		const oTarget = oEvent.target;
		if (oTarget instanceof HTMLElement) {
			const bTyping = !!oTarget.closest("input, textarea, [contenteditable='true']");
			if (bTyping) {
				return;
			}
		}

		const bModifier = oEvent.ctrlKey || oEvent.metaKey;
		if (!bModifier) {
			return;
		}

		const sKey = oEvent.key.toLowerCase();
		if (sKey === "z" && !oEvent.shiftKey) {
			oEvent.preventDefault();
			this._onUndo();
			return;
		}

		if (sKey === "y" || (sKey === "z" && oEvent.shiftKey)) {
			oEvent.preventDefault();
			this._onRedo();
		}
	}

	private _onWheel(oEvent: WheelEvent): void {
		oEvent.preventDefault();
		const fStep = oEvent.deltaY > 0 ? 0.92 : 1.08;
		const fNewZoom = Math.max(0.25, Math.min(4, this._state.zoom * fStep));
		this._setZoom(fNewZoom, this._eventToCanvasPoint(oEvent));
	}

	/* =========================================================== */
	/* aides historique / sélection                                */
	/* =========================================================== */

	private _collectUndoBatchFromTail(): Shape[] {
		const iLastIndex = this._state.shapes.length - 1;
		if (iLastIndex < 0) {
			return [];
		}

		const oLastShape = this._state.shapes[iLastIndex];
		const sLastGroupId = oLastShape.groupId;
		if (!sLastGroupId) {
			const oSingle = this._state.shapes.pop();
			return oSingle ? [oSingle] : [];
		}

		const aBatch: Shape[] = [];
		while (this._state.shapes.length > 0) {
			const oTail = this._state.shapes[this._state.shapes.length - 1];
			if (oTail.groupId !== sLastGroupId) {
				break;
			}
			aBatch.unshift(oTail);
			this._state.shapes.pop();
		}
		return aBatch;
	}

	private _setZoom(fNewZoom: number, oScreenAnchor?: Point): void {
		if (!this._canvas) {
			return;
		}
		const oAnchor: Point = oScreenAnchor || {
			x: this._canvas.clientWidth / 2,
			y: this._canvas.clientHeight / 2
		};
		const oBefore = this._screenToWorld(oAnchor);
		this._state.zoom = fNewZoom;
		this._state.panX = oAnchor.x - oBefore.x * this._state.zoom;
		this._state.panY = oAnchor.y - oBefore.y * this._state.zoom;
		this._zoomSlider.setValue(fNewZoom);
		this._render();
	}

	private _eventToCanvasPoint(oEvent: MouseEvent): Point {
		if (!this._canvas) {
			return { x: 0, y: 0 };
		}
		const oRect = this._canvas.getBoundingClientRect();
		return {
			x: oEvent.clientX - oRect.left,
			y: oEvent.clientY - oRect.top
		};
	}

	private _screenToWorld(oPoint: Point): Point {
		return {
			x: (oPoint.x - this._state.panX) / this._state.zoom,
			y: (oPoint.y - this._state.panY) / this._state.zoom
		};
	}

	private _createDraftShape(sTool: string, oWorld: Point): Shape {
		const oCommon = {
			id: String(this._shapeIdCounter++),
			stroke: "#0d47a1",
			lineWidth: 2
		};

		if (sTool === "pen") {
			return { ...oCommon, type: "pen", points: [{ x: oWorld.x, y: oWorld.y }] };
		}

		if (sTool === "line") {
			return { ...oCommon, type: "line", x1: oWorld.x, y1: oWorld.y, x2: oWorld.x, y2: oWorld.y };
		}

		if (sTool === "rect") {
			return { ...oCommon, type: "rect", x1: oWorld.x, y1: oWorld.y, x2: oWorld.x, y2: oWorld.y };
		}

		return { ...oCommon, type: "circle", cx: oWorld.x, cy: oWorld.y, r: 0 };
	}

	private _isShapeVisible(oShape: Shape): boolean {
		if (oShape.type === "pen") {
			return oShape.points.length > 1;
		}
		if (oShape.type === "line") {
			return this._distance(oShape.x1, oShape.y1, oShape.x2, oShape.y2) > 2;
		}
		if (oShape.type === "rect") {
			return Math.abs(oShape.x2 - oShape.x1) > 2 && Math.abs(oShape.y2 - oShape.y1) > 2;
		}
		return oShape.r > 2;
	}

	private _translateSelection(sSelectionId: string, fDx: number, fDy: number): void {
		const aTargets = this._getShapesForSelection(sSelectionId);
		aTargets.forEach((oShape) => {
			if (oShape.type === "pen") {
				oShape.points = oShape.points.map((oPoint) => {
					return { x: oPoint.x + fDx, y: oPoint.y + fDy };
				});
				return;
			}

			if (oShape.type === "circle") {
				oShape.cx += fDx;
				oShape.cy += fDy;
				return;
			}

			oShape.x1 += fDx;
			oShape.y1 += fDy;
			oShape.x2 += fDx;
			oShape.y2 += fDy;
		});
	}

	private _scaleSelectedShape(fFactor: number): void {
		if (!this._state.selectedShapeId) {
			this._showSelectObjectMessage();
			return;
		}

		const aTargets = this._getShapesForSelection(this._state.selectedShapeId);
		if (aTargets.length === 0) {
			this._showSelectObjectMessage();
			return;
		}

		const oCenter = this._getSelectionCenter(aTargets);
		aTargets.forEach((oShape) => {
			this._scaleShapeAroundCenter(oShape, oCenter, fFactor);
		});
		this._render();
	}

	private _getSelectionCenter(aShapes: Shape[]): Point {
		const oBounds = this._getShapesBounds(aShapes);
		return {
			x: (oBounds.minX + oBounds.maxX) / 2,
			y: (oBounds.minY + oBounds.maxY) / 2
		};
	}

	private _getShapeBounds(oShape: Shape): Bounds {
		if (oShape.type === "line") {
			return {
				minX: Math.min(oShape.x1, oShape.x2),
				maxX: Math.max(oShape.x1, oShape.x2),
				minY: Math.min(oShape.y1, oShape.y2),
				maxY: Math.max(oShape.y1, oShape.y2)
			};
		}

		if (oShape.type === "rect") {
			return {
				minX: Math.min(oShape.x1, oShape.x2),
				maxX: Math.max(oShape.x1, oShape.x2),
				minY: Math.min(oShape.y1, oShape.y2),
				maxY: Math.max(oShape.y1, oShape.y2)
			};
		}

		if (oShape.type === "circle") {
			return {
				minX: oShape.cx - oShape.r,
				maxX: oShape.cx + oShape.r,
				minY: oShape.cy - oShape.r,
				maxY: oShape.cy + oShape.r
			};
		}

		const oSeed = oShape.points[0] || { x: 0, y: 0 };
		return oShape.points.reduce<Bounds>((oAcc, oPoint) => {
			return {
				minX: Math.min(oAcc.minX, oPoint.x),
				maxX: Math.max(oAcc.maxX, oPoint.x),
				minY: Math.min(oAcc.minY, oPoint.y),
				maxY: Math.max(oAcc.maxY, oPoint.y)
			};
		}, {
			minX: oSeed.x,
			maxX: oSeed.x,
			minY: oSeed.y,
			maxY: oSeed.y
		});
	}

	private _getShapesBounds(aShapes: Shape[]): Bounds {
		const oInitial = this._getShapeBounds(aShapes[0]);
		return aShapes.slice(1).reduce<Bounds>((oAcc, oShape) => {
			const oBounds = this._getShapeBounds(oShape);
			return {
				minX: Math.min(oAcc.minX, oBounds.minX),
				maxX: Math.max(oAcc.maxX, oBounds.maxX),
				minY: Math.min(oAcc.minY, oBounds.minY),
				maxY: Math.max(oAcc.maxY, oBounds.maxY)
			};
		}, oInitial);
	}

	private _scaleShapeAroundCenter(oShape: Shape, oCenter: Point, fFactor: number): void {
		if (oShape.type === "circle") {
			oShape.cx = oCenter.x + (oShape.cx - oCenter.x) * fFactor;
			oShape.cy = oCenter.y + (oShape.cy - oCenter.y) * fFactor;
			oShape.r = Math.max(2, oShape.r * fFactor);
			return;
		}

		if (oShape.type === "line") {
			oShape.x1 = oCenter.x + (oShape.x1 - oCenter.x) * fFactor;
			oShape.y1 = oCenter.y + (oShape.y1 - oCenter.y) * fFactor;
			oShape.x2 = oCenter.x + (oShape.x2 - oCenter.x) * fFactor;
			oShape.y2 = oCenter.y + (oShape.y2 - oCenter.y) * fFactor;
			return;
		}

		if (oShape.type === "rect") {
			oShape.x1 = oCenter.x + (oShape.x1 - oCenter.x) * fFactor;
			oShape.y1 = oCenter.y + (oShape.y1 - oCenter.y) * fFactor;
			oShape.x2 = oCenter.x + (oShape.x2 - oCenter.x) * fFactor;
			oShape.y2 = oCenter.y + (oShape.y2 - oCenter.y) * fFactor;
			return;
		}

		oShape.points = oShape.points.map((oPoint) => {
			return {
				x: oCenter.x + (oPoint.x - oCenter.x) * fFactor,
				y: oCenter.y + (oPoint.y - oCenter.y) * fFactor
			};
		});
	}

	private _isShapeMatchSelection(oShape: Shape, sSelectionId: string | null): boolean {
		if (!sSelectionId) {
			return false;
		}
		return oShape.id === sSelectionId || oShape.groupId === sSelectionId;
	}

	private _getShapesForSelection(sSelectionId: string): Shape[] {
		return this._state.shapes.filter((oShape) => {
			return this._isShapeMatchSelection(oShape, sSelectionId);
		});
	}

	private _createPresetShapes(sPreset: string, oCenter: Point, sGroupId: string): Shape[] {
		const oStyle = {
			stroke: "#0d47a1",
			lineWidth: 2,
			groupId: sGroupId
		};
		const fnRect = (x1: number, y1: number, x2: number, y2: number): RectShape => ({
			id: String(this._shapeIdCounter++),
			...oStyle,
			type: "rect",
			x1: oCenter.x + x1,
			y1: oCenter.y + y1,
			x2: oCenter.x + x2,
			y2: oCenter.y + y2
		});
		const fnLine = (x1: number, y1: number, x2: number, y2: number): LineShape => ({
			id: String(this._shapeIdCounter++),
			...oStyle,
			type: "line",
			x1: oCenter.x + x1,
			y1: oCenter.y + y1,
			x2: oCenter.x + x2,
			y2: oCenter.y + y2
		});
		const fnCircle = (x: number, y: number, r: number): CircleShape => ({
			id: String(this._shapeIdCounter++),
			...oStyle,
			type: "circle",
			cx: oCenter.x + x,
			cy: oCenter.y + y,
			r: r
		});

		if (sPreset === "house") {
			return [
				fnRect(-40, -10, 40, 50),
				fnLine(-40, -10, 0, -45),
				fnLine(0, -45, 40, -10),
				fnRect(-10, 15, 10, 50),
				fnRect(-32, 5, -16, 21),
				fnRect(16, 5, 32, 21)
			];
		}

		if (sPreset === "car") {
			return [
				fnRect(-55, 6, 55, 35),
				fnLine(-35, 6, -12, -12),
				fnLine(-12, -12, 24, -12),
				fnLine(24, -12, 45, 6),
				fnCircle(-28, 38, 10),
				fnCircle(28, 38, 10)
			];
		}

		if (sPreset === "tree") {
			return [
				fnRect(-10, 15, 10, 55),
				fnCircle(0, -10, 24),
				fnCircle(-18, 5, 16),
				fnCircle(18, 5, 16)
			];
		}

		if (sPreset === "sun") {
			return [
				fnCircle(0, 0, 22),
				fnLine(0, -42, 0, -28),
				fnLine(30, -30, 20, -20),
				fnLine(42, 0, 28, 0),
				fnLine(30, 30, 20, 20),
				fnLine(0, 42, 0, 28),
				fnLine(-30, 30, -20, 20),
				fnLine(-42, 0, -28, 0),
				fnLine(-30, -30, -20, -20)
			];
		}

		if (sPreset === "boat") {
			return [
				fnLine(-55, 24, 55, 24),
				fnLine(-45, 24, -25, 42),
				fnLine(-25, 42, 25, 42),
				fnLine(25, 42, 45, 24),
				fnLine(0, 24, 0, -30),
				fnLine(0, -30, 30, -5),
				fnLine(0, -5, 30, -5)
			];
		}

		return [
			fnCircle(-18, 0, 14),
			fnCircle(0, -10, 18),
			fnCircle(20, 0, 14),
			fnLine(-34, 14, 34, 14)
		];
	}

	private _showSelectObjectMessage(): void {
		MessageToast.show(this._getText("selectObjectFirst"));
	}

	private _hitTest(oWorld: Point): Shape | null {
		const fTolerance = 8 / this._state.zoom;
		for (let i = this._state.shapes.length - 1; i >= 0; i -= 1) {
			const oShape = this._state.shapes[i];

			if (oShape.type === "line" && this._distanceToSegment(oWorld, oShape) <= fTolerance) {
				return oShape;
			}

			if (oShape.type === "rect") {
				const xMin = Math.min(oShape.x1, oShape.x2) - fTolerance;
				const xMax = Math.max(oShape.x1, oShape.x2) + fTolerance;
				const yMin = Math.min(oShape.y1, oShape.y2) - fTolerance;
				const yMax = Math.max(oShape.y1, oShape.y2) + fTolerance;
				if (oWorld.x >= xMin && oWorld.x <= xMax && oWorld.y >= yMin && oWorld.y <= yMax) {
					return oShape;
				}
			}

			if (oShape.type === "circle") {
				const fDist = this._distance(oWorld.x, oWorld.y, oShape.cx, oShape.cy);
				if (Math.abs(fDist - oShape.r) <= fTolerance || fDist <= oShape.r) {
					return oShape;
				}
			}

			if (oShape.type === "pen") {
				for (let j = 1; j < oShape.points.length; j += 1) {
					if (this._distanceToSegment(oWorld, {
						x1: oShape.points[j - 1].x,
						y1: oShape.points[j - 1].y,
						x2: oShape.points[j].x,
						y2: oShape.points[j].y
					}) <= fTolerance) {
						return oShape;
					}
				}
			}
		}
		return null;
	}

	/* =========================================================== */
	/* rendu                                                       */
	/* =========================================================== */

	private _render(): void {
		if (!this._ctx || !this._canvas) {
			return;
		}

		const iWidth = this._canvas.clientWidth;
		const iHeight = this._canvas.clientHeight;
		this._ctx.clearRect(0, 0, iWidth, iHeight);
		this._drawBackgroundGrid(iWidth, iHeight);

		this._ctx.save();
		this._ctx.translate(this._state.panX, this._state.panY);
		this._ctx.scale(this._state.zoom, this._state.zoom);

		this._state.shapes.forEach((oShape) => {
			this._drawShape(oShape, this._isShapeMatchSelection(oShape, this._state.selectedShapeId));
		});

		if (this._state.draft) {
			this._ctx.save();
			this._ctx.globalAlpha = 0.75;
			this._drawShape(this._state.draft, false);
			this._ctx.restore();
		}

		this._ctx.restore();
	}

	private _drawBackgroundGrid(iWidth: number, iHeight: number): void {
		if (!this._ctx) {
			return;
		}
		const iGridSize = 24;
		this._ctx.save();
		this._ctx.fillStyle = "#f8fbff";
		this._ctx.fillRect(0, 0, iWidth, iHeight);
		this._ctx.strokeStyle = "#dce6f2";
		this._ctx.lineWidth = 1;

		for (let x = 0; x <= iWidth; x += iGridSize) {
			this._ctx.beginPath();
			this._ctx.moveTo(x + 0.5, 0);
			this._ctx.lineTo(x + 0.5, iHeight);
			this._ctx.stroke();
		}

		for (let y = 0; y <= iHeight; y += iGridSize) {
			this._ctx.beginPath();
			this._ctx.moveTo(0, y + 0.5);
			this._ctx.lineTo(iWidth, y + 0.5);
			this._ctx.stroke();
		}

		this._ctx.restore();
	}

	private _drawShape(oShape: Shape, bSelected: boolean): void {
		if (!this._ctx) {
			return;
		}
		this._ctx.save();
		this._ctx.strokeStyle = bSelected ? "#ff6f00" : oShape.stroke;
		this._ctx.lineWidth = (oShape.lineWidth || 2) / this._state.zoom;
		this._ctx.lineJoin = "round";
		this._ctx.lineCap = "round";

		if (oShape.type === "line") {
			this._ctx.beginPath();
			this._ctx.moveTo(oShape.x1, oShape.y1);
			this._ctx.lineTo(oShape.x2, oShape.y2);
			this._ctx.stroke();
		}

		if (oShape.type === "rect") {
			this._ctx.strokeRect(oShape.x1, oShape.y1, oShape.x2 - oShape.x1, oShape.y2 - oShape.y1);
		}

		if (oShape.type === "circle") {
			this._ctx.beginPath();
			this._ctx.arc(oShape.cx, oShape.cy, oShape.r, 0, Math.PI * 2);
			this._ctx.stroke();
		}

		if (oShape.type === "pen" && oShape.points.length > 1) {
			this._ctx.beginPath();
			this._ctx.moveTo(oShape.points[0].x, oShape.points[0].y);
			for (let i = 1; i < oShape.points.length; i += 1) {
				this._ctx.lineTo(oShape.points[i].x, oShape.points[i].y);
			}
			this._ctx.stroke();
		}

		this._ctx.restore();
	}

	/* =========================================================== */
	/* aides géométriques                                          */
	/* =========================================================== */

	private _distanceToSegment(oPoint: Point, oSegment: Segment): number {
		const fDx = oSegment.x2 - oSegment.x1;
		const fDy = oSegment.y2 - oSegment.y1;
		if (fDx === 0 && fDy === 0) {
			return this._distance(oPoint.x, oPoint.y, oSegment.x1, oSegment.y1);
		}

		let fT = ((oPoint.x - oSegment.x1) * fDx + (oPoint.y - oSegment.y1) * fDy) / (fDx * fDx + fDy * fDy);
		fT = Math.max(0, Math.min(1, fT));
		return this._distance(oPoint.x, oPoint.y, oSegment.x1 + fT * fDx, oSegment.y1 + fT * fDy);
	}

	private _distance(x1: number, y1: number, x2: number, y2: number): number {
		const fDx = x2 - x1;
		const fDy = y2 - y1;
		return Math.sqrt(fDx * fDx + fDy * fDy);
	}
}
