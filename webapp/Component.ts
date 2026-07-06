import UIComponent from "sap/ui/core/UIComponent";
import View from "sap/ui/core/mvc/View";
import ReuseComponentSupport from "sap/suite/ui/generic/template/extensionAPI/ReuseComponentSupport";
import DrawController from "./controller/Draw.controller";

/**
 * Composant réutilisable de la bibliothèque de dessin.
 *
 * @namespace zab.be.resa.zuilibrdraw
 */
export default class Component extends UIComponent {

	public static readonly metadata = {
		manifest: "json",
		library: "DrawManagementLibrary",
		properties: {
			// Propriétés spécifiques au composant
			editable: {
				type: "boolean",
				group: "specific",
				defaultValue: true
			}
		}
	};

	private _compView?: View;

	/**
	 * Le composant est initialisé automatiquement par UI5 au démarrage de
	 * l'application ; la méthode init n'est appelée qu'une seule fois.
	 */
	public init(): void {
		// Transforme ce composant en composant réutilisable pour les smart templates :
		ReuseComponentSupport.mixInto(this);
		// Appel défensif du init de la super-classe :
		super.init();
	}

	public setView(oView: View): void {
		this._compView = oView;
	}

	public setContext(bEditable?: boolean): void {
		if (bEditable !== undefined) {
			(this as unknown as { setEditable(b: boolean): void }).setEditable(bEditable);
		}

		if (this._compView) {
			(this._compView.getController() as DrawController).drawInit();
		}
	}
}
