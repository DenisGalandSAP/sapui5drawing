sap.ui.define([
	"sap/ui/core/mvc/Controller",
	"sap/ui/core/UIComponent"
], function (
	Controller,
	UIComponent
) {
	"use strict";

	return Controller.extend("zab.be.resa.zuilibrdraw.controller.Base", {

		getRouter: function () { return UIComponent.getRouterFor(this); },

		getModel: function (sName) { return this.getView().getModel(sName); },

		setModel: function (oModel, sName) { return this.getView().setModel(oModel, sName); },

		getResourceBundle: function () { return this.getOwnerComponent().getModel("i18n").getResourceBundle(); },

		getI18nText: function (sTextId) { return this.getOwnerComponent().getModel("i18n").getResourceBundle().getText(sTextId); },

		bId: function (sId) { return this.getView().byId(sId); },

		getProperty: function (sProperty) { return this.getView().getBindingContext().getProperty(sProperty); }

	});
});
