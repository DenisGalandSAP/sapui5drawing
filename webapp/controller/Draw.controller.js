sap.ui.define([
	"./Base.controller",
	"sap/m/MessageToast"
], function (BaseController, MessageToast) {
	"use strict";

	return BaseController.extend("zab.be.resa.zuilibrdraw.controller.Draw", {

		/* =========================================================== */
		/* lifecycle methods                                           */
		/* =========================================================== */

		onInit: function () {
			this._state = {
				tool: "pen",
				zoom: 1,
				panX: 0,
				panY: 0,
				shapes: [],
				selectedShapeId: null,
				draft: null,
				isDrawing: false,
				isDraggingSelection: false,
				isPanning: false,
				lastWorldPoint: null,
				lastScreenPoint: null
			};

			this._shapeIdCounter = 1;
			this._groupIdCounter = 1;
			this._redoStack = [];
			this._canvasReady = false;
			this._retrySetupTimer = null;
			this._resizeObserver = null;
			this._container = null;
			this._canvas = null;
			this._ctx = null;
			this._boundHandlers = {
				onPointerDown: this._onPointerDown.bind(this),
				onPointerMove: this._onPointerMove.bind(this),
				onPointerUp: this._onPointerUp.bind(this),
				onWheel: this._onWheel.bind(this),
				onResize: this._resizeCanvas.bind(this),
				onKeyDown: this._onKeyDown.bind(this)
			};

			// Register the view on the reuse component so setContext() can reach this controller.
			this.getOwnerComponent().setView(this.getView());
		},

		onAfterRendering: function () {
			this._setupCanvas();
			if (this._retrySetupTimer) {
				window.clearTimeout(this._retrySetupTimer);
			}
			this._retrySetupTimer = window.setTimeout(this._setupCanvas.bind(this), 0);
		},

		onExit: function () {
			if (this._retrySetupTimer) {
				window.clearTimeout(this._retrySetupTimer);
				this._retrySetupTimer = null;
			}
			if (this._resizeObserver) {
				this._resizeObserver.disconnect();
				this._resizeObserver = null;
			}
			if (!this._canvas || !this._canvasReady) {
				return;
			}
			this._canvas.removeEventListener("pointerdown", this._boundHandlers.onPointerDown);
			this._canvas.removeEventListener("pointermove", this._boundHandlers.onPointerMove);
			this._canvas.removeEventListener("pointerup", this._boundHandlers.onPointerUp);
			this._canvas.removeEventListener("pointerleave", this._boundHandlers.onPointerUp);
			this._canvas.removeEventListener("wheel", this._boundHandlers.onWheel);
			window.removeEventListener("resize", this._boundHandlers.onResize);
			window.removeEventListener("keydown", this._boundHandlers.onKeyDown);
		},

		/**
		 * Entry point called by the reuse component (Component#setContext).
		 * Re-initialises the canvas when the component is (re)embedded.
		 */
		drawInit: function () {
			this._setupCanvas();
		},

		/* =========================================================== */
		/* event handlers                                              */
		/* =========================================================== */

		onToolChange: function (oEvent) {
			var oItem = oEvent.getParameter("item");
			this._state.tool = oItem.getKey();
			this._state.selectedShapeId = null;
			this._render();
		},

		onZoomSliderChange: function (oEvent) {
			if (!this._canvas) {
				return;
			}
			var fZoom = oEvent.getParameter("value");
			var oCenter = {
				x: this._canvas.clientWidth / 2,
				y: this._canvas.clientHeight / 2
			};
			this._setZoom(fZoom, oCenter);
		},

		onResetView: function () {
			this._state.zoom = 1;
			this._state.panX = 0;
			this._state.panY = 0;
			this.byId("zoomSlider").setValue(1, {});
			this._render();
		},

		onUndo: function () {
			var aUndoneShapes = this._collectUndoBatchFromTail();
			if (aUndoneShapes.length === 0) {
				return;
			}
			this._redoStack.push(aUndoneShapes);
			this._state.selectedShapeId = null;
			this._render();
		},

		onRedo: function () {
			var aRedoShapes = this._redoStack.pop();
			if (!aRedoShapes || aRedoShapes.length === 0) {
				return;
			}
			this._state.shapes.push.apply(this._state.shapes, aRedoShapes);
			this._state.selectedShapeId = aRedoShapes[0].groupId || aRedoShapes[0].id;
			this._render();
		},

		onSmallerButtonPress: function () {
			this._scaleSelectedShape(0.9);
		},

		onLargerButtonPress: function () {
			this._scaleSelectedShape(1.1);
		},

		onInsertPresetButtonPress: function () {
			if (!this._canvas) {
				return;
			}

			var oPresetSelect = this.byId("presetSelect");
			var sPreset = oPresetSelect.getSelectedKey() || "house";
			var oCenterScreen = {
				x: this._canvas.clientWidth / 2,
				y: this._canvas.clientHeight / 2
			};
			var oCenterWorld = this._screenToWorld(oCenterScreen);
			var sGroupId = "g-" + (this._groupIdCounter++);
			var aPresetShapes = this._createPresetShapes(sPreset, oCenterWorld, sGroupId);
			this._state.shapes.push.apply(this._state.shapes, aPresetShapes);
			this._redoStack = [];
			this._state.selectedShapeId = sGroupId;
			this._render();
		},

		onClear: function () {
			this._state.shapes = [];
			this._redoStack = [];
			this._state.draft = null;
			this._state.selectedShapeId = null;
			this._render();
			MessageToast.show("Canvas cleared");
		},

		onDownloadJpg: function () {
			if (!this._canvas) {
				return;
			}

			var that = this;
			var sName = "drawing-" + new Date().toISOString().replace(/[:.]/g, "-") + ".jpg";
			var fnDownload = function (sUrl) {
				var oLink = document.createElement("a");
				oLink.href = sUrl;
				oLink.download = sName;
				document.body.appendChild(oLink);
				oLink.click();
				document.body.removeChild(oLink);
			};

			if (this._canvas.toBlob) {
				this._canvas.toBlob(function (oBlob) {
					if (!oBlob) {
						return;
					}
					var sObjectUrl = URL.createObjectURL(oBlob);
					fnDownload(sObjectUrl);
					window.setTimeout(function () {
						URL.revokeObjectURL(sObjectUrl);
					}, 1000);
					MessageToast.show(that.getI18nText("downloadSuccess"));
				}, "image/jpeg", 0.92);
				return;
			}

			fnDownload(this._canvas.toDataURL("image/jpeg", 0.92));
			MessageToast.show(this.getI18nText("downloadSuccess"));
		},

		/* =========================================================== */
		/* canvas setup                                                */
		/* =========================================================== */

		_setupCanvas: function () {
			var oDrawingHost = this.byId("drawingHost");
			if (!oDrawingHost) {
				return;
			}

			var oHost = oDrawingHost.getDomRef();
			if (!oHost) {
				this._retrySetupTimer = window.setTimeout(this._setupCanvas.bind(this), 60);
				return;
			}

			this._container = oHost.querySelector(".db-root") || document.querySelector(".db-root");
			this._canvas = oHost.querySelector(".db-canvas") || document.querySelector(".db-canvas");
			if (!this._container || !this._canvas) {
				this._retrySetupTimer = window.setTimeout(this._setupCanvas.bind(this), 60);
				return;
			}

			if (!this._canvasReady) {
				this._canvas.style.touchAction = "none";
				this._canvas.addEventListener("pointerdown", this._boundHandlers.onPointerDown);
				this._canvas.addEventListener("pointermove", this._boundHandlers.onPointerMove);
				this._canvas.addEventListener("pointerup", this._boundHandlers.onPointerUp);
				this._canvas.addEventListener("pointerleave", this._boundHandlers.onPointerUp);
				this._canvas.addEventListener("wheel", this._boundHandlers.onWheel, { passive: false });
				window.addEventListener("resize", this._boundHandlers.onResize);
				window.addEventListener("keydown", this._boundHandlers.onKeyDown);

				// As a reuse component embedded in a smart template (or launched in the
				// FLP shell) this view can be rendered while still hidden / inside UI5's
				// DOM-preserve area, i.e. with a zero-sized container, and only revealed
				// later without any window "resize" event firing. A one-shot sizing in
				// onAfterRendering therefore locks the canvas at 0x0 and it stays blank.
				// Observing the container makes the canvas (re)size and repaint the grid
				// as soon as it actually gets real dimensions, in any hosting context.
				if (typeof ResizeObserver !== "undefined") {
					this._resizeObserver = new ResizeObserver(this._boundHandlers.onResize);
					this._resizeObserver.observe(this._container);
				}

				this._canvasReady = true;
			}

			this._resizeCanvas();
		},

		_resizeCanvas: function () {
			if (!this._canvas || !this._container) {
				return;
			}
			var oRect = this._container.getBoundingClientRect();
			var fDpr = window.devicePixelRatio || 1;
			var iWidth = Math.max(1, Math.floor(oRect.width));
			var iHeight = Math.max(1, Math.floor(oRect.height));
			this._canvas.width = Math.floor(iWidth * fDpr);
			this._canvas.height = Math.floor(iHeight * fDpr);
			this._canvas.style.width = iWidth + "px";
			this._canvas.style.height = iHeight + "px";
			this._ctx = this._canvas.getContext("2d");
			if (!this._ctx) {
				return;
			}
			this._ctx.setTransform(fDpr, 0, 0, fDpr, 0, 0);
			this._render();
		},

		/* =========================================================== */
		/* pointer / keyboard interaction                              */
		/* =========================================================== */

		_onPointerDown: function (oEvent) {
			if (!this._ctx || !this._canvas) {
				return;
			}
			oEvent.preventDefault();
			this._canvas.setPointerCapture(oEvent.pointerId);

			var oScreen = this._eventToCanvasPoint(oEvent);
			var oWorld = this._screenToWorld(oScreen);
			this._state.lastScreenPoint = oScreen;
			this._state.lastWorldPoint = oWorld;

			if (this._state.tool === "pan" || oEvent.button === 1) {
				this._state.isPanning = true;
				return;
			}

			if (this._state.tool === "select") {
				var oHitShape = this._hitTest(oWorld);
				if (oHitShape) {
					this._state.selectedShapeId = oHitShape.groupId || oHitShape.id;
					this._state.isDraggingSelection = true;
				} else {
					this._state.selectedShapeId = null;
				}
				this._render();
				return;
			}

			this._state.isDrawing = true;
			this._state.draft = this._createDraftShape(this._state.tool, oWorld);
			this._render();
		},

		_onPointerMove: function (oEvent) {
			if (!this._ctx) {
				return;
			}
			var oScreen = this._eventToCanvasPoint(oEvent);
			var oWorld = this._screenToWorld(oScreen);

			if (this._state.isPanning && this._state.lastScreenPoint) {
				this._state.panX += oScreen.x - this._state.lastScreenPoint.x;
				this._state.panY += oScreen.y - this._state.lastScreenPoint.y;
				this._state.lastScreenPoint = oScreen;
				this._render();
				return;
			}

			if (this._state.isDraggingSelection && this._state.selectedShapeId && this._state.lastWorldPoint) {
				var fDx = oWorld.x - this._state.lastWorldPoint.x;
				var fDy = oWorld.y - this._state.lastWorldPoint.y;
				this._translateSelection(this._state.selectedShapeId, fDx, fDy);
				this._state.lastWorldPoint = oWorld;
				this._render();
				return;
			}

			if (!this._state.isDrawing || !this._state.draft) {
				return;
			}

			if (this._state.draft.type === "pen") {
				this._state.draft.points.push({ x: oWorld.x, y: oWorld.y });
			} else if (this._state.draft.type === "circle") {
				var fRx = oWorld.x - this._state.draft.cx;
				var fRy = oWorld.y - this._state.draft.cy;
				this._state.draft.r = Math.sqrt(fRx * fRx + fRy * fRy);
			} else {
				this._state.draft.x2 = oWorld.x;
				this._state.draft.y2 = oWorld.y;
			}
			this._render();
		},

		_onPointerUp: function (oEvent) {
			if (!this._ctx || !this._canvas) {
				return;
			}

			if (oEvent.pointerId !== undefined && this._canvas.hasPointerCapture(oEvent.pointerId)) {
				this._canvas.releasePointerCapture(oEvent.pointerId);
			}

			if (this._state.isDrawing && this._state.draft) {
				if (this._isShapeVisible(this._state.draft)) {
					this._state.shapes.push(this._state.draft);
					this._redoStack = [];
				}
			}

			this._state.draft = null;
			this._state.isDrawing = false;
			this._state.isDraggingSelection = false;
			this._state.isPanning = false;
			this._state.lastScreenPoint = null;
			this._state.lastWorldPoint = null;
			this._render();
		},

		_onKeyDown: function (oEvent) {
			var oTarget = oEvent.target;
			if (oTarget instanceof HTMLElement) {
				var bTyping = !!oTarget.closest("input, textarea, [contenteditable='true']");
				if (bTyping) {
					return;
				}
			}

			var bModifier = oEvent.ctrlKey || oEvent.metaKey;
			if (!bModifier) {
				return;
			}

			var sKey = oEvent.key.toLowerCase();
			if (sKey === "z" && !oEvent.shiftKey) {
				oEvent.preventDefault();
				this.onUndo();
				return;
			}

			if (sKey === "y" || (sKey === "z" && oEvent.shiftKey)) {
				oEvent.preventDefault();
				this.onRedo();
			}
		},

		_onWheel: function (oEvent) {
			oEvent.preventDefault();
			var fStep = oEvent.deltaY > 0 ? 0.92 : 1.08;
			var fNewZoom = Math.max(0.25, Math.min(4, this._state.zoom * fStep));
			this._setZoom(fNewZoom, this._eventToCanvasPoint(oEvent));
		},

		/* =========================================================== */
		/* history / selection helpers                                 */
		/* =========================================================== */

		_collectUndoBatchFromTail: function () {
			var iLastIndex = this._state.shapes.length - 1;
			if (iLastIndex < 0) {
				return [];
			}

			var oLastShape = this._state.shapes[iLastIndex];
			var sLastGroupId = oLastShape.groupId;
			if (!sLastGroupId) {
				var oSingle = this._state.shapes.pop();
				return oSingle ? [oSingle] : [];
			}

			var aBatch = [];
			while (this._state.shapes.length > 0) {
				var oTail = this._state.shapes[this._state.shapes.length - 1];
				if (oTail.groupId !== sLastGroupId) {
					break;
				}
				aBatch.unshift(oTail);
				this._state.shapes.pop();
			}
			return aBatch;
		},

		_setZoom: function (fNewZoom, oScreenAnchor) {
			if (!this._canvas) {
				return;
			}
			var oAnchor = oScreenAnchor || {
				x: this._canvas.clientWidth / 2,
				y: this._canvas.clientHeight / 2
			};
			var oBefore = this._screenToWorld(oAnchor);
			this._state.zoom = fNewZoom;
			this._state.panX = oAnchor.x - oBefore.x * this._state.zoom;
			this._state.panY = oAnchor.y - oBefore.y * this._state.zoom;
			this.byId("zoomSlider").setValue(fNewZoom, {});
			this._render();
		},

		_eventToCanvasPoint: function (oEvent) {
			if (!this._canvas) {
				return { x: 0, y: 0 };
			}
			var oRect = this._canvas.getBoundingClientRect();
			return {
				x: oEvent.clientX - oRect.left,
				y: oEvent.clientY - oRect.top
			};
		},

		_screenToWorld: function (oPoint) {
			return {
				x: (oPoint.x - this._state.panX) / this._state.zoom,
				y: (oPoint.y - this._state.panY) / this._state.zoom
			};
		},

		_createDraftShape: function (sTool, oWorld) {
			var oCommon = {
				id: String(this._shapeIdCounter++),
				stroke: "#0d47a1",
				lineWidth: 2
			};

			if (sTool === "pen") {
				return Object.assign({}, oCommon, {
					type: "pen",
					points: [{ x: oWorld.x, y: oWorld.y }]
				});
			}

			if (sTool === "line") {
				return Object.assign({}, oCommon, {
					type: "line",
					x1: oWorld.x,
					y1: oWorld.y,
					x2: oWorld.x,
					y2: oWorld.y
				});
			}

			if (sTool === "rect") {
				return Object.assign({}, oCommon, {
					type: "rect",
					x1: oWorld.x,
					y1: oWorld.y,
					x2: oWorld.x,
					y2: oWorld.y
				});
			}

			return Object.assign({}, oCommon, {
				type: "circle",
				cx: oWorld.x,
				cy: oWorld.y,
				r: 0
			});
		},

		_isShapeVisible: function (oShape) {
			if (oShape.type === "pen") {
				return oShape.points.length > 1;
			}
			if (oShape.type === "line") {
				return this._distance(oShape.x1, oShape.y1, oShape.x2, oShape.y2) > 2;
			}
			if (oShape.type === "rect") {
				return Math.abs(oShape.x2 - oShape.x1) > 2 && Math.abs(oShape.y2 - oShape.y1) > 2;
			}
			return oShape.r > 2;
		},

		_translateSelection: function (sSelectionId, fDx, fDy) {
			var aTargets = this._getShapesForSelection(sSelectionId);
			aTargets.forEach(function (oShape) {
				if (oShape.type === "pen") {
					oShape.points = oShape.points.map(function (oPoint) {
						return { x: oPoint.x + fDx, y: oPoint.y + fDy };
					});
					return;
				}

				if (oShape.type === "circle") {
					oShape.cx += fDx;
					oShape.cy += fDy;
					return;
				}

				oShape.x1 += fDx;
				oShape.y1 += fDy;
				oShape.x2 += fDx;
				oShape.y2 += fDy;
			});
		},

		_scaleSelectedShape: function (fFactor) {
			if (!this._state.selectedShapeId) {
				this._showSelectObjectMessage();
				return;
			}

			var aTargets = this._getShapesForSelection(this._state.selectedShapeId);
			if (aTargets.length === 0) {
				this._showSelectObjectMessage();
				return;
			}

			var oCenter = this._getSelectionCenter(aTargets);
			var that = this;
			aTargets.forEach(function (oShape) {
				that._scaleShapeAroundCenter(oShape, oCenter, fFactor);
			});
			this._render();
		},

		_getSelectionCenter: function (aShapes) {
			var oBounds = this._getShapesBounds(aShapes);
			return {
				x: (oBounds.minX + oBounds.maxX) / 2,
				y: (oBounds.minY + oBounds.maxY) / 2
			};
		},

		_getShapeBounds: function (oShape) {
			if (oShape.type === "line") {
				return {
					minX: Math.min(oShape.x1, oShape.x2),
					maxX: Math.max(oShape.x1, oShape.x2),
					minY: Math.min(oShape.y1, oShape.y2),
					maxY: Math.max(oShape.y1, oShape.y2)
				};
			}

			if (oShape.type === "rect") {
				return {
					minX: Math.min(oShape.x1, oShape.x2),
					maxX: Math.max(oShape.x1, oShape.x2),
					minY: Math.min(oShape.y1, oShape.y2),
					maxY: Math.max(oShape.y1, oShape.y2)
				};
			}

			if (oShape.type === "circle") {
				return {
					minX: oShape.cx - oShape.r,
					maxX: oShape.cx + oShape.r,
					minY: oShape.cy - oShape.r,
					maxY: oShape.cy + oShape.r
				};
			}

			var oSeed = oShape.points[0] || { x: 0, y: 0 };
			return oShape.points.reduce(function (oAcc, oPoint) {
				return {
					minX: Math.min(oAcc.minX, oPoint.x),
					maxX: Math.max(oAcc.maxX, oPoint.x),
					minY: Math.min(oAcc.minY, oPoint.y),
					maxY: Math.max(oAcc.maxY, oPoint.y)
				};
			}, {
				minX: oSeed.x,
				maxX: oSeed.x,
				minY: oSeed.y,
				maxY: oSeed.y
			});
		},

		_getShapesBounds: function (aShapes) {
			var that = this;
			var oInitial = this._getShapeBounds(aShapes[0]);
			return aShapes.slice(1).reduce(function (oAcc, oShape) {
				var oBounds = that._getShapeBounds(oShape);
				return {
					minX: Math.min(oAcc.minX, oBounds.minX),
					maxX: Math.max(oAcc.maxX, oBounds.maxX),
					minY: Math.min(oAcc.minY, oBounds.minY),
					maxY: Math.max(oAcc.maxY, oBounds.maxY)
				};
			}, oInitial);
		},

		_scaleShapeAroundCenter: function (oShape, oCenter, fFactor) {
			if (oShape.type === "circle") {
				oShape.cx = oCenter.x + (oShape.cx - oCenter.x) * fFactor;
				oShape.cy = oCenter.y + (oShape.cy - oCenter.y) * fFactor;
				oShape.r = Math.max(2, oShape.r * fFactor);
				return;
			}

			if (oShape.type === "line") {
				oShape.x1 = oCenter.x + (oShape.x1 - oCenter.x) * fFactor;
				oShape.y1 = oCenter.y + (oShape.y1 - oCenter.y) * fFactor;
				oShape.x2 = oCenter.x + (oShape.x2 - oCenter.x) * fFactor;
				oShape.y2 = oCenter.y + (oShape.y2 - oCenter.y) * fFactor;
				return;
			}

			if (oShape.type === "rect") {
				oShape.x1 = oCenter.x + (oShape.x1 - oCenter.x) * fFactor;
				oShape.y1 = oCenter.y + (oShape.y1 - oCenter.y) * fFactor;
				oShape.x2 = oCenter.x + (oShape.x2 - oCenter.x) * fFactor;
				oShape.y2 = oCenter.y + (oShape.y2 - oCenter.y) * fFactor;
				return;
			}

			oShape.points = oShape.points.map(function (oPoint) {
				return {
					x: oCenter.x + (oPoint.x - oCenter.x) * fFactor,
					y: oCenter.y + (oPoint.y - oCenter.y) * fFactor
				};
			});
		},

		_isShapeMatchSelection: function (oShape, sSelectionId) {
			if (!sSelectionId) {
				return false;
			}
			return oShape.id === sSelectionId || oShape.groupId === sSelectionId;
		},

		_getShapesForSelection: function (sSelectionId) {
			var that = this;
			return this._state.shapes.filter(function (oShape) {
				return that._isShapeMatchSelection(oShape, sSelectionId);
			});
		},

		_createPresetShapes: function (sPreset, oCenter, sGroupId) {
			var that = this;
			var oStyle = {
				stroke: "#0d47a1",
				lineWidth: 2,
				groupId: sGroupId
			};
			var fnRect = function (x1, y1, x2, y2) {
				return Object.assign({ id: String(that._shapeIdCounter++) }, oStyle, {
					type: "rect",
					x1: oCenter.x + x1,
					y1: oCenter.y + y1,
					x2: oCenter.x + x2,
					y2: oCenter.y + y2
				});
			};
			var fnLine = function (x1, y1, x2, y2) {
				return Object.assign({ id: String(that._shapeIdCounter++) }, oStyle, {
					type: "line",
					x1: oCenter.x + x1,
					y1: oCenter.y + y1,
					x2: oCenter.x + x2,
					y2: oCenter.y + y2
				});
			};
			var fnCircle = function (x, y, r) {
				return Object.assign({ id: String(that._shapeIdCounter++) }, oStyle, {
					type: "circle",
					cx: oCenter.x + x,
					cy: oCenter.y + y,
					r: r
				});
			};

			if (sPreset === "house") {
				return [
					fnRect(-40, -10, 40, 50),
					fnLine(-40, -10, 0, -45),
					fnLine(0, -45, 40, -10),
					fnRect(-10, 15, 10, 50),
					fnRect(-32, 5, -16, 21),
					fnRect(16, 5, 32, 21)
				];
			}

			if (sPreset === "car") {
				return [
					fnRect(-55, 6, 55, 35),
					fnLine(-35, 6, -12, -12),
					fnLine(-12, -12, 24, -12),
					fnLine(24, -12, 45, 6),
					fnCircle(-28, 38, 10),
					fnCircle(28, 38, 10)
				];
			}

			if (sPreset === "tree") {
				return [
					fnRect(-10, 15, 10, 55),
					fnCircle(0, -10, 24),
					fnCircle(-18, 5, 16),
					fnCircle(18, 5, 16)
				];
			}

			if (sPreset === "sun") {
				return [
					fnCircle(0, 0, 22),
					fnLine(0, -42, 0, -28),
					fnLine(30, -30, 20, -20),
					fnLine(42, 0, 28, 0),
					fnLine(30, 30, 20, 20),
					fnLine(0, 42, 0, 28),
					fnLine(-30, 30, -20, 20),
					fnLine(-42, 0, -28, 0),
					fnLine(-30, -30, -20, -20)
				];
			}

			if (sPreset === "boat") {
				return [
					fnLine(-55, 24, 55, 24),
					fnLine(-45, 24, -25, 42),
					fnLine(-25, 42, 25, 42),
					fnLine(25, 42, 45, 24),
					fnLine(0, 24, 0, -30),
					fnLine(0, -30, 30, -5),
					fnLine(0, -5, 30, -5)
				];
			}

			return [
				fnCircle(-18, 0, 14),
				fnCircle(0, -10, 18),
				fnCircle(20, 0, 14),
				fnLine(-34, 14, 34, 14)
			];
		},

		_showSelectObjectMessage: function () {
			MessageToast.show(this.getI18nText("selectObjectFirst"));
		},

		_hitTest: function (oWorld) {
			var fTolerance = 8 / this._state.zoom;
			for (var i = this._state.shapes.length - 1; i >= 0; i -= 1) {
				var oShape = this._state.shapes[i];

				if (oShape.type === "line" && this._distanceToSegment(oWorld, oShape) <= fTolerance) {
					return oShape;
				}

				if (oShape.type === "rect") {
					var xMin = Math.min(oShape.x1, oShape.x2) - fTolerance;
					var xMax = Math.max(oShape.x1, oShape.x2) + fTolerance;
					var yMin = Math.min(oShape.y1, oShape.y2) - fTolerance;
					var yMax = Math.max(oShape.y1, oShape.y2) + fTolerance;
					if (oWorld.x >= xMin && oWorld.x <= xMax && oWorld.y >= yMin && oWorld.y <= yMax) {
						return oShape;
					}
				}

				if (oShape.type === "circle") {
					var fDist = this._distance(oWorld.x, oWorld.y, oShape.cx, oShape.cy);
					if (Math.abs(fDist - oShape.r) <= fTolerance || fDist <= oShape.r) {
						return oShape;
					}
				}

				if (oShape.type === "pen") {
					for (var j = 1; j < oShape.points.length; j += 1) {
						if (this._distanceToSegment(oWorld, {
							x1: oShape.points[j - 1].x,
							y1: oShape.points[j - 1].y,
							x2: oShape.points[j].x,
							y2: oShape.points[j].y
						}) <= fTolerance) {
							return oShape;
						}
					}
				}
			}
			return null;
		},

		/* =========================================================== */
		/* rendering                                                   */
		/* =========================================================== */

		_render: function () {
			if (!this._ctx || !this._canvas) {
				return;
			}

			var iWidth = this._canvas.clientWidth;
			var iHeight = this._canvas.clientHeight;
			this._ctx.clearRect(0, 0, iWidth, iHeight);
			this._drawBackgroundGrid(iWidth, iHeight);

			this._ctx.save();
			this._ctx.translate(this._state.panX, this._state.panY);
			this._ctx.scale(this._state.zoom, this._state.zoom);

			var that = this;
			this._state.shapes.forEach(function (oShape) {
				that._drawShape(oShape, that._isShapeMatchSelection(oShape, that._state.selectedShapeId));
			});

			if (this._state.draft) {
				this._ctx.save();
				this._ctx.globalAlpha = 0.75;
				this._drawShape(this._state.draft, false);
				this._ctx.restore();
			}

			this._ctx.restore();
		},

		_drawBackgroundGrid: function (iWidth, iHeight) {
			if (!this._ctx) {
				return;
			}
			var iGridSize = 24;
			this._ctx.save();
			this._ctx.fillStyle = "#f8fbff";
			this._ctx.fillRect(0, 0, iWidth, iHeight);
			this._ctx.strokeStyle = "#dce6f2";
			this._ctx.lineWidth = 1;

			for (var x = 0; x <= iWidth; x += iGridSize) {
				this._ctx.beginPath();
				this._ctx.moveTo(x + 0.5, 0);
				this._ctx.lineTo(x + 0.5, iHeight);
				this._ctx.stroke();
			}

			for (var y = 0; y <= iHeight; y += iGridSize) {
				this._ctx.beginPath();
				this._ctx.moveTo(0, y + 0.5);
				this._ctx.lineTo(iWidth, y + 0.5);
				this._ctx.stroke();
			}

			this._ctx.restore();
		},

		_drawShape: function (oShape, bSelected) {
			if (!this._ctx) {
				return;
			}
			this._ctx.save();
			this._ctx.strokeStyle = bSelected ? "#ff6f00" : oShape.stroke;
			this._ctx.lineWidth = (oShape.lineWidth || 2) / this._state.zoom;
			this._ctx.lineJoin = "round";
			this._ctx.lineCap = "round";

			if (oShape.type === "line") {
				this._ctx.beginPath();
				this._ctx.moveTo(oShape.x1, oShape.y1);
				this._ctx.lineTo(oShape.x2, oShape.y2);
				this._ctx.stroke();
			}

			if (oShape.type === "rect") {
				this._ctx.strokeRect(oShape.x1, oShape.y1, oShape.x2 - oShape.x1, oShape.y2 - oShape.y1);
			}

			if (oShape.type === "circle") {
				this._ctx.beginPath();
				this._ctx.arc(oShape.cx, oShape.cy, oShape.r, 0, Math.PI * 2);
				this._ctx.stroke();
			}

			if (oShape.type === "pen" && oShape.points.length > 1) {
				this._ctx.beginPath();
				this._ctx.moveTo(oShape.points[0].x, oShape.points[0].y);
				for (var i = 1; i < oShape.points.length; i += 1) {
					this._ctx.lineTo(oShape.points[i].x, oShape.points[i].y);
				}
				this._ctx.stroke();
			}

			this._ctx.restore();
		},

		/* =========================================================== */
		/* geometry helpers                                            */
		/* =========================================================== */

		_distanceToSegment: function (oPoint, oSegment) {
			var fDx = oSegment.x2 - oSegment.x1;
			var fDy = oSegment.y2 - oSegment.y1;
			if (fDx === 0 && fDy === 0) {
				return this._distance(oPoint.x, oPoint.y, oSegment.x1, oSegment.y1);
			}

			var fT = ((oPoint.x - oSegment.x1) * fDx + (oPoint.y - oSegment.y1) * fDy) / (fDx * fDx + fDy * fDy);
			fT = Math.max(0, Math.min(1, fT));
			return this._distance(oPoint.x, oPoint.y, oSegment.x1 + fT * fDx, oSegment.y1 + fT * fDy);
		},

		_distance: function (x1, y1, x2, y2) {
			var fDx = x2 - x1;
			var fDy = y2 - y1;
			return Math.sqrt(fDx * fDx + fDy * fDy);
		}
	});
});
