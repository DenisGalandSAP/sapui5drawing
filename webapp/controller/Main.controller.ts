import BaseController from "./Base.controller";
import JSONModel from "sap/ui/model/json/JSONModel";

/**
 * Contrôleur de la page objet autonome qui héberge le tableau de dessin.
 *
 * @namespace zab.be.resa.zuidrawapp.controller
 */
export default class Main extends BaseController {

	public onInit(): void {
		// Application autonome de test (DTA 310) : on cible un avis réel qui possède
		// déjà un croquis (Otype « CROQ ») — avis E2 420004467 « test LMRA », lié à
		// l'ordre 000110008999 — afin que le contrôle <draw:DrawingBoard/> le charge
		// à l'ouverture et puisse l'enregistrer.
		//
		// La clé de stockage du croquis est le numéro d'avis (QMEL-QMNUM) => Objid,
		// tel qu'enregistré par les applications hôtes (sans zéros de tête).
		const sQmnum = "420004467";

		// URL du service de pièces jointes, relative à l'application : en local elle
		// résout vers /sap/... (proxy fiori-tools), sur BTP / Work Zone vers
		// /zabberesadraw.zabberesazuidrawapp/sap/... (route /sap -> destination erp
		// de xs-app.json).
		const sServiceUrl = sap.ui.require.toUrl("zab/be/resa/zuidrawapp") + "/sap/opu/odata/sap/ZTS_CA_UI5F_ATTA";

		this.getView().setModel(new JSONModel({
			objid: sQmnum,
			serviceUrl: sServiceUrl
		}), "context");
	}
}
