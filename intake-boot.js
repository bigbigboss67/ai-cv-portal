/**
 * Wire the listing-intake modules into the portal as window.INTAKE.
 *
 * Its own module script on purpose: if anything here fails to load, the PDF,
 * email and address-finder modules in the main module block keep working, and
 * the portal simply shows no Add-a-listing panel.
 */
import { parseListing, listingId, fnv1a } from "./intake-parse.js";
import { assessFit } from "./intake-fit.js";
import { readListing } from "./intake-read.js";
import { loadIntake, parseIntake, saveIntake, upsertIntake, removeIntake, toJob } from "./intake-store.js";

const places = await fetch("./data/places.json").then((r) => (r.ok ? r.json() : [])).catch(() => []);

window.INTAKE = {
  readListing,
  parseListing: (text, opt = {}) => parseListing(text, { ...opt, places }),
  listingId,
  fnv1a,
  assessFit,
  store: { load: loadIntake, parse: parseIntake, save: saveIntake, upsert: upsertIntake, remove: removeIntake, toJob },
};

if (typeof window.intakeReady === "function") window.intakeReady();
