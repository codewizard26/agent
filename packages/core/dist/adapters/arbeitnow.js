import { buildJobKey } from "../job-key.js";
import { htmlToText } from "./greenhouse.js";
export function normalizeArbeitnow(raw) {
    return {
        key: buildJobKey({
            company: raw.company_name,
            title: raw.title,
            atsKind: null,
            atsRef: null,
        }),
        sourceKind: "arbeitnow",
        company: raw.company_name,
        title: raw.title,
        locationRaw: raw.location,
        remote: raw.remote,
        locationRestrictions: [],
        descriptionText: htmlToText(raw.description),
        applyUrl: raw.url,
        atsKind: null,
        atsRef: null,
        postedAt: new Date(raw.created_at * 1000),
        dateFidelity: "true",
    };
}
export async function fetchArbeitnow() {
    const res = await fetch("https://www.arbeitnow.com/api/job-board-api");
    if (!res.ok)
        throw new Error(`arbeitnow: HTTP ${res.status}`);
    const body = (await res.json());
    return body.data ?? [];
}
