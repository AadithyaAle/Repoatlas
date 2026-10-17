import type { Metadata } from "next";

import { RepoView } from "@/components/repo/repo-view";

type Params = { owner: string; name: string };

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { owner, name } = await params;
  const slug = `${safeDecode(owner)}/${safeDecode(name)}`;
  return {
    title: slug,
    description: `Dependency graph, latest analysis and onboarding tours for ${slug} on RepoAtlas.`,
  };
}

export default async function RepoPage({ params }: { params: Promise<Params> }) {
  const { owner, name } = await params;
  return <RepoView owner={safeDecode(owner)} name={safeDecode(name)} />;
}
