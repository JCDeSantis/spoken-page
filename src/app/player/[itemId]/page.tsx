import { FocusPlayerShell } from "@/components/focus-player-shell";
import { authorize, getConnection } from "@/lib/audiobookshelf";

export const dynamic = "force-dynamic";

type FocusPlayerPageProps = {
  params: Promise<{ itemId: string }>;
};

export default async function FocusPlayerPage({ params }: FocusPlayerPageProps) {
  const { itemId } = await params;
  const connection = await getConnection();
  const profile = connection ? await authorize(connection) : null;

  return <FocusPlayerShell itemId={itemId} preferenceScope={profile?.userId ?? "signed-out"} />;
}
