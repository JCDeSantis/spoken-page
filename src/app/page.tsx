import { AppShell } from "@/components/app-shell";
import { SpokenPageHeader } from "@/components/spoken-page-header";
import {
  authorize,
  getConnection,
  getConnectionPolicy,
  listLibraries,
} from "@/lib/audiobookshelf";
import { AuthorizedSummary, Library } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const connection = await getConnection();
  const connectionPolicy = getConnectionPolicy();
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

  if (!connection && connectionPolicy.requiresServerConfiguration) {
    connectionError =
      "This deployment is not ready yet. Set SPOKEN_PAGE_ABS_BASE_URL or SPOKEN_PAGE_ALLOWED_BASE_URLS before connecting.";
  }

  return (
    <main className="page-shell">
      <SpokenPageHeader />

      <AppShell
        initialBaseUrl={connection?.baseUrl ?? connectionPolicy.lockedBaseUrl ?? ""}
        initialConnectionError={connectionError}
        initialLibraries={initialLibraries}
        initialProfile={initialProfile}
        lockedBaseUrl={connectionPolicy.lockedBaseUrl}
        baseUrlHelp={
          connectionPolicy.lockedBaseUrl
            ? "This deployment is locked to one Audiobookshelf server."
            : connectionPolicy.allowedBaseUrls.length > 0
              ? "This deployment only allows approved Audiobookshelf server URLs."
              : null
        }
        submitDisabled={connectionPolicy.requiresServerConfiguration}
      />
    </main>
  );
}
