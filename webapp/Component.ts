import UIComponent from "sap/ui/core/UIComponent";
import Lib from "sap/ui/core/Lib";
import Control from "sap/ui/core/Control";

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
		manifest: "json",
		interfaces: ["sap.ui.core.IAsyncContentCreation"]
	};

	public init(): void {
		// Appel du init de la super-classe (initialise le routeur, les modèles, etc.).
		super.init();
	}

	/**
	 * Charge la bibliothèque zab.be.resa.draw (déclarée `lazy` dans le manifest)
	 * avant de créer la vue racine qui utilise <draw:DrawingBoard/>.
	 */
	public createContent(): Promise<Control> {
		return Lib.load({ name: "zab.be.resa.draw", url: Component.getDrawLibraryUrl() })
			.then(() => super.createContent() as Control | Promise<Control>);
	}

	/**
	 * URL de la bibliothèque, déduite de l'URL de l'application :
	 * - SAP BTP / Work Zone : l'application est servie sous
	 *   `/[<guid instance destination>.]zabberesadraw.zabberesazuidrawapp[-<version>]/` ;
	 *   la bibliothèque est déployée dans le même app-host et se trouve sous le même
	 *   préfixe : `/[<guid>.]zabberesadraw.zabberesadraw/`.
	 * - En local (ui5.yaml / ui5-local.yaml) : servie par fiori-tools-servestatic
	 *   sous /resources/zab/be/resa/draw.
	 */
	private static getDrawLibraryUrl(): string {
		const sAppPath = new URL(sap.ui.require.toUrl("zab/be/resa/zuidrawapp") + "/", document.baseURI).pathname;
		const oMatch = /^(.*\/)([^/]*?)zabberesazuidrawapp(?:-[^/]*)?\/+$/.exec(sAppPath);
		return oMatch ? oMatch[1] + oMatch[2] + "zabberesadraw/" : "/resources/zab/be/resa/draw/";
	}
}
