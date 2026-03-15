"use client";

import { useState } from "react";
import { ConnectionPanel } from "@/components/connection-panel";
import { Dashboard } from "@/components/dashboard";
import { AuthorizedSummary, Library } from "@/lib/types";

type AppShellProps = {
  initialLibraries: Library[];
  initialProfile: AuthorizedSummary | null;
  initialBaseUrl?: string;
  initialConnectionError?: string | null;
};

export function AppShell({
  initialLibraries,
  initialProfile,
  initialBaseUrl = "",
  initialConnectionError = null,
}: AppShellProps) {
  const [libraries, setLibraries] = useState(initialLibraries);
  const [profile, setProfile] = useState(initialProfile);

  if (!profile) {
    return (
      <div className="app-shell">
        <ConnectionPanel
          initialBaseUrl={initialBaseUrl}
          initialError={initialConnectionError}
          onConnected={(payload) => {
            setLibraries(payload.libraries);
            setProfile(payload.profile);
          }}
        />
      </div>
    );
  }

  return (
    <div className="app-shell">
      <Dashboard initialLibraries={libraries} initialProfile={profile} />
    </div>
  );
}
