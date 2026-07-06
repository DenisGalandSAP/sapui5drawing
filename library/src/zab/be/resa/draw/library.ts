import Core from "sap/ui/core/Core";

/**
 * Initialisation de la bibliothèque zab.be.resa.draw.
 *
 * Cette bibliothèque expose le contrôle {@link zab.be.resa.draw.DrawingBoard},
 * un tableau de dessin autonome basé sur un canevas HTML.
 *
 * @namespace zab.be.resa.draw
 */
Core.initLibrary({
	name: "zab.be.resa.draw",
	version: "0.0.1",
	dependencies: ["sap.ui.core", "sap.m"],
	types: [],
	interfaces: [],
	controls: ["zab.be.resa.draw.DrawingBoard"],
	elements: [],
	// La CSS de la bibliothèque est fournie sous themes/<theme>/library.css
	noLibraryCSS: false
});
