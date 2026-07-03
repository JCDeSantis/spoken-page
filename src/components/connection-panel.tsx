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
      userId: string;
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
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [useToken, setUseToken] = useState(false);
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
          ...(useToken ? { token } : { username, password }),
        }),
      });

      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
        libraries?: Array<{ id: string; name: string; icon: string; mediaType: "book" | "podcast" }>;
        profile?: {
          userId: string;
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
      setPassword("");
      setToken("");
    });
  }

  return (
    <section className="panel panel-connection">
      <div className="panel-copy">
        <p className="eyebrow">Sign in</p>
        <h2>Use your Audiobookshelf account</h2>
        <p className="panel-description">
          Spoken Page sends these credentials directly to your configured Audiobookshelf server.
          Your password is never stored. This device receives a private session after login.
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

        {useToken ? (
          <label className="field">
            <span>API token</span>
            <input
              autoComplete="off"
              disabled={submitDisabled}
              onChange={(event) => setToken(event.target.value)}
              placeholder="Audiobookshelf API token"
              required
              type="password"
              value={token}
            />
            <small>Use this fallback for OpenID-only Audiobookshelf accounts.</small>
          </label>
        ) : (
          <>
            <label className="field">
              <span>Username</span>
              <input
                autoComplete="username"
                disabled={submitDisabled}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="Audiobookshelf username"
                required
                value={username}
              />
            </label>

            <label className="field">
              <span>Password</span>
              <input
                autoComplete="current-password"
                disabled={submitDisabled}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Audiobookshelf password"
                type="password"
                value={password}
              />
            </label>
          </>
        )}

        <button className="button button-secondary" onClick={() => setUseToken((current) => !current)} type="button">
          {useToken ? "Use username and password" : "Use an API token instead"}
        </button>

        <button
          className="button button-primary"
          disabled={isPending || submitDisabled}
          type="submit"
        >
          {isPending ? "Signing in..." : "Sign in"}
        </button>

        {error ? <p className="status-message status-error">{error}</p> : null}
      </form>
    </section>
  );
}
