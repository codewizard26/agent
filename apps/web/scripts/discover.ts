import fs from "node:fs";
import path from "node:path";
import { stringify } from "yaml";
import {
  loadBoards,
  discoverBoards,
  fetchRemoteOk,
  fetchArbeitnow,
  fetchRemotive,
  fetchInstahyre,
} from "@job-agent/core";

const boardsPath = path.join(process.cwd(), "..", "..", "sources", "boards.yaml");
const existing = loadBoards(fs.readFileSync(boardsPath, "utf8"));

const [remoteok, arbeitnow, remotive, instahyre] = await Promise.all([
  fetchRemoteOk().catch(() => []),
  fetchArbeitnow().catch(() => []),
  fetchRemotive().catch(() => []),
  // India-native, so its company names are how Indian employers' own
  // Greenhouse/Lever/Ashby boards get discovered.
  fetchInstahyre().catch(() => []),
]);

const companies = [
  ...new Set([
    ...remoteok.map((r) => r.company).filter((c): c is string => Boolean(c)),
    ...arbeitnow.map((r) => r.company_name),
    ...remotive.map((r) => r.company_name),
    ...instahyre
      .map((r) => r.employer?.company_name)
      .filter((c): c is string => Boolean(c)),
  ]),
];

console.log(`probing ${companies.length} company names…`);
const grown = await discoverBoards(companies, existing);

const added =
  grown.greenhouse.length - existing.greenhouse.length +
  (grown.lever.length - existing.lever.length) +
  (grown.ashby.length - existing.ashby.length);

fs.writeFileSync(boardsPath, stringify(grown));
console.log(`added ${added} board tokens; boards.yaml updated`);
