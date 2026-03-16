"use client";

import { FormEvent, useState, useTransition } from "react";

type ConnectionPanelProps = {
  initialBaseUrl?: string;
  initialError?: string | null;
  baseUrlHelp?: string | null;
  baseUrlLocked?: boolean;
  onConnected: (payload: {
    libraries: Array<{ id: string; name: string; icon: string; mediaType: "book" | "podcast" }>;
    profile: {
      username: string;
      userType: string;
      serverVersion: string;
      userDefaultLibraryId?: string;
    };
  }) => void;
  submitDisabled?: boolean;
};

export function ConnectionPanel({
  initialBaseUrl = "",
  initialError = null,
  baseUrlHelp = null,
  baseUrlLocked = false,
  onConnected,
  submitDisabled = false,
}: ConnectionPanelProps) {
  const [serverUrl, setServerUrl] = useState(initialBaseUrl);
  const [token, setToken] = useState("");
  const [error, setError] = useState(initialError);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    startTransition(async () => {
      const response = await fetch("/api/connection", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          baseUrl: serverUrl,
          token,
        }),
      });

      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
        libraries?: Array<{ id: string; name: string; icon: string; mediaType: "book" | "podcast" }>;
        profile?: {
          username: string;
          userType: string;
          serverVersion: string;
          userDefaultLibraryId?: string;
        };
      };

      if (!response.ok || !payload.ok || !payload.libraries || !payload.profile) {
        setError(payload.error ?? "Could not connect to Audiobookshelf.");
        return;
      }

      onConnected({
        libraries: payload.libraries,
        profile: payload.profile,
      });
      setToken("");
    });
  }

  return (
    <section className="panel panel-connection">
      <div className="panel-copy">
        <p className="eyebrow">Connect</p>
        <h2>Point the web app at your Audiobookshelf server</h2>
        <p className="panel-description">
          The token is stored in a signed httpOnly cookie on this site, then every playback
          request is proxied through Next.js so the browser never has to call Audiobookshelf
          directly.
        </p>
      </div>

      <form className="connection-form" onSubmit={handleSubmit}>
        <label className="field">
          <span>Server URL</span>
          <input
            autoComplete="url"
            disabled={baseUrlLocked || submitDisabled}
            inputMode="url"
            onChange={(event) => setServerUrl(event.target.value)}
            placeholder="https://abs.example.com"
            required
            value={serverUrl}
          />

          {baseUrlHelp ? <small>{baseUrlHelp}</small> : null}
        </label>

        <label className="field">
          <span>API token</span>
          <input
            autoComplete="off"
            disabled={submitDisabled}
            onChange={(event) => setToken(event.target.value)}
            placeholder="Paste your Audiobookshelf user token"
            required
            type="password"
            value={token}
          />
        </label>

        <button
          className="button button-primary"
          disabled={isPending || submitDisabled}
          type="submit"
        >
          {isPending ? "Connecting..." : "Connect server"}
        </button>

        {error ? <p className="status-message status-error">{error}</p> : null}
      </form>
    </section>
  );
}
