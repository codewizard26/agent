import fs from "node:fs";
import { extractText, getDocumentProxy } from "unpdf";
import { createDb, profiles } from "@job-agent/db";
import {
  createLlmClient,
  parseResume,
  DEFAULT_POSTURE_INDIA,
  DEFAULT_POSTURE_REMOTE_GLOBAL,
} from "@job-agent/core";

const SEEDS = [
  {
    name: "Nikhil Mishra",
    ownerEmail: "nikhilmishra2608@gmail.com",
    pdf: process.env.RESUME_1 ?? `${process.env.HOME}/Desktop/nikhil_resume_december.pdf`,
    posture: DEFAULT_POSTURE_REMOTE_GLOBAL,
  },
  {
    name: "Shambhavi Soumya",
    ownerEmail: "shambhavisoumya10@gmail.com",
    pdf: process.env.RESUME_2 ?? `${process.env.HOME}/Downloads/fullstackresume.pdf`,
    // India-only: her posture drops the "remote" region, so remote-anywhere
    // roles are filtered out and only roles located in India survive. Set
    // explicitly rather than left at the india + remote default.
    posture: { ...DEFAULT_POSTURE_INDIA, regions: ["india"] },
  },
];

const db = createDb();
const client = createLlmClient();

for (const seed of SEEDS) {
  const buffer = new Uint8Array(fs.readFileSync(seed.pdf));
  const pdf = await getDocumentProxy(buffer);
  const { text } = await extractText(pdf, { mergePages: true });

  const parsed = await parseResume(text, client);
  await db.insert(profiles).values({
    name: seed.name,
    ownerEmail: seed.ownerEmail,
    resumeBlobUrl: seed.pdf,
    resumeText: text,
    parsedProfile: parsed,
    posture: seed.posture,
    // Both profiles start unauthorized. Only the profile's own owner flips this.
    autoSubmitAuthorized: false,
  });
  console.log(
    `seeded ${seed.name}: bands=${parsed.seniorityBands.join(",")} stack=${parsed.coreStack.length}`,
  );
}
