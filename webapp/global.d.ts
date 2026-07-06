// Ambient declarations for UI5 modules that are not covered by @sapui5/ts-types-esm.

declare module "sap/suite/ui/generic/template/extensionAPI/ReuseComponentSupport" {
	/**
	 * Smart-template reuse-component helper. Only the members used by this
	 * library are declared here.
	 */
	const ReuseComponentSupport: {
		mixInto(oComponent: object): void;
	};
	export default ReuseComponentSupport;
}
