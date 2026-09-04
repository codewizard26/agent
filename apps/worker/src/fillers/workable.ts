import { createLabelFiller } from "./greenhouse.js";

export const workableFiller = createLabelFiller("workable", ["apply.workable.com"], {
  "first name": "full_name",
  "last name": "full_name",
  "mobile phone number": "phone",
});
