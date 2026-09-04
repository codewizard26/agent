import fs from "node:fs";
import path from "node:path";
import { openWorkerBrowser } from "../src/browser.js";

/** Job ids expire, so resolve current ones from each board's API at capture time. */
const BOARDS = ["gitlab", "discord"];

const outDir = path.join(process.cwd(), "src", "fixtures");
fs.mkdirSync(outDir, { recursive: true });

const session = await openWorkerBrowser();

for (const token of BOARDS) {
  const res = await fetch(`https://boards-api.greenhouse.io/v1/boards/${token}/jobs`);
  const { jobs } = (await res.json()) as { jobs: { id: number }[] };

  // A fresh page per board: reusing one page across navigations intermittently
  // aborts on these forms.
  const page = await session.context.newPage();
  try {
    for (const job of jobs.slice(0, 4)) {
      const url = `https://job-boards.greenhouse.io/${token}/jobs/${job.id}`;
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
      } catch (error) {
        console.log(`  skip ${url}: ${(error as Error).message.slice(0, 60)}`);
        continue;
      }
      await page.waitForTimeout(4000);
      const fields = await page
        .locator("input:visible, textarea:visible, select:visible")
        .count();
      if (fields < 5) {
        console.log(`  skip ${url}: only ${fields} fields (likely a wrapped page)`);
        continue;
      }
      fs.writeFileSync(
        path.join(outDir, `greenhouse-${token}.html`),
        await page.content(),
      );
      console.log(`captured greenhouse-${token} from ${url} (${fields} visible fields)`);
      break;
    }
  } finally {
    await page.close();
  }
}

await session.close();
