import RenderManager from "sap/ui/core/RenderManager";
import DrawingBoard from "./DrawingBoard";

/**
 * Renderer du contrôle {@link zab.be.resa.draw.DrawingBoard}.
 *
 * Rend l'élément racine (barre d'outils + hôte du canevas). Le canevas est
 * (re)configuré impérativement dans DrawingBoard#onAfterRendering.
 *
 * @namespace zab.be.resa.draw
 */
const DrawingBoardRenderer = {
	apiVersion: 2,

	render: function (oRm: RenderManager, oControl: DrawingBoard): void {
		// La mise en page structurelle est posée en styles *inline* (et non
		// uniquement via la CSS de thème de la bibliothèque) afin que le tableau
		// reste dimensionné et utilisable quel que soit le thème actif ou le mode
		// de chargement de la bibliothèque (le CSS de thème peut ne pas être
		// injecté lorsque la lib est chargée paresseusement / sous un thème non
		// fourni). La CSS de thème n'apporte plus que le décor (bordure, fond…).
		oRm.openStart("div", oControl);
		oRm.class("drawingShell");
		oRm.style("width", oControl.getProperty("width") as string);
		oRm.style("height", oControl.getProperty("height") as string);
		oRm.style("box-sizing", "border-box");
		oRm.style("padding", "0.5rem");
		oRm.style("display", "flex");
		oRm.style("flex-direction", "column");
		oRm.openEnd();

		// Barre d'outils construite par le contrôle.
		oRm.renderControl(oControl.getAggregation("_toolbar") as never);

		// Hôte du canevas.
		oRm.openStart("div");
		oRm.class("db-root");
		oRm.style("flex", "1 1 auto");
		oRm.style("min-height", "320px");
		oRm.style("position", "relative");
		oRm.style("overflow", "hidden");
		oRm.openEnd();

		oRm.openStart("canvas");
		oRm.class("db-canvas");
		oRm.style("display", "block");
		oRm.style("width", "100%");
		oRm.style("height", "100%");
		oRm.style("cursor", "crosshair");
		oRm.openEnd();
		oRm.close("canvas");

		// Invite affichée en mode photo tant qu'aucune image n'a été ajoutée.
		// Masquée par défaut ; DrawingBoard#_updatePhotoHint pilote sa visibilité.
		oRm.openStart("div");
		oRm.class("db-photo-hint");
		oRm.style("display", "none");
		oRm.style("position", "absolute");
		oRm.style("inset", "0");
		oRm.style("align-items", "center");
		oRm.style("justify-content", "center");
		oRm.style("text-align", "center");
		oRm.style("padding", "1rem");
		oRm.style("color", "#ffffff");
		oRm.style("font-size", "1rem");
		oRm.style("pointer-events", "none");
		oRm.openEnd();
		oRm.text(oControl.getPhotoHintText());
		oRm.close("div");

		oRm.close("div");

		oRm.close("div");
	}
};

export default DrawingBoardRenderer;
