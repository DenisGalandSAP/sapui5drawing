sap.ui.define([
    "sap/ui/core/UIComponent",
    "sap/suite/ui/generic/template/extensionAPI/ReuseComponentSupport"
],
    function (UIComponent, ReuseComponentSupport) {
        "use strict";

        const _constants = {
            booleanType: "boolean",
            specificGroup: "specific",
            manifestLanguage: "json",
            libraryName: "DrawManagementLibrary"
        }

        return UIComponent.extend("zab.be.resa.zuilibrdraw.Component", {

            metadata: {
                manifest: _constants.manifestLanguage,
                library: _constants.libraryName,
                properties: {
                    /* Component specific properties */
                    editable: {
                        type: _constants.booleanType,
                        group: _constants.specificGroup,
                        defaultValue: true
                    }
                }
            },

            /**
             * The component is initialized by UI5 automatically during the startup of the app and calls the init method once.
             * @public
             * @override
             */
            init: function () {
                //Transform this component into a reuse component for smart templates:
                ReuseComponentSupport.mixInto(this);
                //Defensive call of init of the super class:
                (UIComponent.prototype.init || jQuery.noop).apply(this, arguments);
            },
            setView: function (oView) {
                this._compView = oView;
            },
            setContext: function (bEditable) {
                if (bEditable !== undefined) {
                    this.setEditable(bEditable);
                }

                if (this._compView) {
                    this._compView.getController().drawInit();
                }
            }
        });
    }
);
