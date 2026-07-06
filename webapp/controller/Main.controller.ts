import BaseController from "./Base.controller";

/**
 * Contrôleur de la page objet autonome qui héberge le tableau de dessin.
 *
 * @namespace zab.be.resa.zuidrawapp.controller
 */
export default class Main extends BaseController {

	public onInit(): void {
		// Rien à initialiser : la section de la page objet pose directement le
		// contrôle <draw:DrawingBoard/> fourni par la bibliothèque zab.be.resa.draw.
	}
}
