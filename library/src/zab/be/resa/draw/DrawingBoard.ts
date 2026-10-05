import Control from "sap/ui/core/Control";
import Core from "sap/ui/core/Core";
import ResourceBundle from "sap/base/i18n/ResourceBundle";
import FlexBox from "sap/m/FlexBox";
import Title from "sap/m/Title";
import Label from "sap/m/Label";
import Text from "sap/m/Text";
import Button from "sap/m/Button";
import Slider, { Slider$LiveChangeEvent } from "sap/m/Slider";
import Select, { Select$ChangeEvent } from "sap/m/Select";
import SegmentedButton, { SegmentedButton$SelectionChangeEvent } from "sap/m/SegmentedButton";
import SegmentedButtonItem from "sap/m/SegmentedButtonItem";
import Item from "sap/ui/core/Item";
import MessageToast from "sap/m/MessageToast";
import Dialog from "sap/m/Dialog";
import Input from "sap/m/Input";
import ColorPalettePopover, { ColorPalettePopover$ColorSelectEvent } from "sap/m/ColorPalettePopover";
import HTML from "sap/ui/core/HTML";
import DrawingBoardRenderer from "./DrawingBoardRenderer";
import { insertTextChunk, readTextChunk, encodeUtf8ToBase64, decodeBase64ToUtf8 } from "./PngMetadata";

type DrawMode = "draw" | "photo";

/** Mot-clé du chunk PNG portant le projet ré-éditable. */
const PROJECT_CHUNK_KEYWORD = "zabDrawProject";

interface ProjectImage {
	dataUrl: string;
	width: number;
	height: number;
}

/**
 * Projet de dessin sérialisable : image d'origine + lignes vectorielles.
 * Les coordonnées des formes sont exprimées dans l'espace indiqué par
 * `coordinateSpace` : « image-pixels » (pixels de la photo) en mode photo,
 * « world » (coordonnées canevas) à défaut.
 */
interface DrawProject {
	type: "zab.be.resa.draw.project";
	version: number;
	mode: DrawMode;
	strokeColor: string;
	coordinateSpace: "image-pixels" | "world";
	width: number;
	height: number;
	image: ProjectImage | null;
	shapes: Shape[];
	shapeIdCounter: number;
	groupIdCounter: number;
}

interface Rect {
	x: number;
	y: number;
	w: number;
	h: number;
}

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

interface TextShape extends ShapeBase {
	type: "text";
	x: number;
	y: number;
	text: string;
	fontSize: number;
}

