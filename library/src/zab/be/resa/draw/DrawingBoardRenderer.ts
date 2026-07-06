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
		oRm.openStart("div", oControl);
		oRm.class("drawingShell");
		oRm.style("width", oControl.getProperty("width") as string);
		oRm.style("height", oControl.getProperty("height") as string);
		oRm.openEnd();

		// Barre d'outils construite par le contrôle.
		oRm.renderControl(oControl.getAggregation("_toolbar") as never);

		// Hôte du canevas.
		oRm.openStart("div");
		oRm.class("db-root");
		oRm.openEnd();

		oRm.openStart("canvas");
		oRm.class("db-canvas");
		oRm.openEnd();
		oRm.close("canvas");

		oRm.close("div");

		oRm.close("div");
	}
};

export default DrawingBoardRenderer;
