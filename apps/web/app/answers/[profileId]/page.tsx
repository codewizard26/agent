import Link from "next/link";
import { eq } from "drizzle-orm";
import { createDb, answerBank, profiles } from "@job-agent/db";
import { seedAnswerRows } from "@job-agent/core";
import { AnswerBankForm } from "../../../components/AnswerBankForm";

export const dynamic = "force-dynamic";

export default async function AnswersPage({
  params,
}: {
  params: Promise<{ profileId: string }>;
}) {
  const { profileId } = await params;
  const db = createDb();

  const [profile] = await db.select().from(profiles).where(eq(profiles.id, profileId));
  if (!profile) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-16">
        <h1 className="display text-3xl font-extrabold">No such profile</h1>
        <p className="mt-2 text-sm text-ink-soft">
          The link points at a profile that is not in the database.{" "}
          <Link className="link" href="/">
            Back to profiles
          </Link>
          .
        </p>
      </main>
    );
  }

  let rows = await db.select().from(answerBank).where(eq(answerBank.profileId, profileId));
  if (rows.length === 0) {
    await db.insert(answerBank).values(seedAnswerRows(profileId));
    rows = await db.select().from(answerBank).where(eq(answerBank.profileId, profileId));
  }

  const blank = rows.filter((row) => !row.value).length;

  return (
    <main className="mx-auto max-w-2xl px-6 pt-12">
      <span className="eyebrow">Answer bank</span>
      <h1 className="display mt-1 text-4xl font-extrabold">{profile.name}</h1>
      <p className="mt-3 text-[14px] leading-relaxed text-ink-soft">
        These fill application forms automatically. A blank answer stops the
        application and asks you instead.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-rule pt-4">
        <span className={`pill ${blank > 0 ? "pill-warn" : "pill-go"}`}>
          {blank > 0 ? `${blank} still blank` : "all answered"}
        </span>
        <Link className="link text-[13px]" href={`/profiles/${profileId}`}>
          Back to the board
        </Link>
      </div>

      <div className="mt-8">
        <AnswerBankForm rows={rows} />
      </div>
    </main>
  );
}
