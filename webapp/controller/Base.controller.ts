import Controller from "sap/ui/core/mvc/Controller";
import UIComponent from "sap/ui/core/UIComponent";
import Model from "sap/ui/model/Model";
import ManagedObject from "sap/ui/base/ManagedObject";
import ResourceModel from "sap/ui/model/resource/ResourceModel";
import ResourceBundle from "sap/base/i18n/ResourceBundle";
import Router from "sap/ui/core/routing/Router";

/**
 * @namespace zab.be.resa.zuilibrdraw.controller
 */
export default class Base extends Controller {

	public getRouter(): Router {
		return UIComponent.getRouterFor(this);
	}

	public getModel(sName?: string): Model {
		return this.getView().getModel(sName) as Model;
	}

	public setModel(oModel: Model, sName?: string): ManagedObject {
		return this.getView().setModel(oModel, sName);
	}

	public getResourceBundle(): ResourceBundle {
		const oModel = this.getOwnerComponent().getModel("i18n") as ResourceModel;
		return oModel.getResourceBundle() as ResourceBundle;
	}

	public getI18nText(sTextId: string): string {
		return this.getResourceBundle().getText(sTextId) ?? sTextId;
	}

	public bId(sId: string): ManagedObject {
		return this.getView().byId(sId);
	}

	public getProperty(sProperty: string): unknown {
		return this.getView().getBindingContext()?.getProperty(sProperty);
	}
}
