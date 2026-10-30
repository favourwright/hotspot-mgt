import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { DocPage } from "@/components/developers/doc-page";
import { docsView } from "@/lib/docs-view";

// Every docs page is known at build time; anything else is a 404.
export const dynamicParams = false;

function sectionAt(slug: string[]) {
  const href = `/developers/${slug.join("/")}`;
  return docsView().sections.find((s) => s.href === href);
}

export function generateStaticParams() {
  return docsView()
    .sections.filter((s) => s.href !== "/developers")
    .map((s) => ({ slug: s.href.slice("/developers/".length).split("/") }));
}

export async function generateMetadata({ params }: PageProps<"/developers/[...slug]">): Promise<Metadata> {
  const section = sectionAt((await params).slug);
  return section ? { title: `${section.title} - OgaWiFi Developers` } : {};
}

export default async function DevelopersSectionPage({ params }: PageProps<"/developers/[...slug]">) {
  const section = sectionAt((await params).slug);
  if (!section) notFound();
  return <DocPage view={docsView()} section={section} />;
}
