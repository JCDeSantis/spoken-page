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
  lockedBaseUrl?: string | null;
  baseUrlHelp?: string | null;
  submitDisabled?: boolean;
};

export function AppShell({
  initialLibraries,
  initialProfile,
  initialBaseUrl = "",
  initialConnectionError = null,
  lockedBaseUrl = null,
  baseUrlHelp = null,
  submitDisabled = false,
}: AppShellProps) {
  const [libraries, setLibraries] = useState(initialLibraries);
  const [profile, setProfile] = useState(initialProfile);

  if (!profile) {
    return (
      <div className="app-shell">
        <ConnectionPanel
          initialBaseUrl={initialBaseUrl}
          initialError={initialConnectionError}
          baseUrlHelp={baseUrlHelp}
          baseUrlLocked={Boolean(lockedBaseUrl)}
          onConnected={(payload) => {
            setLibraries(payload.libraries);
            setProfile(payload.profile);
          }}
          submitDisabled={submitDisabled}
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
