import { buildJobKey } from "../job-key.js";
import { htmlToText } from "./greenhouse.js";
/** Remotive states one location string; split it so India can be detected in a list. */
function splitRestrictions(value) {
    if (!value)
        return [];
    return value
        .split(/[,/]|\bor\b/i)
        .map((v) => v.trim())
        .filter(Boolean);
}
export function normalizeRemotive(raw) {
    return {
        key: buildJobKey({
            company: raw.company_name,
            title: raw.title,
            atsKind: null,
            atsRef: null,
        }),
        sourceKind: "remotive",
        company: raw.company_name,
        title: raw.title,
        locationRaw: raw.candidate_required_location ?? "Remote",
        remote: true,
        locationRestrictions: splitRestrictions(raw.candidate_required_location),
        descriptionText: raw.description ? htmlToText(raw.description) : "",
        applyUrl: raw.url,
        atsKind: null,
        atsRef: null,
        postedAt: new Date(raw.publication_date),
        dateFidelity: "true",
    };
}
export async function fetchRemotive() {
    const res = await fetch("https://remotive.com/api/remote-jobs?limit=200");
    if (!res.ok)
        throw new Error(`remotive: HTTP ${res.status}`);
    const body = (await res.json());
    return body.jobs ?? [];
}
export function normalizeHimalayas(raw) {
    const restrictions = raw.locationRestrictions ?? [];
    const seconds = Number(raw.pubDate);
    return {
        key: buildJobKey({
            company: raw.companyName,
            title: raw.title,
            atsKind: null,
            atsRef: null,
        }),
        sourceKind: "himalayas",
        company: raw.companyName,
        title: raw.title,
        locationRaw: restrictions.join(", ") || "Remote",
        remote: true,
        locationRestrictions: restrictions,
        descriptionText: htmlToText(raw.description ?? raw.excerpt ?? ""),
        applyUrl: raw.applicationLink,
        atsKind: null,
        atsRef: null,
        postedAt: Number.isFinite(seconds) ? new Date(seconds * 1000) : null,
        dateFidelity: Number.isFinite(seconds) ? "true" : "none",
    };
}
export async function fetchHimalayas() {
    const res = await fetch("https://himalayas.app/jobs/api?limit=200");
    if (!res.ok)
        throw new Error(`himalayas: HTTP ${res.status}`);
    const body = (await res.json());
    return body.jobs ?? [];
}
export function normalizeJobicy(raw) {
    const restrictions = splitRestrictions(raw.jobGeo);
    return {
        key: buildJobKey({
            company: raw.companyName,
            title: raw.jobTitle,
            atsKind: null,
            atsRef: null,
        }),
        sourceKind: "jobicy",
        company: raw.companyName,
        title: raw.jobTitle,
        locationRaw: raw.jobGeo ?? "Remote",
        remote: true,
        locationRestrictions: restrictions,
        descriptionText: htmlToText(raw.jobDescription ?? raw.jobExcerpt ?? ""),
        applyUrl: raw.url,
        atsKind: null,
        atsRef: null,
        postedAt: new Date(raw.pubDate),
        dateFidelity: "true",
    };
}
export async function fetchJobicy() {
    const res = await fetch("https://jobicy.com/api/v2/remote-jobs?count=50");
    if (!res.ok)
        throw new Error(`jobicy: HTTP ${res.status}`);
    const body = (await res.json());
    return body.jobs ?? [];
}
/**
 * India-native, ~13k live roles. It exposes NO post date — `reviewed_at` is null
 * on every record — so it carries dateFidelity 'none' and, like Ashby, is
 * excluded from time-framed fetches.
 */
export function normalizeInstahyre(raw) {
    const company = raw.employer?.company_name;
    if (!company || !raw.title)
        return null;
    const locations = raw.locations ?? "India";
    return {
        key: buildJobKey({
            company,
            title: raw.title,
            atsKind: null,
            atsRef: null,
        }),
        sourceKind: "instahyre",
        company,
        title: raw.title,
        locationRaw: locations,
        remote: /remote/i.test(locations),
        // Instahyre is an India-only marketplace; every posting hires in India.
        locationRestrictions: ["India"],
        descriptionText: (raw.keywords ?? []).join(", "),
        applyUrl: raw.public_url,
        atsKind: null,
        atsRef: null,
        postedAt: null,
        dateFidelity: "none",
    };
}
export async function fetchInstahyre() {
    const res = await fetch("https://www.instahyre.com/api/v1/job_search?limit=100", {
        headers: { "User-Agent": "job-agent" },
    });
    if (!res.ok)
        throw new Error(`instahyre: HTTP ${res.status}`);
    const body = (await res.json());
    return body.objects ?? [];
}
