import { FocusPlayerShell } from "@/components/focus-player-shell";

export const dynamic = "force-dynamic";

type FocusPlayerPageProps = {
  params: Promise<{ itemId: string }>;
};

export default async function FocusPlayerPage({ params }: FocusPlayerPageProps) {
  const { itemId } = await params;

  return <FocusPlayerShell itemId={itemId} />;
}
