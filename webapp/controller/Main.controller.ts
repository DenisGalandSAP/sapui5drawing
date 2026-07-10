import BaseController from "./Base.controller";
import JSONModel from "sap/ui/model/json/JSONModel";

/**
 * Contrôleur de la page objet autonome qui héberge le tableau de dessin.
 *
 * @namespace zab.be.resa.zuidrawapp.controller
 */
export default class Main extends BaseController {

	public onInit(): void {
		// Application autonome de test : on cible directement un avis réel (DTA 310,
		// avis M1 000010000020 « R-2005468-06/0020 LIÈGE-RUE LOUVREX-187 », lié à
		// l'ordre 000190000019) afin que le contrôle <draw:DrawingBoard/> puisse
		// charger et enregistrer le croquis comme pièce jointe (Otype « CROQ »).
		//
		// La clé de stockage du croquis est le numéro d'avis (QMEL-QMNUM) => Objid.
		const sQmnum = "000010000020";

		this.getView().setModel(new JSONModel({
			objid: sQmnum
		}), "context");
	}
}
