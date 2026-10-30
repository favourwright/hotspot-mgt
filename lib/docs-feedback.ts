/**
 * "Was this helpful?" on /developers, counted per section.
 *
 * One document per section with two counters, incremented in place, never a
 * document per click: the answers carry nothing but yes or no, and a public
 * endpoint that wrote a document per press would be a way to spend the
 * project's write quota. Only ids of sections that exist are accepted, so
 * nobody can create documents with names of their choosing.
 */

import { adminDb } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/firebase-collections";
import { FieldValue } from "firebase-admin/firestore";
import { buildDocsView } from "@/lib/docs-view";

let known: Map<string, { title: string; group: string }> | null = null;

/** The docs' own section ids; built once per process from the code. */
export function docsSectionIds(): Map<string, { title: string; group: string }> {
  known ??= new Map(
    buildDocsView(process.env.NEXT_PUBLIC_APP_URL || "https://ogawifi.online").sections.map((s) => [
      s.id,
      { title: s.title, group: s.group },
    ])
  );
  return known;
}

export async function recordDocsFeedback(sectionId: string, helpful: boolean): Promise<boolean> {
  const section = docsSectionIds().get(sectionId);
  if (!section) return false;
  await adminDb
    .collection(COLLECTIONS.DOCS_FEEDBACK)
    .doc(sectionId)
    .set(
      {
        title: section.title,
        group: section.group,
        [helpful ? "yes" : "no"]: FieldValue.increment(1),
        [helpful ? "lastYesAt" : "lastNoAt"]: new Date(),
        updatedAt: new Date(),
      },
      { merge: true }
    );
  return true;
}

export interface DocsFeedbackRow {
  id: string;
  title: string;
  group: string;
  yes: number;
  no: number;
  updatedAt: string | null;
}

export async function listDocsFeedback(): Promise<DocsFeedbackRow[]> {
  const snap = await adminDb.collection(COLLECTIONS.DOCS_FEEDBACK).limit(500).get();
  return snap.docs
    .map((d) => {
      const x = d.data();
      const updated = x.updatedAt?.toDate?.() ?? (x.updatedAt instanceof Date ? x.updatedAt : null);
      return {
        id: d.id,
        title: x.title ?? d.id,
        group: x.group ?? "",
        yes: typeof x.yes === "number" ? x.yes : 0,
        no: typeof x.no === "number" ? x.no : 0,
        updatedAt: updated ? updated.toISOString() : null,
      };
    })
    .sort((a, b) => b.no - a.no || b.yes + b.no - (a.yes + a.no));
}
