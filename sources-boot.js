/**
 * Wire the Sources tab's logic into the portal as window.SRC and window.findContact.
 *
 * Its own module script, like intake-boot.js: if it fails to load, the PDF, email
 * and intake modules keep working and the Sources tab simply stays read-only.
 */
import * as SRC from "./sources.js";
import { findContact } from "./fetch-address.js";

window.SRC = SRC;
window.findContact = findContact;

if (typeof window.sourcesReady === "function") window.sourcesReady();
