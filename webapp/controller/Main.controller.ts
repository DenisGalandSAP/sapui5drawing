import BaseController from "./Base.controller";

/**
 * Contrôleur de la page objet autonome qui héberge le composant de dessin.
 *
 * @namespace zab.be.resa.zuilibrdraw.controller
 */
export default class Main extends BaseController {

	public onInit(): void {
		// Rien à initialiser : la section de la page objet charge le
		// composant réutilisable via son ComponentContainer.
	}
}
