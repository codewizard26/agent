import { createLabelFiller } from "./greenhouse.js";

/** Lever's hosted form exposes name/email/phone/org/location plus custom cards. */
export const leverFiller = createLabelFiller("lever", ["jobs.lever.co"], {
  name: "full_name",
  "full name": "full_name",
  org: "location",
  "current company": "location",
  "resume/cv": "resume",
});
