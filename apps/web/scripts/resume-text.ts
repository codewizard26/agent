/**
 * Dump a resume PDF as plain text. `pnpm seed` sends this text to a model to
 * build a profile; the keyless path prints it instead so Claude Code can read
 * it in conversation and hand `pnpm candidates` a profile JSON.
 *
 *   pnpm resume-text ~/Desktop/resume.pdf
 */
import fs from "node:fs";
import { extractText, getDocumentProxy } from "unpdf";

const file = process.argv[2];
if (!file) throw new Error("usage: pnpm resume-text <path-to.pdf>");

const pdf = await getDocumentProxy(new Uint8Array(fs.readFileSync(file)));
const { text } = await extractText(pdf, { mergePages: true });
console.log(text);
