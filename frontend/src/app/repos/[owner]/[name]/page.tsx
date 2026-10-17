import type { Metadata } from "next";

import { RepoView } from "@/components/repo/repo-view";

type Params = { owner: string; name: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { owner, name } = await params;
  return { title: `${owner}/${name}` };
}

export default async function RepoPage({ params }: { params: Promise<Params> }) {
  const { owner, name } = await params;
  return <RepoView owner={decodeURIComponent(owner)} name={decodeURIComponent(name)} />;
}
