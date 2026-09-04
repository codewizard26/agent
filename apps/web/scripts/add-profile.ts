/**
 * Insert or update a profile row from a hand-written profile JSON — the same
 * file `pnpm candidates` reads. `pnpm seed` does this too, but it parses the
 * resume with a model first; this path needs no API key.
 *
 * The row is what the dashboard lists, what the ledger hangs off (so applied
 * jobs stop reappearing), and what the apply worker reads the resume path from.
 *
 *   pnpm add-profile --profile ../../profiles/nikhil.json
 *   pnpm add-profile --profile ../../profiles/nikhil.json --resume ~/Desktop/cv.pdf
 */
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { extractText, getDocumentProxy } from "unpdf";
import { createDb, profiles } from "@job-agent/db";
import { ProfileFileSchema } from "@job-agent/core";

interface Args {
  profileFile: string;
  resumePath: string | null;
}

function parseArgs(argv: string[]): Args {
  let profileFile: string | null = null;
  let resumePath: string | null = null;
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (value === undefined) throw new Error(`missing value for ${flag}`);
    if (flag === "--profile") profileFile = path.resolve(value);
    else if (flag === "--resume") resumePath = path.resolve(value);
    else throw new Error(`unknown flag ${flag}`);
  }
  if (!profileFile) throw new Error("usage: pnpm add-profile --profile <file.json>");
  return { profileFile, resumePath };
}

const args = parseArgs(process.argv.slice(2));
const file = ProfileFileSchema.parse(JSON.parse(fs.readFileSync(args.profileFile, "utf8")));

// The worker uploads this exact file to the ATS, so a wrong path fails at the
// point of applying rather than here. Resolve it now and fail loudly instead.
const resumePath = args.resumePath ?? (file.resumePath ? path.resolve(file.resumePath) : null);
if (resumePath && !fs.existsSync(resumePath)) {
  throw new Error(`resume not found at ${resumePath}`);
}
if (!resumePath) {
  console.warn(
    "no resume path — fetching will work, but the apply worker has no file to upload. " +
      "Pass --resume <path.pdf> or add resumePath to the profile JSON.",
  );
}

let resumeText = "";
if (resumePath) {
  const pdf = await getDocumentProxy(new Uint8Array(fs.readFileSync(resumePath)));
  resumeText = (await extractText(pdf, { mergePages: true })).text;
}

const db = createDb();
const [existing] = await db
  .select()
  .from(profiles)
  .where(eq(profiles.ownerEmail, file.ownerEmail));

if (existing) {
  // Deliberately does not touch autoSubmitAuthorized: only the profile's owner
  // flips that, and re-running this script is not them flipping it.
  await db
    .update(profiles)
    .set({
      name: file.name,
      parsedProfile: file.parsedProfile,
      posture: file.posture,
      // Omitted in the file means "leave whatever is stored alone".
      ...(file.feedTimeFrameDays !== undefined
        ? { feedTimeFrameDays: file.feedTimeFrameDays }
        : {}),
      ...(resumePath ? { resumeBlobUrl: resumePath, resumeText } : {}),
    })
    .where(eq(profiles.id, existing.id));
  console.log(`updated ${file.name} (${existing.id})`);
} else {
  const [row] = await db
    .insert(profiles)
    .values({
      name: file.name,
      ownerEmail: file.ownerEmail,
      resumeBlobUrl: resumePath,
      resumeText,
      parsedProfile: file.parsedProfile,
      posture: file.posture,
      feedTimeFrameDays:
        file.feedTimeFrameDays === undefined ? 7 : file.feedTimeFrameDays,
      // Every profile starts unauthorized. Only its owner flips this.
      autoSubmitAuthorized: false,
    })
    .returning();
  console.log(`inserted ${file.name} (${row!.id})`);
}

console.log(
  `bands=${file.parsedProfile.seniorityBands.join(",")} ` +
    `stack=${file.parsedProfile.coreStack.length} ` +
    `indiaPriority=${file.posture.indiaPriority} ` +
    `window=${file.feedTimeFrameDays === null ? "any" : (file.feedTimeFrameDays ?? "unchanged")}`,
);
process.exit(0);
