import { buildJobKey } from "../job-key.js";
export function normalizeLever(raw, token) {
    const location = raw.categories?.location ?? "";
    return {
        key: buildJobKey({
            company: token,
            title: raw.text,
            atsKind: "lever",
            atsRef: `${token}/${raw.id}`,
        }),
        sourceKind: "lever",
        company: token,
        title: raw.text,
        locationRaw: location,
        remote: raw.workplaceType === "remote" ||
            /remote/i.test(location) ||
            /remote/i.test(raw.text),
        locationRestrictions: [],
        descriptionText: raw.descriptionPlain ?? "",
        applyUrl: raw.applyUrl ?? raw.hostedUrl,
        atsKind: "lever",
        atsRef: `${token}/${raw.id}`,
        postedAt: new Date(raw.createdAt),
        dateFidelity: "true",
    };
}
export async function fetchLeverBoard(token) {
    const res = await fetch(`https://api.lever.co/v0/postings/${token}?mode=json`);
    if (!res.ok)
        throw new Error(`lever ${token}: HTTP ${res.status}`);
    return (await res.json());
}
