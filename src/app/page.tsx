import { AppShell } from "@/components/app-shell";
import { SpokenPageHeader } from "@/components/spoken-page-header";
import { authorize, getConnection, listLibraries } from "@/lib/audiobookshelf";
import { AuthorizedSummary, Library } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const connection = await getConnection();
  let initialLibraries: Library[] = [];
  let initialProfile: AuthorizedSummary | null = null;
  let connectionError: string | null = null;

  if (connection) {
    try {
      [initialProfile, initialLibraries] = await Promise.all([
        authorize(connection),
        listLibraries(connection),
      ]);
    } catch (error) {
      connectionError =
        error instanceof Error ? error.message : "The saved Audiobookshelf connection could not be restored.";
    }
  }

  return (
    <main className="page-shell">
      <SpokenPageHeader />

      <AppShell
        initialBaseUrl={connection?.baseUrl}
        initialConnectionError={connectionError}
        initialLibraries={initialLibraries}
        initialProfile={initialProfile}
      />
    </main>
  );
}