type Shape = PenShape | LineShape | RectShape | CircleShape | TextShape;

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
	mode: DrawMode;
	strokeColor: string;
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
	onDragOver: (oEvent: DragEvent) => void;
	onDragLeave: (oEvent: DragEvent) => void;
	onDrop: (oEvent: DragEvent) => void;
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
			height: { type: "sap.ui.core.CSSSize", defaultValue: "100%" },
			/**
			 * URL de base du service OData de pièces jointes (ZTS_CA_UI5F_ATTA).
			 * Sert au chargement / à l'enregistrement du croquis dans le backend.
			 */
			serviceUrl: { type: "string", defaultValue: "/sap/opu/odata/sap/ZTS_CA_UI5F_ATTA" },
			/** Type d'objet (Otype) dans le système de pièces jointes (ex. « CROQ »). */
			otype: { type: "string", defaultValue: "" },
			/**
			 * Identifiant d'objet (Objid) : clé de stockage du croquis dans le système
			 * de pièces jointes. Pour un croquis, il s'agit du numéro d'avis (QMEL-QMNUM).
			 */
			objid: { type: "string", defaultValue: "" }
		},
		aggregations: {
			/** Conteneur de barre d'outils (FlexBox à retour à la ligne) construit par le contrôle. */
			_toolbar: { type: "sap.m.FlexBox", multiple: false, visibility: "hidden" }
		}
	};

	public static renderer = DrawingBoardRenderer;

	private _state!: DrawState;
	private _shapeIdCounter!: number;
	private _groupIdCounter!: number;
	/** Historique d'annulation : instantanés complets de la liste des formes. */
	private _undoStack!: Shape[][];
	/** Vrai tant qu'un déplacement n'a pas encore enregistré son instantané. */
	private _pendingDragHistory!: boolean;
	/** Pile de rétablissement : instantanés complets de la liste des formes. */
	private _redoStack!: Shape[][];
	private _boundCanvas!: HTMLCanvasElement | null;
	private _windowBound!: boolean;
	/** Vrai une fois le chargement automatique du croquis tenté (une seule fois). */
	private _croquisAutoLoaded!: boolean;
	private _retrySetupTimer!: number | null;
	private _resizeObserver!: ResizeObserver | null;
	private _container!: HTMLElement | null;
	private _canvas!: HTMLCanvasElement | null;
	private _ctx!: CanvasRenderingContext2D | null;
	private _boundHandlers!: BoundHandlers;
	private _bundle!: ResourceBundle;

	private _toolSelector!: SegmentedButton;
	private _modeSelector!: SegmentedButton;
	private _presetSelect!: Select;
	private _zoomSlider!: Slider;
	private _colorButton!: Button;
	private _colorPopover!: ColorPalettePopover | null;
	private _cameraSelect!: Select;
	private _interactiveControls!: Array<{ setEnabled(b: boolean): unknown }>;
	/** Contrôles liés au dessin, (dés)activés selon le mode et la présence d'une photo. */
	private _drawingControls!: Array<{ setVisible(b: boolean): unknown; setEnabled(b: boolean): unknown }>;
	/** Contrôles liés à la photo (téléversement / caméra), visibles en mode photo. */
	private _photoControls!: Array<{ setVisible(b: boolean): unknown; setEnabled(b: boolean): unknown }>;

	/** Boutons de persistance backend (chargement / enregistrement du croquis). */
	private _loadCroquisButton!: Button;
	private _saveCroquisButton!: Button;

	private _bgImage!: HTMLImageElement | null;
	private _bgRect!: Rect | null;
	private _fileInput!: HTMLInputElement | null;
	private _projectInput!: HTMLInputElement | null;
	private _cameraDialog!: Dialog | null;
	private _cameraStream!: MediaStream | null;
	private _boundFileChange!: () => void;
	private _boundProjectChange!: () => void;

	/* =========================================================== */
	/* méthodes de cycle de vie                                    */
	/* =========================================================== */

	public init(): void {
		this._state = {
			mode: "draw",
			strokeColor: "#0d47a1",
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
		this._undoStack = [];
		this._redoStack = [];
		this._pendingDragHistory = false;
		this._boundCanvas = null;
		this._windowBound = false;
		this._croquisAutoLoaded = false;
		this._retrySetupTimer = null;
		this._resizeObserver = null;
		this._container = null;
		this._canvas = null;
		this._ctx = null;
		this._colorPopover = null;
		this._bgImage = null;
		this._bgRect = null;
		this._fileInput = null;
		this._projectInput = null;
		this._cameraDialog = null;
		this._cameraStream = null;
		this._boundFileChange = this._onFileInputChange.bind(this);
		this._boundProjectChange = this._onProjectInputChange.bind(this);
		this._boundHandlers = {
			onPointerDown: this._onPointerDown.bind(this),
			onPointerMove: this._onPointerMove.bind(this),
			onPointerUp: this._onPointerUp.bind(this),
			onWheel: this._onWheel.bind(this),
			onResize: this._resizeCanvas.bind(this),
			onKeyDown: this._onKeyDown.bind(this),
			onDragOver: this._onDragOver.bind(this),
			onDragLeave: this._onDragLeave.bind(this),
			onDrop: this._onDrop.bind(this)
		};

		this._bundle = Core.getLibraryResourceBundle("zab.be.resa.draw") as ResourceBundle;
		this._createFileInput();
		this._createProjectInput();
		this._buildToolbar();
		this._applyEditable();
		this._applyMode();
	}

	public onAfterRendering(): void {
		this._setupCanvas();
		if (this._retrySetupTimer) {
			window.clearTimeout(this._retrySetupTimer);
		}
		this._retrySetupTimer = window.setTimeout(this._setupCanvas.bind(this), 0);
		this._updatePhotoHint();
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
		this._stopCameraStream();
		if (this._cameraDialog) {
			this._cameraDialog.destroy();
			this._cameraDialog = null;
		}
		if (this._colorPopover) {
			this._colorPopover.destroy();
			this._colorPopover = null;
		}
		if (this._fileInput) {
			this._fileInput.removeEventListener("change", this._boundFileChange);
			if (this._fileInput.parentNode) {
				this._fileInput.parentNode.removeChild(this._fileInput);
			}
			this._fileInput = null;
		}
		if (this._projectInput) {
			this._projectInput.removeEventListener("change", this._boundProjectChange);
			if (this._projectInput.parentNode) {
				this._projectInput.parentNode.removeChild(this._projectInput);
			}
			this._projectInput = null;
		}
	}

	/**
	 * Bascule l'état éditable : (dés)active la barre d'outils sans re-rendu.
	 */
	public setEditable(bEditable: boolean): this {
		this.setProperty("editable", bEditable, true);
		this._applyEditable();
		this._applyMode();
		return this;
	}

	/* =========================================================== */
	/* construction de la barre d'outils                           */
	/* =========================================================== */

	private _getText(sTextId: string): string {
		return this._bundle.getText(sTextId) ?? sTextId;
	}

	/** Texte de l'invite « ajouter une photo » (utilisé par le renderer). */
	public getPhotoHintText(): string {
		return this._getText("addPhotoFirst");
	}

	private _buildToolbar(): void {
		// Bascule de mode : dessin libre ou photo à annoter.
		this._modeSelector = new SegmentedButton({
			selectedKey: "draw",
			selectionChange: this._onModeChange.bind(this),
			items: [
				new SegmentedButtonItem({ key: "draw", icon: "sap-icon://grid", tooltip: this._getText("modeDraw") }),
				new SegmentedButtonItem({ key: "photo", icon: "sap-icon://picture", tooltip: this._getText("modePhoto") })
			]
		});

		this._toolSelector = new SegmentedButton({
			selectedKey: "pen",
			selectionChange: this._onToolChange.bind(this),
			items: [
				new SegmentedButtonItem({ key: "pen", icon: "sap-icon://edit", tooltip: this._getText("toolPen") }),
				new SegmentedButtonItem({ key: "line", icon: "sap-icon://border", tooltip: this._getText("toolLine") }),
				new SegmentedButtonItem({ key: "rect", icon: "sap-icon://draw-rectangle", tooltip: this._getText("toolRect") }),
				new SegmentedButtonItem({ key: "circle", icon: "sap-icon://circle-task-2", tooltip: this._getText("toolCircle") }),
				new SegmentedButtonItem({ key: "select", icon: "sap-icon://touch", tooltip: this._getText("toolSelect") }),
				new SegmentedButtonItem({ key: "pan", icon: "sap-icon://move", tooltip: this._getText("toolPan") })
			]
		});

		this._presetSelect = new Select({
			width: "9rem",
			selectedKey: "route",
			items: [
				new Item({ key: "route", text: this._getText("presetRoute") }),
				new Item({ key: "car", text: this._getText("presetCar") }),
				new Item({ key: "tree", text: this._getText("presetTree") }),
				new Item({ key: "cross", text: this._getText("presetCross") }),
				new Item({ key: "house", text: this._getText("presetHouse") })
			]
		});

		this._zoomSlider = new Slider({
			width: "9rem",
			min: 0.25,
			max: 4,
			step: 0.05,
			value: 1,
			liveChange: this._onZoomSliderChange.bind(this)
		});

		const oUploadButton = new Button({ icon: "sap-icon://upload", tooltip: this._getText("uploadPhoto"), press: this._onUploadButtonPress.bind(this) });
		const oCameraButton = new Button({ icon: "sap-icon://camera", tooltip: this._getText("useCamera"), press: this._onCameraButtonPress.bind(this) });
		this._colorButton = new Button({ icon: "sap-icon://palette", tooltip: this._getText("pickColor"), press: this._openColorPopover.bind(this) });
		const oInsertButton = new Button({ icon: "sap-icon://add", tooltip: this._getText("insertObject"), press: this._onInsertPresetButtonPress.bind(this) });
		const oTextButton = new Button({ icon: "sap-icon://text", tooltip: this._getText("insertText"), press: this._onInsertTextButtonPress.bind(this) });
		const oResetButton = new Button({ icon: "sap-icon://restart", tooltip: this._getText("resetView"), press: this._onResetView.bind(this) });
		const oUndoButton = new Button({ icon: "sap-icon://undo", tooltip: this._getText("undo"), press: this._onUndo.bind(this) });
		const oRedoButton = new Button({ icon: "sap-icon://redo", tooltip: this._getText("redo"), press: this._onRedo.bind(this) });
		const oSmallerButton = new Button({ icon: "sap-icon://exit-full-screen", tooltip: this._getText("decreaseSize"), press: this._onSmallerButtonPress.bind(this) });
		const oLargerButton = new Button({ icon: "sap-icon://full-screen", tooltip: this._getText("increaseSize"), press: this._onLargerButtonPress.bind(this) });
		const oRotateLeftButton = new Button({ icon: "sap-icon://response", tooltip: this._getText("rotateLeft"), press: this._onRotateLeftPress.bind(this) });
		const oRotateRightButton = new Button({ icon: "sap-icon://shortcut", tooltip: this._getText("rotateRight"), press: this._onRotateRightPress.bind(this) });
		const oDeleteButton = new Button({ icon: "sap-icon://delete", tooltip: this._getText("deleteSelection"), type: "Reject", press: this._onDeleteSelection.bind(this) });
		const oClearButton = new Button({ icon: "sap-icon://eraser", tooltip: this._getText("clear"), type: "Reject", press: this._onClear.bind(this) });
		const oOpenButton = new Button({ icon: "sap-icon://open-folder", tooltip: this._getText("openProject"), press: this._onOpenProjectButtonPress.bind(this) });
		const oDownloadButton = new Button({ icon: "sap-icon://download", tooltip: this._getText("downloadProject"), type: "Emphasized", press: this._onDownloadProject.bind(this) });

		// Persistance backend : charger le croquis existant depuis l'opération, ou
		// enregistrer le croquis courant comme pièce jointe de l'opération.
		this._loadCroquisButton = new Button({ icon: "sap-icon://cloud", tooltip: this._getText("loadCroquis"), press: () => { void this._onLoadCroquis(); } });
		this._saveCroquisButton = new Button({ icon: "sap-icon://save", tooltip: this._getText("saveCroquis"), type: "Emphasized", press: () => { void this._onSaveCroquis(); } });

		// Barre d'outils à retour à la ligne : un FlexBox « Wrap » place tous les
		// contrôles sur une seule ligne tant que la largeur le permet, puis les fait
		// déborder sur une 2e (puis 3e…) ligne dès qu'il n'y a plus assez de place.
		const oToolbar = new FlexBox({
			wrap: "Wrap",
			alignItems: "Center",
			width: "100%",
			items: [
				new Title({ text: this._getText("toolsTitle") }),
				this._modeSelector,
				oUploadButton,
				oCameraButton,
				this._toolSelector,
				this._colorButton,
				new Label({ text: this._getText("objectsLabel") }),
				this._presetSelect,
				oInsertButton,
				oTextButton,
				new Label({ text: this._getText("zoomLabel") }),
				this._zoomSlider,
				oResetButton,
				oUndoButton,
				oRedoButton,
				oSmallerButton,
				oLargerButton,
				oRotateLeftButton,
				oRotateRightButton,
				oDeleteButton,
				oClearButton,
				oOpenButton,
				oDownloadButton,
				this._loadCroquisButton,
				this._saveCroquisButton
			]
		});
		oToolbar.addStyleClass("dbToolbar");

		// Contrôles liés au dessin : (dés)activés selon le mode et la présence d'une photo.
		this._drawingControls = [
			this._toolSelector,
			this._colorButton,
			this._presetSelect,
			oInsertButton,
			oTextButton,
			oUndoButton,
			oRedoButton,
			oSmallerButton,
			oLargerButton,
			oRotateLeftButton,
			oRotateRightButton,
			oDeleteButton
		];

		// Contrôles liés à la photo : visibles uniquement en mode photo.
		this._photoControls = [
			oUploadButton,
			oCameraButton
		];

		this._interactiveControls = [
			this._modeSelector,
			this._toolSelector,
			this._colorButton,
			this._presetSelect,
			this._zoomSlider,
			oUploadButton,
			oCameraButton,
			oInsertButton,
			oTextButton,
			oResetButton,
			oUndoButton,
			oRedoButton,
			oSmallerButton,
			oLargerButton,
			oRotateLeftButton,
			oRotateRightButton,
			oDeleteButton,
			oClearButton,
			oOpenButton,
			oDownloadButton
		];

		this.setAggregation("_toolbar", oToolbar);
	}

	/**
	 * Applique la visibilité / l'activation des contrôles selon le mode courant.
	 * En mode photo, les outils de dessin restent désactivés tant qu'aucune photo
	 * n'a été ajoutée : l'utilisateur doit d'abord téléverser ou capturer une image.
	 */
	private _applyMode(): void {
		if (!this._modeSelector) {
			return;
		}
		const bPhoto = this._state.mode === "photo";
		const bEditable = this.getProperty("editable") as boolean;

		this._photoControls.forEach((oControl) => {
			oControl.setVisible(bPhoto);
			oControl.setEnabled(bEditable);
		});

		const bDrawingEnabled = bEditable && (!bPhoto || !!this._bgImage);
		this._drawingControls.forEach((oControl) => {
			oControl.setEnabled(bDrawingEnabled);
		});

		this._updatePhotoHint();
	}

	/** Affiche/masque l'invite « ajouter une photo » posée par le renderer. */
	private _updatePhotoHint(): void {
		const oHost = this.getDomRef();
		if (!oHost) {
			return;
		}
		const oHint = oHost.querySelector(".db-photo-hint") as HTMLElement | null;
		if (!oHint) {
			return;
		}
		const bShow = this._state.mode === "photo" && !this._bgImage;
		oHint.style.display = bShow ? "flex" : "none";
	}

	private _applyEditable(): void {
		if (!this._interactiveControls) {
			return;
		}
		const bEditable = this.getProperty("editable") as boolean;
		this._interactiveControls.forEach((oControl) => {
			oControl.setEnabled(bEditable);
		});
		this._applyBackendState();
	}

	/* =========================================================== */
	/* persistance backend (pièces jointes de l'opération)         */
	/* =========================================================== */

	public setOtype(sValue: string): this {
		this.setProperty("otype", sValue, true);
		this._applyBackendState();
		this._maybeAutoLoadCroquis();
		return this;
	}

	public setObjid(sValue: string): this {
		this.setProperty("objid", sValue, true);
		this._applyBackendState();
		this._maybeAutoLoadCroquis();
		return this;
	}

	/**
	 * API publique : déclenche l'enregistrement du croquis dans l'opération,
	 * exactement comme le bouton « Enregistrer ». Un hôte peut l'appeler lui-même
	 * (p. ex. à la fermeture d'une popup, avant que l'utilisateur ne quitte sans
	 * enregistrer). Renvoie la promesse de l'opération réseau.
	 */
	public saveCroquis(): Promise<void> {
		return this._onSaveCroquis();
	}

	/** API publique : (re)charge le croquis de l'opération depuis le backend. */
	public loadCroquis(): Promise<void> {
		return this._onLoadCroquis();
	}

	/**
	 * Tente, une seule fois, un chargement automatique du croquis dès que le tableau
	 * est monté et que le contexte backend (Otype + Objid) est disponible : « quand
	 * la bibliothèque est chargée, on essaie de charger le croquis ». Silencieux si
	 * aucun croquis n'existe encore pour l'opération.
	 */
	private _maybeAutoLoadCroquis(): void {
		if (this._croquisAutoLoaded || !this._canvas || !this._hasBackendContext()) {
			return;
		}
		this._croquisAutoLoaded = true;
		void this._onLoadCroquis(true);
	}

	/** Vrai si le contrôle dispose du contexte (Otype + Objid) pour joindre l'opération. */
	private _hasBackendContext(): boolean {
		return !!(this.getProperty("otype") && this.getProperty("objid"));
	}

	/** (Dés)active les boutons de persistance selon l'édition et le contexte backend. */
	private _applyBackendState(): void {
		if (!this._loadCroquisButton || !this._saveCroquisButton) {
			return;
		}
		const bEnabled = (this.getProperty("editable") as boolean) && this._hasBackendContext();
		this._loadCroquisButton.setEnabled(bEnabled);
		this._saveCroquisButton.setEnabled(bEnabled);
	}

	/** URL de base du service, sans barre oblique finale. */
	private _getServiceBase(): string {
		return (this.getProperty("serviceUrl") as string).replace(/\/+$/, "");
	}

	/**
	 * Ramène une URL renvoyée par le backend (ex. `Url` d'une pièce jointe, absolue
	 * `/sap/...` ou `http(s)://hôte/sap/...`) sous le même préfixe que `serviceUrl`.
	 * Sur SAP BTP / Work Zone, le backend n'est joignable qu'au travers de la route
	 * `/sap` de l'application (ex. `/<service>.<app>/sap/...`) ; sur ABAP, le
	 * préfixe est vide et l'URL est inchangée.
	 */
	private _toServiceRelativeUrl(sUrl: string): string {
		const sBase = this._getServiceBase();
		const iBaseSap = sBase.indexOf("/sap/");
		const iUrlSap = sUrl.indexOf("/sap/");
		if (iBaseSap < 0 || iUrlSap < 0) {
			return sUrl;
		}
		return sBase.substring(0, iBaseSap) + sUrl.substring(iUrlSap);
	}

	/**
	 * Nom du fichier croquis : `<objid>-croquis.png`. Déterministe (pas d'horodatage)
	 * car il n'existe qu'une seule version du croquis par objet (numéro d'avis).
	 */
	private _croquisFileName(): string {
		return (this.getProperty("objid") as string) + "-croquis.png";
	}

	/** Récupère un jeton XSRF frais auprès du service OData. */
	private async _fetchCsrfToken(): Promise<string> {
		const oResp = await fetch(this._getServiceBase() + "/", {
			method: "GET",
			headers: { "x-csrf-token": "Fetch", "Accept": "application/json" },
			credentials: "same-origin"
		});
		return oResp.headers.get("x-csrf-token") || "";
	}

	/** Extrait un message d'erreur lisible (statut HTTP + message serveur SAP). */
	private async _httpErrorText(oResp: Response): Promise<string> {
		let sBody = "";
		try {
			sBody = await oResp.text();
		} catch (oError) {
			sBody = "";
		}
		const oMatch = /<message[^>]*>([^<]+)<\/message>/i.exec(sBody)
			|| /"message"\s*:\s*(?:\{[^}]*"value"\s*:\s*)?"([^"]+)"/i.exec(sBody);
		const sMsg = oMatch ? oMatch[1] : (sBody.substring(0, 300) || oResp.statusText);
		return oResp.status + " " + sMsg;
	}

	/**
	 * Lit les pièces jointes « croquis » (PNG) déjà attachées à l'objet courant.
	 * Renvoie la liste (Attid / Url / Fname) triée du plus récent au plus ancien.
	 */
	private async _readCroquisAttachments(): Promise<Array<{ Fname: string; Url: string; Attid: string }>> {
		const sHeadUrl = this._getServiceBase()
			+ "/zv_ca_c_ui5f_atta_head(Otype='" + encodeURIComponent(this.getProperty("otype") as string)
			+ "',Objid='" + encodeURIComponent(this.getProperty("objid") as string) + "')"
			+ "?$expand=to_Attachment&$format=json";
		const oResp = await fetch(sHeadUrl, { headers: { "Accept": "application/json" }, credentials: "same-origin" });
		if (!oResp.ok) {
			throw new Error(await this._httpErrorText(oResp));
		}
		const oJson = await oResp.json() as {
			d?: { to_Attachment?: { results?: Array<{ Fname: string; Url: string; Attid: string }> } };
		};
		const aResults = (oJson.d && oJson.d.to_Attachment && oJson.d.to_Attachment.results) || [];
		return aResults
			.filter((oAtt) => /croquis/i.test(oAtt.Fname) && /\.png$/i.test(oAtt.Fname))
			.sort((a, b) => parseInt(b.Attid, 10) - parseInt(a.Attid, 10));
	}

	/** Supprime une pièce jointe croquis par sa clé (Otype/Objid/Attid). */
	private async _deleteCroquis(sAttid: string, sToken: string): Promise<void> {
		const sUrl = this._getServiceBase()
			+ "/zv_ca_c_ui5f_atta_info(Otype='" + encodeURIComponent(this.getProperty("otype") as string)
			+ "',Objid='" + encodeURIComponent(this.getProperty("objid") as string)
			+ "',Attid='" + encodeURIComponent(sAttid) + "')";
		await fetch(sUrl, {
			method: "DELETE",
			headers: { "x-csrf-token": sToken },
			credentials: "same-origin"
		});
	}

	/**
	 * Enregistre le croquis courant comme pièce jointe : construit le PNG composite
	 * (photo + tracés) avec le projet ré-éditable intégré. Comme il n'existe qu'une
	 * version du croquis, on supprime d'abord l'éventuel croquis existant, puis on
	 * POST le nouveau vers le service de pièces jointes.
	 */
	private async _onSaveCroquis(): Promise<void> {
		if (!this._hasBackendContext()) {
			MessageToast.show(this._getText("backendContextMissing"));
			return;
		}
		const aBytes = this._buildCroquisPngBytes();
		if (!aBytes) {
			return;
		}
		try {
			const sToken = await this._fetchCsrfToken();

			// Version unique : purge des croquis précédents avant le nouvel envoi.
			const aExisting = await this._readCroquisAttachments();
			for (const oAtt of aExisting) {
				await this._deleteCroquis(oAtt.Attid, sToken);
			}

			const sSlug = this.getProperty("otype") + "&&" + this.getProperty("objid") + "&&" + this._croquisFileName();
			const oResp = await fetch(this._getServiceBase() + "/zv_ca_c_ui5f_atta_info", {
				method: "POST",
				headers: { "x-csrf-token": sToken, "slug": sSlug, "Content-Type": "image/png" },
				body: new Blob([new Uint8Array(aBytes)], { type: "image/png" }),
				credentials: "same-origin"
			});
			if (!oResp.ok) {
				MessageToast.show(this._getText("saveCroquisError") + " : " + await this._httpErrorText(oResp));
				return;
			}
			MessageToast.show(this._getText("saveCroquisSuccess"));
		} catch (oError) {
			MessageToast.show(this._getText("saveCroquisError") + " : " + (oError instanceof Error ? oError.message : String(oError)));
		}
	}

	/**
	 * Récupère le croquis (PNG) joint à l'objet et l'ouvre dans le tableau pour
	 * poursuivre l'édition. Le projet ré-éditable est restauré depuis le chunk PNG.
	 */
	private async _onLoadCroquis(bAuto = false): Promise<void> {
		if (!this._hasBackendContext()) {
			if (!bAuto) {
				MessageToast.show(this._getText("backendContextMissing"));
			}
			return;
		}
		try {
			const aCroquis = await this._readCroquisAttachments();
			if (aCroquis.length === 0) {
				// Chargement automatique silencieux : ne pas alerter s'il n'y a pas
				// encore de croquis pour l'opération.
				if (!bAuto) {
					MessageToast.show(this._getText("noCroquisFound"));
				}
				return;
			}
			const oFileResp = await fetch(this._toServiceRelativeUrl(aCroquis[0].Url), { credentials: "same-origin" });
			if (!oFileResp.ok) {
				MessageToast.show(this._getText("loadCroquisError") + " : " + await this._httpErrorText(oFileResp));
				return;
			}
			const aBytes = new Uint8Array(await oFileResp.arrayBuffer());
			this._loadProjectFromPngBytes(aBytes);
		} catch (oError) {
			MessageToast.show(this._getText("loadCroquisError") + " : " + (oError instanceof Error ? oError.message : String(oError)));
		}
	}

	/* =========================================================== */
	/* gestionnaires d'événements                                  */
	/* =========================================================== */

	private _onToolChange(oEvent: SegmentedButton$SelectionChangeEvent): void {
		const oItem = oEvent.getParameter("item") as SegmentedButtonItem;
		this._state.tool = oItem.getKey();
		this._state.selectedShapeId = null;
		this._render();
	}

	private _onModeChange(oEvent: SegmentedButton$SelectionChangeEvent): void {
		const oItem = oEvent.getParameter("item") as SegmentedButtonItem;
		const sMode = oItem.getKey() as DrawMode;
		this._state.mode = sMode;

		// Le travail en cours est conservé lors d'un changement de mode : les formes
		// sont en coordonnées monde (indépendantes du mode), donc basculer dessin ⇄
		// photo n'efface plus ni les tracés, ni la photo, ni l'historique. Seule la
		// couleur de trait par défaut s'adapte au mode.
		this._state.strokeColor = sMode === "photo" ? "#ffffff" : "#0d47a1";
		if (this._colorPopover) {
			this._colorPopover.setDefaultColor(this._state.strokeColor);
		}

		this._applyMode();
		this._render();
	}

	/** Vide dessins, brouillon, historique et photo de fond. */
	private _resetCanvasState(): void {
		this._state.shapes = [];
		this._undoStack = [];
		this._redoStack = [];
		this._state.draft = null;
		this._state.selectedShapeId = null;
		this._bgImage = null;
		this._bgRect = null;
	}

	private _openColorPopover(): void {
		if (!this._colorPopover) {
			this._colorPopover = new ColorPalettePopover({
				defaultColor: this._state.strokeColor,
				colorSelect: (oEvent: ColorPalettePopover$ColorSelectEvent) => {
					const sValue = oEvent.getParameter("value") as string;
					if (sValue) {
						this._state.strokeColor = sValue;
						// Recolorer la sélection courante (dessins déjà tracés), en plus
						// de fixer la couleur des prochains tracés.
						this._applyColorToSelection(sValue);
					}
				}
			});
			this.addDependent(this._colorPopover);
		}
		this._colorPopover.setDefaultColor(this._state.strokeColor);
		// openBy existe à l'exécution mais manque dans les typings 1.90.
		(this._colorPopover as unknown as { openBy(oControl: Button): void }).openBy(this._colorButton);
	}

	/** Applique une couleur de trait à la forme (ou au groupe) sélectionnée. */
	private _applyColorToSelection(sColor: string): void {
		const sSelectionId = this._state.selectedShapeId;
		if (!sSelectionId) {
			return;
		}
		const aTargets = this._getShapesForSelection(sSelectionId);
		if (aTargets.length === 0) {
			return;
		}
		this._pushHistory();
		aTargets.forEach((oShape) => {
			oShape.stroke = sColor;
		});
		this._render();
	}

	private _onZoomSliderChange(oEvent: Slider$LiveChangeEvent): void {
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
		this._zoomSlider.setValue(1, {});
		this._render();
	}

	/**
	 * Enregistre un instantané de l'état courant AVANT une opération modifiante
	 * (tracé, insertion, déplacement, redimensionnement, rotation, couleur,
	 * suppression, effacement). Chaque appel constitue une étape annulable.
	 */
	private _pushHistory(): void {
		this._undoStack.push(this._cloneShapesList(this._state.shapes));
		// Limiter la profondeur de l'historique pour borner la mémoire.
		if (this._undoStack.length > 100) {
			this._undoStack.shift();
		}
		// Toute nouvelle opération invalide le chemin de rétablissement.
		this._redoStack = [];
	}

	private _cloneShapesList(aShapes: Shape[]): Shape[] {
		return aShapes.map((oShape) => this._cloneShape(oShape));
	}

	/** Recale la sélection si la forme sélectionnée n'existe plus. */
	private _ensureSelectionValid(): void {
		const sId = this._state.selectedShapeId;
		if (!sId) {
			return;
		}
		const bStillThere = this._state.shapes.some((oShape) => this._isShapeMatchSelection(oShape, sId));
		if (!bStillThere) {
			this._state.selectedShapeId = null;
		}
	}

	private _onUndo(): void {
		if (this._undoStack.length === 0) {
			return;
		}
		this._redoStack.push(this._cloneShapesList(this._state.shapes));
		this._state.shapes = this._undoStack.pop() as Shape[];
		this._state.draft = null;
		this._ensureSelectionValid();
		this._render();
	}

	private _onRedo(): void {
		if (this._redoStack.length === 0) {
			return;
		}
		this._undoStack.push(this._cloneShapesList(this._state.shapes));
		this._state.shapes = this._redoStack.pop() as Shape[];
		this._state.draft = null;
		this._ensureSelectionValid();
		this._render();
	}

	private _onSmallerButtonPress(): void {
		this._scaleSelectedShape(0.9);
	}

	private _onLargerButtonPress(): void {
		this._scaleSelectedShape(1.1);
	}

	private _onRotateLeftPress(): void {
		this._rotateSelectedShape(-Math.PI / 12);
	}

	private _onRotateRightPress(): void {
		this._rotateSelectedShape(Math.PI / 12);
	}

	private _onInsertPresetButtonPress(): void {
		if (!this._canvas) {
			return;
		}

		const sPreset = this._presetSelect.getSelectedKey() || "route";
		const oCenterScreen: Point = {
			x: this._canvas.clientWidth / 2,
			y: this._canvas.clientHeight / 2
		};
		const oCenterWorld = this._screenToWorld(oCenterScreen);
		const sGroupId = "g-" + (this._groupIdCounter++);
		const aPresetShapes = this._createPresetShapes(sPreset, oCenterWorld, sGroupId);
		this._pushHistory();
		this._state.shapes.push.apply(this._state.shapes, aPresetShapes);
		this._state.selectedShapeId = sGroupId;
		this._render();
	}

	/* =========================================================== */
	/* objet texte (zone de texte)                                 */
	/* =========================================================== */

	private _onInsertTextButtonPress(): void {
		this._promptForText("", (sText) => this._insertTextObject(sText));
	}

	/** Ouvre un dialogue de saisie et invoque le rappel avec le texte non vide. */
	private _promptForText(sInitial: string, fnConfirm: (sText: string) => void): void {
		const oInput = new Input({
			value: sInitial,
			width: "100%",
			placeholder: this._getText("textPlaceholder")
		});

		const oDialog = new Dialog({
			title: this._getText("textDialogTitle"),
			contentWidth: "24rem",
			content: [oInput],
			beginButton: new Button({
				text: this._getText("ok"),
				type: "Emphasized",
				press: () => {
					const sValue = (oInput.getValue() || "").trim();
					oDialog.close();
					if (sValue) {
						fnConfirm(sValue);
					}
				}
			}),
			endButton: new Button({
				text: this._getText("cancel"),
				press: () => oDialog.close()
			}),
			afterClose: () => oDialog.destroy()
		});

		this.addDependent(oDialog);
		oDialog.open();
	}

	/** Crée et place un objet texte au centre de la vue. */
	private _insertTextObject(sText: string): void {
		if (!this._canvas) {
			return;
		}
		const fFontSize = 24;
		const oCenterScreen: Point = {
			x: this._canvas.clientWidth / 2,
			y: this._canvas.clientHeight / 2
		};
		const oCenterWorld = this._screenToWorld(oCenterScreen);

		const oShape: TextShape = {
			id: String(this._shapeIdCounter++),
			stroke: this._state.strokeColor,
			lineWidth: 1,
			type: "text",
			// Centrer approximativement le texte sur le point central.
			x: oCenterWorld.x - (sText.length * fFontSize * 0.55) / 2,
			y: oCenterWorld.y - fFontSize / 2,
			text: sText,
			fontSize: fFontSize
		};

		this._pushHistory();
		this._state.shapes.push(oShape);
		this._state.selectedShapeId = oShape.id;
		this._render();
	}

	private _onClear(): void {
		const bHasShapes = this._state.shapes.length > 0;
		const bHasPhoto = !!(this._bgImage && this._bgRect);
		if (!bHasShapes && !bHasPhoto) {
			return;
		}
		// Une photo est présente : demander si l'effacement doit aussi la retirer,
		// ou ne toucher qu'aux tracés.
		if (bHasPhoto) {
			this._confirmClearWithPhoto(bHasShapes);
			return;
		}
		// Aucune photo : effacer directement les tracés.
		this._applyClear(false);
	}

	/** Dialogue de choix : effacer les tracés seuls, ou les tracés ET la photo. */
	private _confirmClearWithPhoto(bHasShapes: boolean): void {
		const oDialog = new Dialog({
			title: this._getText("clearDialogTitle"),
			type: "Message",
			content: [new Text({ text: this._getText("clearDialogMessage") })],
			buttons: [
				new Button({
					text: this._getText("clearDrawingsOnly"),
					// Rien à effacer côté tracés : proposer seulement le retrait photo.
					enabled: bHasShapes,
					press: () => { oDialog.close(); this._applyClear(false); }
				}),
				new Button({
					text: this._getText("clearAllWithPhoto"),
					type: "Reject",
					press: () => { oDialog.close(); this._applyClear(true); }
				}),
				new Button({
					text: this._getText("cancel"),
					press: () => oDialog.close()
				})
			],
			afterClose: () => oDialog.destroy()
		});
		this.addDependent(oDialog);
		oDialog.open();
	}

	/** Efface les tracés (et, si demandé, la photo de fond), puis repeint. */
	private _applyClear(bAlsoPhoto: boolean): void {
		this._pushHistory();
		this._state.shapes = [];
		this._state.draft = null;
		this._state.selectedShapeId = null;
		if (bAlsoPhoto) {
			// Note : l'historique ne mémorise que les tracés ; le retrait de la photo
			// n'est donc pas annulable (Annuler restaure les tracés, pas la photo).
			this._bgImage = null;
			this._bgRect = null;
			this._applyMode();
		}
		this._render();
		MessageToast.show(this._getText("canvasCleared"));
	}

	/** Supprime la forme (ou le groupe) actuellement sélectionnée. */
	private _onDeleteSelection(): void {
		const sSelectionId = this._state.selectedShapeId;
		if (!sSelectionId) {
			this._showSelectObjectMessage();
			return;
		}

		const aRemaining = this._state.shapes.filter((oShape) => {
			return !this._isShapeMatchSelection(oShape, sSelectionId);
		});

		if (aRemaining.length === this._state.shapes.length) {
			this._showSelectObjectMessage();
			return;
		}

		this._pushHistory();
		this._state.shapes = aRemaining;
		this._state.selectedShapeId = null;
		this._render();
		MessageToast.show(this._getText("selectionDeleted"));
	}

	/* =========================================================== */
	/* projet : téléchargement (PNG + coordonnées) / ouverture     */
	/* =========================================================== */

	/**
	 * Télécharge un PNG unique : les pixels montrent le rendu composite
	 * (photo + tracés), et un chunk `tEXt` caché contient le projet ré-éditable
	 * (image d'origine + lignes en coordonnées pixel de l'image).
	 */
	/**
	 * Construit les octets du PNG composite (photo + tracés) avec le projet
	 * ré-éditable intégré dans un chunk `tEXt`. Renvoie `null` si le canevas ne
	 * peut être exporté (image externe « tainted »).
	 */
	private _buildCroquisPngBytes(): Uint8Array | null {
		const oComposite = this._buildCompositeCanvas();
		if (!oComposite) {
			return null;
		}

		let sPngDataUrl: string;
		try {
			sPngDataUrl = oComposite.toDataURL("image/png");
		} catch (oError) {
			// Canevas « tainted » (image d'origine chargée depuis une URL externe
			// sans CORS) : impossible d'exporter les pixels.
			MessageToast.show(this._getText("exportTaintError"));
			return null;
		}

		const oProject = this._serializeProject(oComposite.width, oComposite.height);
		const sBase64 = encodeUtf8ToBase64(JSON.stringify(oProject));

		let aPngBytes = this._dataUrlToBytes(sPngDataUrl);
		try {
			aPngBytes = insertTextChunk(aPngBytes, PROJECT_CHUNK_KEYWORD, sBase64);
		} catch (oError) {
			// À défaut, on laisse le PNG sans métadonnées plutôt que d'échouer.
		}
		return aPngBytes;
	}

	private _onDownloadProject(): void {
		const aPngBytes = this._buildCroquisPngBytes();
		if (!aPngBytes) {
			return;
		}

		// Copie sur un ArrayBuffer concret (les typings récents refusent ArrayBufferLike).
		const oBlob = new Blob([new Uint8Array(aPngBytes)], { type: "image/png" });
		const sObjectUrl = URL.createObjectURL(oBlob);
		this._triggerDownload(sObjectUrl, "dessin-" + this._fileTimestamp() + ".png");
		window.setTimeout(() => {
			URL.revokeObjectURL(sObjectUrl);
		}, 1000);
		MessageToast.show(this._getText("downloadSuccess"));
	}

	private _fileTimestamp(): string {
		return new Date().toISOString().replace(/[:.]/g, "-");
	}

	private _triggerDownload(sUrl: string, sName: string): void {
		const oLink = document.createElement("a");
		oLink.href = sUrl;
		oLink.download = sName;
		document.body.appendChild(oLink);
		oLink.click();
		document.body.removeChild(oLink);
	}

	private _dataUrlToBytes(sDataUrl: string): Uint8Array {
		const iComma = sDataUrl.indexOf(",");
		const sBinary = atob(sDataUrl.substring(iComma + 1));
		const aBytes = new Uint8Array(sBinary.length);
		for (let i = 0; i < sBinary.length; i += 1) {
			aBytes[i] = sBinary.charCodeAt(i);
		}
		return aBytes;
	}

	/* ---- sérialisation & coordonnées ---- */

	/** Facteur d'échelle : pixels image par unité monde (uniforme). */
	private _imageScale(): number {
		if (!this._bgImage || !this._bgRect) {
			return 1;
		}
		return this._bgImage.naturalWidth / this._bgRect.w;
	}

	private _worldToImagePoint(oPoint: Point): Point {
		const oRect = this._bgRect as Rect;
		const oImg = this._bgImage as HTMLImageElement;
		return {
			x: (oPoint.x - oRect.x) / oRect.w * oImg.naturalWidth,
			y: (oPoint.y - oRect.y) / oRect.h * oImg.naturalHeight
		};
	}

	private _imageToWorldPoint(oPoint: Point): Point {
		const oRect = this._bgRect as Rect;
		const oImg = this._bgImage as HTMLImageElement;
		return {
			x: oRect.x + (oPoint.x / oImg.naturalWidth) * oRect.w,
			y: oRect.y + (oPoint.y / oImg.naturalHeight) * oRect.h
		};
	}

	/** Convertit une forme entre l'espace monde et l'espace pixel de l'image. */
	private _convertShape(oShape: Shape, bToImage: boolean): Shape {
		const fScale = bToImage ? this._imageScale() : 1 / this._imageScale();
		const fnPoint = bToImage ? this._worldToImagePoint.bind(this) : this._imageToWorldPoint.bind(this);
		const oBase = {
			id: oShape.id,
			stroke: oShape.stroke,
			lineWidth: (oShape.lineWidth || 2) * fScale,
			groupId: oShape.groupId
		};

		if (oShape.type === "pen") {
			return { ...oBase, type: "pen", points: oShape.points.map((oPt) => fnPoint(oPt)) };
		}
		if (oShape.type === "circle") {
			const oCenter = fnPoint({ x: oShape.cx, y: oShape.cy });
			return { ...oBase, type: "circle", cx: oCenter.x, cy: oCenter.y, r: oShape.r * fScale };
		}
		if (oShape.type === "text") {
			const oPos = fnPoint({ x: oShape.x, y: oShape.y });
			return { ...oBase, type: "text", x: oPos.x, y: oPos.y, text: oShape.text, fontSize: oShape.fontSize * fScale };
		}
		// line & rect partagent x1/y1/x2/y2.
		const oP1 = fnPoint({ x: oShape.x1, y: oShape.y1 });
		const oP2 = fnPoint({ x: oShape.x2, y: oShape.y2 });
		return { ...oBase, type: oShape.type, x1: oP1.x, y1: oP1.y, x2: oP2.x, y2: oP2.y };
	}

	private _cloneShape(oShape: Shape): Shape {
		return JSON.parse(JSON.stringify(oShape)) as Shape;
	}

	/** Construit l'objet projet sérialisable pour le PNG. */
	private _serializeProject(iWidth: number, iHeight: number): DrawProject {
		// La photo fait partie du croquis dès qu'elle existe en mémoire, même si la
		// vue est repassée sur le canevas (où elle est simplement masquée). On la
		// persiste donc indépendamment du mode courant, afin qu'un enregistrement
		// fait depuis le canevas ne « perde » pas la photo.
		const bHasImage = !!(this._bgImage && this._bgRect);
		const aShapes = this._state.shapes.map((oShape) => {
			return bHasImage ? this._convertShape(oShape, true) : this._cloneShape(oShape);
		});

		let oImage: ProjectImage | null = null;
		if (bHasImage) {
			const oImg = this._bgImage as HTMLImageElement;
			oImage = {
				dataUrl: this._imageToDataUrl(oImg),
				width: oImg.naturalWidth,
				height: oImg.naturalHeight
			};
		}

		return {
			type: "zab.be.resa.draw.project",
			version: 1,
			// Un croquis qui porte une photo se rouvre en mode photo pour que la photo
			// soit visible au rechargement (sinon le canevas la masquerait).
			mode: bHasImage ? "photo" : this._state.mode,
			strokeColor: this._state.strokeColor,
			coordinateSpace: bHasImage ? "image-pixels" : "world",
			width: iWidth,
			height: iHeight,
			image: oImage,
			shapes: aShapes,
			shapeIdCounter: this._shapeIdCounter,
			groupIdCounter: this._groupIdCounter
		};
	}

	/** Renvoie une Data URL de l'image (déjà une Data URL, ou re-rendue). */
	private _imageToDataUrl(oImg: HTMLImageElement): string {
		if (oImg.src.indexOf("data:") === 0) {
			return oImg.src;
		}
		try {
			const oCanvas = document.createElement("canvas");
			oCanvas.width = oImg.naturalWidth;
			oCanvas.height = oImg.naturalHeight;
			const oCtx = oCanvas.getContext("2d");
			if (oCtx) {
				oCtx.drawImage(oImg, 0, 0);
				return oCanvas.toDataURL("image/png");
			}
		} catch (oError) {
			// Image externe « tainted » : on retombe sur l'URL d'origine.
		}
		return oImg.src;
	}

	/* ---- composite ---- */

	/**
	 * Rend un canevas composite hors-écran : photo à sa résolution native +
	 * tracés (mode photo), ou tracés sur fond blanc en coordonnées monde à défaut.
	 */
	private _buildCompositeCanvas(): HTMLCanvasElement | null {
		// Le composite intègre la photo dès qu'elle existe (même si la vue est sur le
		// canevas, qui la masque) : l'enregistrement conserve toujours la photo.
		if (this._bgImage && this._bgRect) {
			const iW = this._bgImage.naturalWidth;
			const iH = this._bgImage.naturalHeight;
			const oCanvas = document.createElement("canvas");
			oCanvas.width = iW;
			oCanvas.height = iH;
			const oCtx = oCanvas.getContext("2d");
			if (!oCtx) {
				return null;
			}
			oCtx.drawImage(this._bgImage, 0, 0, iW, iH);
			this._state.shapes.forEach((oShape) => {
				this._paintShape(oCtx, this._convertShape(oShape, true));
			});
			return oCanvas;
		}

		const oRect = this._container ? this._container.getBoundingClientRect() : null;
		const iW = oRect ? Math.max(1, Math.floor(oRect.width)) : 800;
		const iH = oRect ? Math.max(1, Math.floor(oRect.height)) : 600;
		const oCanvas = document.createElement("canvas");
		oCanvas.width = iW;
		oCanvas.height = iH;
		const oCtx = oCanvas.getContext("2d");
		if (!oCtx) {
			return null;
		}
		oCtx.fillStyle = "#ffffff";
		oCtx.fillRect(0, 0, iW, iH);
		this._state.shapes.forEach((oShape) => {
			this._paintShape(oCtx, oShape);
		});
		return oCanvas;
	}

	/** Peint une forme sur un contexte donné, sans zoom (échelle 1:1). */
	private _paintShape(oCtx: CanvasRenderingContext2D, oShape: Shape): void {
		oCtx.save();
		oCtx.strokeStyle = oShape.stroke;
		oCtx.lineWidth = oShape.lineWidth || 2;
		oCtx.lineJoin = "round";
		oCtx.lineCap = "round";

		if (oShape.type === "line") {
			oCtx.beginPath();
			oCtx.moveTo(oShape.x1, oShape.y1);
			oCtx.lineTo(oShape.x2, oShape.y2);
			oCtx.stroke();
		} else if (oShape.type === "rect") {
			oCtx.strokeRect(oShape.x1, oShape.y1, oShape.x2 - oShape.x1, oShape.y2 - oShape.y1);
		} else if (oShape.type === "circle") {
			oCtx.beginPath();
			oCtx.arc(oShape.cx, oShape.cy, oShape.r, 0, Math.PI * 2);
			oCtx.stroke();
		} else if (oShape.type === "pen" && oShape.points.length > 1) {
			oCtx.beginPath();
			oCtx.moveTo(oShape.points[0].x, oShape.points[0].y);
			for (let i = 1; i < oShape.points.length; i += 1) {
				oCtx.lineTo(oShape.points[i].x, oShape.points[i].y);
			}
			oCtx.stroke();
		} else if (oShape.type === "text") {
			oCtx.fillStyle = oShape.stroke;
			oCtx.font = oShape.fontSize + "px sans-serif";
			oCtx.textBaseline = "top";
			oCtx.fillText(oShape.text, oShape.x, oShape.y);
		}
		oCtx.restore();
	}

	/* ---- ouverture d'un projet ---- */

	/** Crée l'élément <input type="file"> caché servant à ouvrir un projet. */
	private _createProjectInput(): void {
		const oInput = document.createElement("input");
		oInput.type = "file";
		oInput.accept = "image/png,application/json,.png,.json";
		oInput.style.display = "none";
		oInput.addEventListener("change", this._boundProjectChange);
		document.body.appendChild(oInput);
		this._projectInput = oInput;
	}

	private _onOpenProjectButtonPress(): void {
		if (!this._projectInput) {
			return;
		}
		this._projectInput.value = "";
		this._projectInput.click();
	}

	private _onProjectInputChange(): void {
		if (!this._projectInput || !this._projectInput.files || this._projectInput.files.length === 0) {
			return;
		}
		const oFile = this._projectInput.files[0];
		const bJson = oFile.type === "application/json" || /\.json$/i.test(oFile.name);

		if (bJson) {
			const oReader = new FileReader();
			oReader.onload = () => {
				this._parseAndLoadProjectJson(oReader.result as string);
			};
			oReader.onerror = () => MessageToast.show(this._getText("openError"));
			oReader.readAsText(oFile);
			return;
		}

		// PNG : chercher le chunk projet ; à défaut, charger comme simple image.
		const oReader = new FileReader();
		oReader.onload = () => {
			this._loadProjectFromPngBytes(new Uint8Array(oReader.result as ArrayBuffer));
		};
		oReader.onerror = () => MessageToast.show(this._getText("openError"));
		oReader.readAsArrayBuffer(oFile);
	}

	/**
	 * Charge un projet depuis les octets d'un PNG : restaure le projet ré-éditable
	 * s'il est présent dans le chunk `tEXt`, sinon ouvre l'image comme photo à annoter.
	 */
	private _loadProjectFromPngBytes(aBytes: Uint8Array): void {
		const sBase64 = readTextChunk(aBytes, PROJECT_CHUNK_KEYWORD);
		if (sBase64) {
			try {
				this._parseAndLoadProjectJson(decodeBase64ToUtf8(sBase64));
				return;
			} catch (oError) {
				MessageToast.show(this._getText("openError"));
				return;
			}
		}
		// Pas de métadonnées : on traite le PNG comme une photo à annoter.
		this._loadPlainImageAsPhoto(this._dataUrlFromBytes(aBytes, "image/png"));
	}

	private _dataUrlFromBytes(aBytes: Uint8Array, sMime: string): string {
		let sBinary = "";
		for (let i = 0; i < aBytes.length; i += 1) {
			sBinary += String.fromCharCode(aBytes[i]);
		}
		return "data:" + sMime + ";base64," + btoa(sBinary);
	}

	private _parseAndLoadProjectJson(sJson: string): void {
		let oProject: DrawProject;
		try {
			oProject = JSON.parse(sJson) as DrawProject;
		} catch (oError) {
			MessageToast.show(this._getText("openError"));
			return;
		}
		if (!oProject || oProject.type !== "zab.be.resa.draw.project") {
			MessageToast.show(this._getText("openInvalid"));
			return;
		}
		this._loadProject(oProject);
	}

	/** Charge une image simple (sans projet) comme photo à annoter. */
	private _loadPlainImageAsPhoto(sDataUrl: string): void {
		this._state.mode = "photo";
		this._modeSelector.setSelectedKey("photo");
		this._resetCanvasState();
		this._state.strokeColor = "#ffffff";
		this._resetView();
		this._loadImageFromUrl(sDataUrl);
	}

	/** Restaure l'état complet à partir d'un projet et repeint. */
	private _loadProject(oProject: DrawProject): void {
		this._state.mode = oProject.mode === "photo" ? "photo" : "draw";
		this._modeSelector.setSelectedKey(this._state.mode);
		this._state.strokeColor = oProject.strokeColor || (this._state.mode === "photo" ? "#ffffff" : "#0d47a1");
		this._shapeIdCounter = oProject.shapeIdCounter && oProject.shapeIdCounter > 0 ? oProject.shapeIdCounter : 1;
		this._groupIdCounter = oProject.groupIdCounter && oProject.groupIdCounter > 0 ? oProject.groupIdCounter : 1;
		this._undoStack = [];
		this._redoStack = [];
		this._state.draft = null;
		this._state.selectedShapeId = null;
		this._resetView();

		const aStoredShapes = Array.isArray(oProject.shapes) ? oProject.shapes : [];

		if (oProject.image && oProject.image.dataUrl) {
			const oImg = new Image();
			oImg.onload = () => {
				this._bgImage = oImg;
				this._bgRect = this._computeBackgroundRect(oImg);
				this._state.shapes = oProject.coordinateSpace === "image-pixels"
					? aStoredShapes.map((oShape) => this._convertShape(oShape, false))
					: aStoredShapes.map((oShape) => this._cloneShape(oShape));
				this._applyMode();
				this._render();
				MessageToast.show(this._getText("openSuccess"));
			};
			oImg.onerror = () => MessageToast.show(this._getText("photoLoadError"));
			oImg.src = oProject.image.dataUrl;
			return;
		}

		this._bgImage = null;
		this._bgRect = null;
		this._state.shapes = aStoredShapes.map((oShape) => this._cloneShape(oShape));
		this._applyMode();
		this._render();
		MessageToast.show(this._getText("openSuccess"));
	}

	/** Réinitialise zoom / translation (utilisé au chargement d'un projet). */
	private _resetView(): void {
		this._state.zoom = 1;
		this._state.panX = 0;
		this._state.panY = 0;
		if (this._zoomSlider) {
			// mOptions requis par les typings 1.90, optionnel à l'exécution.
			this._zoomSlider.setValue(1, {});
		}
	}

	/* =========================================================== */
	/* acquisition de la photo (téléversement / caméra)            */
	/* =========================================================== */

	/** Crée l'élément <input type="file"> caché servant au téléversement. */
	private _createFileInput(): void {
		const oInput = document.createElement("input");
		oInput.type = "file";
		oInput.accept = "image/*";
		oInput.style.display = "none";
		oInput.addEventListener("change", this._boundFileChange);
		document.body.appendChild(oInput);
		this._fileInput = oInput;
	}

	private _onUploadButtonPress(): void {
		if (!this._fileInput) {
			return;
		}
		// Réinitialiser la valeur pour autoriser le re-choix du même fichier.
		this._fileInput.value = "";
		this._fileInput.click();
	}

	private _onFileInputChange(): void {
		if (!this._fileInput || !this._fileInput.files || this._fileInput.files.length === 0) {
			return;
		}
		this._readFileAsImage(this._fileInput.files[0]);
	}

	/** Lit un fichier image en Data URL puis l'installe comme fond. */
	private _readFileAsImage(oFile: File): void {
		const oReader = new FileReader();
		oReader.onload = () => {
			this._loadImageFromUrl(oReader.result as string);
		};
		oReader.onerror = () => {
			MessageToast.show(this._getText("photoLoadError"));
		};
		oReader.readAsDataURL(oFile);
	}

	/* =========================================================== */
	/* glisser-déposer d'une image (mode photo)                    */
	/* =========================================================== */

	/** Vrai si un dépôt d'image est actuellement accepté (mode photo + éditable). */
	private _acceptsImageDrop(): boolean {
		return this._state.mode === "photo" && (this.getProperty("editable") as boolean);
	}

	private _onDragOver(oEvent: DragEvent): void {
		if (!this._acceptsImageDrop()) {
			return;
		}
		oEvent.preventDefault();
		if (oEvent.dataTransfer) {
			oEvent.dataTransfer.dropEffect = "copy";
		}
		this._setDropHighlight(true);
	}

	private _onDragLeave(): void {
		this._setDropHighlight(false);
	}

	private _onDrop(oEvent: DragEvent): void {
		if (!this._acceptsImageDrop()) {
			return;
		}
		oEvent.preventDefault();
		this._setDropHighlight(false);

		const oData = oEvent.dataTransfer;
		if (!oData) {
			return;
		}

		// Priorité aux fichiers déposés (image locale) : ils donnent une Data URL,
		// sans souci de « canvas taint » à l'export.
		if (oData.files && oData.files.length > 0) {
			const oImageFile = Array.from(oData.files).find((oFile) => oFile.type.indexOf("image/") === 0);
			if (oImageFile) {
				this._readFileAsImage(oImageFile);
				return;
			}
		}

		// Sinon, tenter une URL déposée (glissée depuis une autre page/onglet).
		const sUrl = oData.getData("text/uri-list") || oData.getData("text/plain");
		if (sUrl) {
			this._loadImageFromUrl(sUrl.trim());
		}
	}

	/** Bordure de mise en évidence de la zone de dépôt. */
	private _setDropHighlight(bActive: boolean): void {
		if (this._container) {
			this._container.style.outline = bActive ? "2px dashed #ffffff" : "";
			this._container.style.outlineOffset = bActive ? "-6px" : "";
		}
	}

	private _loadImageFromUrl(sUrl: string): void {
		const oImg = new Image();
		oImg.onload = () => {
			this._setBackgroundImage(oImg);
		};
		oImg.onerror = () => {
			MessageToast.show(this._getText("photoLoadError"));
		};
		oImg.src = sUrl;
	}

	/** Installe l'image comme fond, réactive les outils et repeint. */
	private _setBackgroundImage(oImg: HTMLImageElement): void {
		this._bgImage = oImg;
		this._bgRect = this._computeBackgroundRect(oImg);
		this._applyMode();
		this._render();
	}

	/**
	 * Calcule le rectangle (en coordonnées monde) où poser la photo pour qu'elle
	 * remplisse la fenêtre courante en conservant ses proportions, centrée.
	 */
	private _computeBackgroundRect(oImg: HTMLImageElement): Rect {
		const iViewW = this._canvas ? this._canvas.clientWidth : 800;
		const iViewH = this._canvas ? this._canvas.clientHeight : 600;
		const fImgRatio = oImg.naturalWidth / oImg.naturalHeight;
		const fViewRatio = iViewW / iViewH;

		let fW: number;
		let fH: number;
		if (fImgRatio > fViewRatio) {
			fW = iViewW;
			fH = iViewW / fImgRatio;
		} else {
			fH = iViewH;
			fW = iViewH * fImgRatio;
		}

		// Centre de la fenêtre exprimé en coordonnées monde (tient compte du zoom/pan).
		const oCenterWorld = this._screenToWorld({ x: iViewW / 2, y: iViewH / 2 });
		const fWorldW = fW / this._state.zoom;
		const fWorldH = fH / this._state.zoom;
		return {
			x: oCenterWorld.x - fWorldW / 2,
			y: oCenterWorld.y - fWorldH / 2,
			w: fWorldW,
			h: fWorldH
		};
	}

	/* =========================================================== */
	/* caméra                                                      */
	/* =========================================================== */

	private _onCameraButtonPress(): void {
		if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
			MessageToast.show(this._getText("cameraUnsupported"));
			return;
		}
		this._openCameraDialog();
	}

	private _openCameraDialog(): void {
		if (!this._cameraDialog) {
			this._cameraSelect = new Select({
				width: "100%",
				tooltip: this._getText("chooseCamera"),
				change: this._onCameraDeviceChange.bind(this)
			});

			const oVideoHtml = new HTML({
				content: "<video class='db-cam-video' autoplay playsinline muted " +
					"style='width:100%;max-height:60vh;background:#000;border-radius:0.25rem;'></video>"
			});

			this._cameraDialog = new Dialog({
				title: this._getText("cameraDialogTitle"),
				contentWidth: "40rem",
				horizontalScrolling: false,
				verticalScrolling: false,
				content: [this._cameraSelect, oVideoHtml],
				beginButton: new Button({
					text: this._getText("capturePhoto"),
					type: "Emphasized",
					icon: "sap-icon://camera",
					press: this._onCapturePhoto.bind(this)
				}),
				endButton: new Button({
					text: this._getText("cancel"),
					press: () => {
						if (this._cameraDialog) {
							this._cameraDialog.close();
						}
					}
				}),
				afterClose: () => {
					this._stopCameraStream();
				}
			});
			this.addDependent(this._cameraDialog);
		}

		this._cameraDialog.open();
		void this._startCamera();
	}

	/** Démarre le flux caméra et (re)peuple la liste des périphériques. */
	private async _startCamera(sDeviceId?: string): Promise<void> {
		this._stopCameraStream();
		try {
			const oConstraints: MediaStreamConstraints = {
				video: sDeviceId ? { deviceId: { exact: sDeviceId } } : true,
				audio: false
			};
			const oStream = await navigator.mediaDevices.getUserMedia(oConstraints);
			this._cameraStream = oStream;
			this._attachStreamToVideo(oStream);
			await this._populateCameraDevices();
		} catch (oError) {
			MessageToast.show(this._getText("cameraError"));
		}
	}

	private _attachStreamToVideo(oStream: MediaStream): void {
		const oVideo = this._getVideoElement();
		if (oVideo) {
			oVideo.srcObject = oStream;
		}
	}

	private _getVideoElement(): HTMLVideoElement | null {
		if (!this._cameraDialog) {
			return null;
		}
		const oDom = this._cameraDialog.getDomRef();
		if (!oDom) {
			return null;
		}
		return oDom.querySelector(".db-cam-video") as HTMLVideoElement | null;
	}

	/** Liste les caméras disponibles et sélectionne celle du flux courant. */
	private async _populateCameraDevices(): Promise<void> {
		if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
			return;
		}
		const aDevices = await navigator.mediaDevices.enumerateDevices();
		const aCameras = aDevices.filter((oDevice) => oDevice.kind === "videoinput");

		this._cameraSelect.removeAllItems();
		if (aCameras.length === 0) {
			MessageToast.show(this._getText("noCameraFound"));
			return;
		}

		aCameras.forEach((oDevice, iIndex) => {
			this._cameraSelect.addItem(new Item({
				key: oDevice.deviceId,
				text: oDevice.label || (this._getText("cameraLabel") + " " + (iIndex + 1))
			}));
		});

		// Refléter le périphérique réellement actif dans la liste.
		const oTrack = this._cameraStream ? this._cameraStream.getVideoTracks()[0] : null;
		const sActiveId = oTrack ? oTrack.getSettings().deviceId : undefined;
		if (sActiveId) {
			this._cameraSelect.setSelectedKey(sActiveId);
		}
	}

	private _onCameraDeviceChange(oEvent: Select$ChangeEvent): void {
		const oItem = oEvent.getParameter("selectedItem") as Item | null;
		if (oItem) {
			void this._startCamera(oItem.getKey());
		}
	}

	private _onCapturePhoto(): void {
		const oVideo = this._getVideoElement();
		if (!oVideo || !oVideo.videoWidth) {
			MessageToast.show(this._getText("cameraError"));
			return;
		}

		const oCapture = document.createElement("canvas");
		oCapture.width = oVideo.videoWidth;
		oCapture.height = oVideo.videoHeight;
		const oCtx = oCapture.getContext("2d");
		if (!oCtx) {
			return;
		}
		oCtx.drawImage(oVideo, 0, 0, oCapture.width, oCapture.height);

		this._loadImageFromUrl(oCapture.toDataURL("image/jpeg", 0.92));
		if (this._cameraDialog) {
			this._cameraDialog.close();
		}
	}

	private _stopCameraStream(): void {
		if (this._cameraStream) {
			this._cameraStream.getTracks().forEach((oTrack) => oTrack.stop());
			this._cameraStream = null;
		}
		const oVideo = this._getVideoElement();
		if (oVideo) {
			oVideo.srcObject = null;
		}
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
			this._canvas.addEventListener("dragover", this._boundHandlers.onDragOver);
			this._canvas.addEventListener("dragleave", this._boundHandlers.onDragLeave);
			this._canvas.addEventListener("drop", this._boundHandlers.onDrop);
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

		// Le tableau est monté et dimensionné : tenter le chargement auto du croquis.
		this._maybeAutoLoadCroquis();
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
		oCanvas.removeEventListener("dragover", this._boundHandlers.onDragOver);
		oCanvas.removeEventListener("dragleave", this._boundHandlers.onDragLeave);
		oCanvas.removeEventListener("drop", this._boundHandlers.onDrop);
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
				// L'instantané sera pris au premier vrai déplacement (pas au simple clic).
				this._pendingDragHistory = true;
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
			if (fDx !== 0 || fDy !== 0) {
				// Instantané unique au premier vrai déplacement du glisser.
				if (this._pendingDragHistory) {
					this._pushHistory();
					this._pendingDragHistory = false;
				}
				this._translateSelection(this._state.selectedShapeId, fDx, fDy);
				this._state.lastWorldPoint = oWorld;
				this._render();
			}
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
		} else if (this._state.draft.type === "line" || this._state.draft.type === "rect") {
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
				this._pushHistory();
				this._state.shapes.push(this._state.draft);
			}
		}

		this._state.draft = null;
		this._state.isDrawing = false;
		this._state.isDraggingSelection = false;
		this._state.isPanning = false;
		this._pendingDragHistory = false;
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

		// Suppression de la sélection via Suppr / Retour arrière (sans modificateur).
		if ((oEvent.key === "Delete" || oEvent.key === "Backspace") && this._state.selectedShapeId) {
			oEvent.preventDefault();
			this._onDeleteSelection();
			return;
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
		this._zoomSlider.setValue(fNewZoom, {});
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
			stroke: this._state.strokeColor,
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
		if (oShape.type === "circle") {
			return oShape.r > 2;
		}
		// text : toujours visible (inséré, jamais dessiné à main levée).
		return true;
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

			if (oShape.type === "text") {
				oShape.x += fDx;
				oShape.y += fDy;
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

		this._pushHistory();
		const oCenter = this._getSelectionCenter(aTargets);
		aTargets.forEach((oShape) => {
			this._scaleShapeAroundCenter(oShape, oCenter, fFactor);
		});
		this._render();
	}

	/**
	 * Fait pivoter la forme (ou le groupe) sélectionnée autour de son centre.
	 * Un rectangle pivoté devient un polygone fermé (le modèle rectangle est
	 * aligné aux axes et ne peut représenter une rotation).
	 */
	private _rotateSelectedShape(fAngle: number): void {
		const sSelectionId = this._state.selectedShapeId;
		if (!sSelectionId) {
			this._showSelectObjectMessage();
			return;
		}

		const aTargets = this._getShapesForSelection(sSelectionId);
		if (aTargets.length === 0) {
			this._showSelectObjectMessage();
			return;
		}

		this._pushHistory();
		const oCenter = this._getSelectionCenter(aTargets);
		this._state.shapes = this._state.shapes.map((oShape) => {
			return this._isShapeMatchSelection(oShape, sSelectionId)
				? this._rotateShape(oShape, oCenter, fAngle)
				: oShape;
		});
		this._render();
	}

	private _rotatePoint(oPoint: Point, oCenter: Point, fAngle: number): Point {
		const fCos = Math.cos(fAngle);
		const fSin = Math.sin(fAngle);
		const fDx = oPoint.x - oCenter.x;
		const fDy = oPoint.y - oCenter.y;
		return {
			x: oCenter.x + fDx * fCos - fDy * fSin,
			y: oCenter.y + fDx * fSin + fDy * fCos
		};
	}

	private _rotateShape(oShape: Shape, oCenter: Point, fAngle: number): Shape {
		const fnRot = (oPoint: Point): Point => this._rotatePoint(oPoint, oCenter, fAngle);
		const oBase = {
			id: oShape.id,
			stroke: oShape.stroke,
			lineWidth: oShape.lineWidth,
			groupId: oShape.groupId
		};

		if (oShape.type === "pen") {
			return { ...oBase, type: "pen", points: oShape.points.map(fnRot) };
		}
		if (oShape.type === "line") {
			const oP1 = fnRot({ x: oShape.x1, y: oShape.y1 });
			const oP2 = fnRot({ x: oShape.x2, y: oShape.y2 });
			return { ...oBase, type: "line", x1: oP1.x, y1: oP1.y, x2: oP2.x, y2: oP2.y };
		}
		if (oShape.type === "circle") {
			const oPos = fnRot({ x: oShape.cx, y: oShape.cy });
			return { ...oBase, type: "circle", cx: oPos.x, cy: oPos.y, r: oShape.r };
		}
		if (oShape.type === "text") {
			const oPos = fnRot({ x: oShape.x, y: oShape.y });
			return { ...oBase, type: "text", x: oPos.x, y: oPos.y, text: oShape.text, fontSize: oShape.fontSize };
		}

		// rect : convertir les 4 coins pivotés en polygone fermé (crayon).
		const aCorners = [
			fnRot({ x: oShape.x1, y: oShape.y1 }),
			fnRot({ x: oShape.x2, y: oShape.y1 }),
			fnRot({ x: oShape.x2, y: oShape.y2 }),
			fnRot({ x: oShape.x1, y: oShape.y2 })
		];
		aCorners.push(aCorners[0]);
		return { ...oBase, type: "pen", points: aCorners };
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

		if (oShape.type === "text") {
			const fWidth = this._textWidth(oShape);
			return {
				minX: oShape.x,
				maxX: oShape.x + fWidth,
				minY: oShape.y,
				maxY: oShape.y + oShape.fontSize
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

		if (oShape.type === "text") {
			oShape.x = oCenter.x + (oShape.x - oCenter.x) * fFactor;
			oShape.y = oCenter.y + (oShape.y - oCenter.y) * fFactor;
			oShape.fontSize = Math.max(4, oShape.fontSize * fFactor);
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
			stroke: this._state.strokeColor,
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

		if (sPreset === "route") {
			return [
				// Deux bords de route + ligne centrale discontinue.
				fnLine(-22, -60, -22, 60),
				fnLine(22, -60, 22, 60),
				fnLine(0, -55, 0, -38),
				fnLine(0, -20, 0, -3),
				fnLine(0, 14, 0, 31),
				fnLine(0, 47, 0, 60)
			];
		}

		if (sPreset === "cross") {
			// Croix (X) pour marquer un point d'impact.
			return [
				fnLine(-22, -22, 22, 22),
				fnLine(-22, 22, 22, -22)
			];
		}

		// Défaut : une croix.
		return [
			fnLine(-22, -22, 22, 22),
			fnLine(-22, 22, 22, -22)
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

			if (oShape.type === "text") {
				const fWidth = this._textWidth(oShape);
				if (oWorld.x >= oShape.x - fTolerance && oWorld.x <= oShape.x + fWidth + fTolerance &&
					oWorld.y >= oShape.y - fTolerance && oWorld.y <= oShape.y + oShape.fontSize + fTolerance) {
					return oShape;
				}
			}
		}
		return null;
	}

	/** Largeur approximative d'un texte (sans mesure de contexte). */
	private _textWidth(oShape: TextShape): number {
		return (oShape.text.length || 1) * oShape.fontSize * 0.55;
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

		if (this._state.mode === "photo") {
			// En mode photo, un fond uni remplace la grille : la photo (ou le vide en
			// attendant qu'on en ajoute une) doit rester lisible.
			this._ctx.save();
			this._ctx.fillStyle = "#2b2b2b";
			this._ctx.fillRect(0, 0, iWidth, iHeight);
			this._ctx.restore();
		} else {
			this._drawBackgroundGrid(iWidth, iHeight);
		}

		this._ctx.save();
		this._ctx.translate(this._state.panX, this._state.panY);
		this._ctx.scale(this._state.zoom, this._state.zoom);

		// La photo n'est peinte qu'en mode photo : de retour sur le canevas, elle
		// reste en mémoire (le rebasculement en mode photo la réaffiche) mais
		// n'apparaît pas sous les tracés.
		if (this._state.mode === "photo" && this._bgImage && this._bgRect) {
			this._ctx.drawImage(this._bgImage, this._bgRect.x, this._bgRect.y, this._bgRect.w, this._bgRect.h);
		}

		this._state.shapes.forEach((oShape) => {
			this._drawShape(oShape);
		});

		// Cadre de sélection : indiqué par un rectangle en pointillés (et non en
		// recolorant la forme), afin que sa vraie couleur reste visible même
		// pendant qu'elle est sélectionnée.
		this._drawSelectionOverlay();

		if (this._state.draft) {
			this._ctx.save();
			this._ctx.globalAlpha = 0.75;
			this._drawShape(this._state.draft);
			this._ctx.restore();
		}

		this._ctx.restore();
	}

	private _drawSelectionOverlay(): void {
		if (!this._ctx || !this._state.selectedShapeId) {
			return;
		}
		const aTargets = this._getShapesForSelection(this._state.selectedShapeId);
		if (aTargets.length === 0) {
			return;
		}
		const oBounds = this._getShapesBounds(aTargets);
		const fPad = 6 / this._state.zoom;
		this._ctx.save();
		this._ctx.strokeStyle = "#ff6f00";
		this._ctx.lineWidth = 1.5 / this._state.zoom;
		this._ctx.setLineDash([6 / this._state.zoom, 4 / this._state.zoom]);
		this._ctx.strokeRect(
			oBounds.minX - fPad,
			oBounds.minY - fPad,
			(oBounds.maxX - oBounds.minX) + fPad * 2,
			(oBounds.maxY - oBounds.minY) + fPad * 2
		);
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

	private _drawShape(oShape: Shape): void {
		if (!this._ctx) {
			return;
		}
		this._ctx.save();
		this._ctx.strokeStyle = oShape.stroke;
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

		if (oShape.type === "text") {
			this._ctx.fillStyle = oShape.stroke;
			this._ctx.font = oShape.fontSize + "px sans-serif";
			this._ctx.textBaseline = "top";
			this._ctx.fillText(oShape.text, oShape.x, oShape.y);
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
