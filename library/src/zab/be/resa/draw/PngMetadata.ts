/**
 * Petites aides pour lire / écrire un morceau de texte (chunk `tEXt`) dans un
 * fichier PNG, sans dépendance externe.
 *
 * On s'en sert pour transporter le « projet » de dessin (image d'origine +
 * lignes vectorielles) directement à l'intérieur de l'image PNG téléchargée :
 * les pixels montrent le rendu composite, et le chunk texte porte le JSON
 * ré-éditable. Le texte stocké est encodé en base64 (donc ASCII pur), ce qui le
 * rend compatible avec un chunk `tEXt` (Latin-1) quel que soit le contenu.
 *
 * @namespace zab.be.resa.draw
 */

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

let aCrcTable: Uint32Array | null = null;

function getCrcTable(): Uint32Array {
	if (aCrcTable) {
		return aCrcTable;
	}
	const aTable = new Uint32Array(256);
	for (let n = 0; n < 256; n += 1) {
		let c = n;
		for (let k = 0; k < 8; k += 1) {
			c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
		}
		aTable[n] = c >>> 0;
	}
	aCrcTable = aTable;
	return aTable;
}

function crc32(aBytes: Uint8Array): number {
	const aTable = getCrcTable();
	let c = 0xffffffff;
	for (let i = 0; i < aBytes.length; i += 1) {
		c = aTable[(c ^ aBytes[i]) & 0xff] ^ (c >>> 8);
	}
	return (c ^ 0xffffffff) >>> 0;
}

/** Encode une chaîne ASCII (base64 ou mot-clé) en octets Latin-1. */
function asciiToBytes(sText: string): Uint8Array {
	const aBytes = new Uint8Array(sText.length);
	for (let i = 0; i < sText.length; i += 1) {
		aBytes[i] = sText.charCodeAt(i) & 0xff;
	}
	return aBytes;
}

function bytesToAscii(aBytes: Uint8Array): string {
	let sResult = "";
	for (let i = 0; i < aBytes.length; i += 1) {
		sResult += String.fromCharCode(aBytes[i]);
	}
	return sResult;
}

/** Encode une chaîne UTF-8 en base64. */
export function encodeUtf8ToBase64(sText: string): string {
	const aUtf8 = new TextEncoder().encode(sText);
	let sBinary = "";
	for (let i = 0; i < aUtf8.length; i += 1) {
		sBinary += String.fromCharCode(aUtf8[i]);
	}
	return btoa(sBinary);
}

/** Décode une chaîne base64 vers de l'UTF-8. */
export function decodeBase64ToUtf8(sBase64: string): string {
	const sBinary = atob(sBase64);
	const aBytes = new Uint8Array(sBinary.length);
	for (let i = 0; i < sBinary.length; i += 1) {
		aBytes[i] = sBinary.charCodeAt(i);
	}
	return new TextDecoder().decode(aBytes);
}

function buildChunk(sType: string, aData: Uint8Array): Uint8Array {
	const aTypeBytes = asciiToBytes(sType);
	const aChunk = new Uint8Array(12 + aData.length);
	const oView = new DataView(aChunk.buffer);
	// Longueur (données uniquement).
	oView.setUint32(0, aData.length, false);
	// Type.
	aChunk.set(aTypeBytes, 4);
	// Données.
	aChunk.set(aData, 8);
	// CRC sur type + données.
	const aTypeAndData = new Uint8Array(aTypeBytes.length + aData.length);
	aTypeAndData.set(aTypeBytes, 0);
	aTypeAndData.set(aData, aTypeBytes.length);
	oView.setUint32(8 + aData.length, crc32(aTypeAndData), false);
	return aChunk;
}

function hasPngSignature(aBytes: Uint8Array): boolean {
	if (aBytes.length < 8) {
		return false;
	}
	for (let i = 0; i < 8; i += 1) {
		if (aBytes[i] !== PNG_SIGNATURE[i]) {
			return false;
		}
	}
	return true;
}

/**
 * Insère un chunk `tEXt` portant le mot-clé donné, juste après l'en-tête IHDR.
 * `sText` doit être ASCII (typiquement du base64).
 */
export function insertTextChunk(aPng: Uint8Array, sKeyword: string, sText: string): Uint8Array {
	if (!hasPngSignature(aPng)) {
		throw new Error("Fichier PNG invalide");
	}

	// IHDR est le premier chunk après la signature (offset 8).
	const oView = new DataView(aPng.buffer, aPng.byteOffset, aPng.byteLength);
	const iIhdrLength = oView.getUint32(8, false);
	const iInsertAt = 8 + 12 + iIhdrLength; // après le chunk IHDR complet

	// Données du chunk tEXt : mot-clé + séparateur NUL + texte.
	const aKeyword = asciiToBytes(sKeyword);
	const aTextBytes = asciiToBytes(sText);
	const aData = new Uint8Array(aKeyword.length + 1 + aTextBytes.length);
	aData.set(aKeyword, 0);
	aData[aKeyword.length] = 0;
	aData.set(aTextBytes, aKeyword.length + 1);
	const aTextChunk = buildChunk("tEXt", aData);

	const aResult = new Uint8Array(aPng.length + aTextChunk.length);
	aResult.set(aPng.subarray(0, iInsertAt), 0);
	aResult.set(aTextChunk, iInsertAt);
	aResult.set(aPng.subarray(iInsertAt), iInsertAt + aTextChunk.length);
	return aResult;
}

/**
 * Lit le texte d'un chunk `tEXt` portant le mot-clé donné, ou `null` s'il est
 * absent.
 */
export function readTextChunk(aPng: Uint8Array, sKeyword: string): string | null {
	if (!hasPngSignature(aPng)) {
		return null;
	}
	const oView = new DataView(aPng.buffer, aPng.byteOffset, aPng.byteLength);
	let iOffset = 8;
	while (iOffset + 8 <= aPng.length) {
		const iLength = oView.getUint32(iOffset, false);
		const sType = bytesToAscii(aPng.subarray(iOffset + 4, iOffset + 8));
		const iDataStart = iOffset + 8;

		if (sType === "tEXt") {
			const aData = aPng.subarray(iDataStart, iDataStart + iLength);
			let iSep = -1;
			for (let i = 0; i < aData.length; i += 1) {
				if (aData[i] === 0) {
					iSep = i;
					break;
				}
			}
			if (iSep >= 0) {
				const sChunkKeyword = bytesToAscii(aData.subarray(0, iSep));
				if (sChunkKeyword === sKeyword) {
					return bytesToAscii(aData.subarray(iSep + 1));
				}
			}
		}

		if (sType === "IEND") {
			break;
		}
		iOffset = iDataStart + iLength + 4; // + CRC
	}
	return null;
}
