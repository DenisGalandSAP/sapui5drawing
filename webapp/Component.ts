import UIComponent from "sap/ui/core/UIComponent";

/**
 * Composant de l'application autonome hébergeant le tableau de dessin.
 *
 * L'application est totalement détachée de la bibliothèque zab.be.resa.draw :
 * elle la consomme comme n'importe quelle bibliothèque SAPUI5, via le contrôle
 * <draw:DrawingBoard/> déclaré dans la vue principale.
 *
 * @namespace zab.be.resa.zuidrawapp
 */
export default class Component extends UIComponent {

	public static readonly metadata = {
		manifest: "json"
	};

	public init(): void {
		// Appel du init de la super-classe (initialise le routeur, les modèles, etc.).
		super.init();
	}
}
