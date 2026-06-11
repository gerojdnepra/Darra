"use client";

import type { HTMLAttributes, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  getSocialAuthSession,
  signInWithProvider,
  signOutFromSocialAuth,
  subscribeToSocialAuth,
  type SocialAuthSession,
  type SocialProvider
} from "@/lib/social-auth";

type ProviderCard = {
  provider: SocialProvider;
  label: string;
  detail: string;
};

const providerCards: ProviderCard[] = [
  {
    provider: "google",
    label: "Войти через Google",
    detail: "Credential Manager + Firebase ID token"
  },
  {
    provider: "facebook",
    label: "Войти через Facebook",
    detail: "Native Meta Login + Firebase credential"
  },
  {
    provider: "telegram",
    label: "Войти через Telegram",
    detail: "OIDC/PKCE broker + Firebase custom token"
  },
  {
    provider: "apple",
    label: "Войти через Apple",
    detail: "OAuth broker + PKCE + Firebase custom token"
  }
];

const initialSession: SocialAuthSession = {
  nativePlatform: false,
  authenticated: false,
  user: null,
  configuration: {
    googleEnabled: false,
    facebookEnabled: false,
    appleEnabled: false,
    telegramEnabled: false,
    useEmulator: false,
    redirectUri: "",
    brokerBaseUrl: "",
    initializationError: ""
  }
};

const providerEnabled = (session: SocialAuthSession, provider: SocialProvider): boolean => {
  switch (provider) {
    case "google":
      return session.configuration.googleEnabled;
    case "facebook":
      return session.configuration.facebookEnabled;
    case "apple":
      return session.configuration.appleEnabled;
    case "telegram":
      return session.configuration.telegramEnabled;
  }
};

const providerBadge = (provider: SocialProvider): string => {
  switch (provider) {
    case "google":
      return "G";
    case "facebook":
      return "f";
    case "apple":
      return "A";
    case "telegram":
      return "T";
  }
};

const providerHint = (session: SocialAuthSession, provider: SocialProvider): string | null => {
  if (!session.nativePlatform) {
    return "Только в Android APK";
  }

  if (provider === "facebook" && session.configuration.useEmulator) {
    return "Firebase Emulator не принимает Facebook access token";
  }

  if (!providerEnabled(session, provider)) {
    return "Нет конфигурации";
  }

  return null;
};

interface SocialAuthPanelProps {
  dragHandle?: ReactNode;
  resizeFrame?: ReactNode;
  panelProps?: HTMLAttributes<HTMLElement>;
}

export function SocialAuthPanel({
  dragHandle,
  resizeFrame,
  panelProps
}: SocialAuthPanelProps = {}) {
  const [session, setSession] = useState<SocialAuthSession>(initialSession);
  const [loading, setLoading] = useState(true);
  const [pendingProvider, setPendingProvider] = useState<SocialProvider | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const hydrate = async () => {
      const nextSession = await getSocialAuthSession();
      if (cancelled) {
        return;
      }

      setSession(nextSession);
      setLoading(false);
    };

    void hydrate();

    let listenerHandle: { remove: () => Promise<void> } | null = null;
    void subscribeToSocialAuth((nextSession) => {
      setSession(nextSession);
      setLoading(false);
    }).then((handle) => {
      listenerHandle = handle;
    });

    return () => {
      cancelled = true;
      void listenerHandle?.remove();
    };
  }, []);

  const statusCopy = useMemo(() => {
    if (loading) {
      return "Проверяем состояние Firebase Auth...";
    }

    if (!session.nativePlatform) {
      return "В браузере доступен только UI-превью. Реальный social sign-in работает в Android APK.";
    }

    if (session.configuration.initializationError) {
      return session.configuration.initializationError;
    }

    if (session.authenticated) {
      return session.configuration.useEmulator
        ? "Авторизация идёт через Firebase Auth Emulator."
        : "Пользователь аутентифицирован, профиль готов для подписки и server-side checks.";
    }

    return session.configuration.useEmulator
      ? "Firebase Auth Emulator включён. Google/Apple/Telegram можно гонять локально, Facebook ограничен самим emulator."
      : "Авторизуйте пользователя нативным потоком без WebView, чтобы привязать профиль к оплате подписки.";
  }, [loading, session]);

  const handleSignIn = async (provider: SocialProvider) => {
    setErrorMessage(null);
    setPendingProvider(provider);

    try {
      const nextSession = await signInWithProvider(provider);
      setSession(nextSession);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Не удалось завершить вход.");
    } finally {
      setPendingProvider(null);
    }
  };

  const handleSignOut = async () => {
    setErrorMessage(null);
    setPendingProvider("google");

    try {
      const nextSession = await signOutFromSocialAuth();
      setSession(nextSession);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Не удалось выйти из аккаунта.");
    } finally {
      setPendingProvider(null);
    }
  };

  const { className: panelClassName, ...restPanelProps } = panelProps ?? {};

  return (
    <section
      id="social-auth"
      {...restPanelProps}
      className={`swipe-page order-[32] rounded-lg border border-white/10 bg-panel p-4 shadow-panel ${panelClassName ?? ""}`}
    >
      {resizeFrame}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl">
          <div className="text-[10px] uppercase tracking-[0.24em] text-accent">Account Access</div>
          <h2 className="mt-1 text-xl font-semibold text-white">Firebase social auth для подписок</h2>
          <p className="mt-2 text-sm text-slate-400">{statusCopy}</p>
        </div>

        <div className="flex flex-wrap items-start justify-end gap-2">
          {dragHandle}

          {session.user ? (
            <div className="rounded-2xl border border-positive/20 bg-positive/10 px-4 py-3 text-sm text-slate-100">
              <div className="text-[10px] uppercase tracking-[0.18em] text-positive">
                {session.user.provider}
              </div>
              <div className="mt-1 font-medium text-white">
                {session.user.name || session.user.email || session.user.id}
              </div>
              <div className="mt-1 text-xs text-slate-300">
                UID {session.user.firebaseUid.slice(0, 10)}...
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {session.user ? (
        <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <div className="grid gap-2 rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-slate-300 md:grid-cols-3">
            <ProfileMetric label="ID" value={session.user.id || "-"} />
            <ProfileMetric label="Email" value={session.user.email || "-"} />
            <ProfileMetric label="Имя" value={session.user.name || "-"} />
          </div>

          <button
            type="button"
            onClick={() => void handleSignOut()}
            disabled={pendingProvider !== null}
            className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-slate-100 transition hover:border-accent/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            Выйти
          </button>
        </div>
      ) : (
        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {providerCards.map((item) => {
            const hint = providerHint(session, item.provider);
            const disabled = pendingProvider !== null || hint !== null;

            return (
              <button
                key={item.provider}
                type="button"
                onClick={() => void handleSignIn(item.provider)}
                disabled={disabled}
                className="group rounded-2xl border border-white/10 bg-black/20 p-4 text-left transition hover:border-accent/35 hover:bg-accent/5 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-accent/20 bg-accent/10 text-lg font-semibold text-accent">
                    {providerBadge(item.provider)}
                  </div>
                  <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
                    {pendingProvider === item.provider ? "Запуск..." : item.provider}
                  </div>
                </div>

                <div className="mt-4 text-base font-medium text-white">{item.label}</div>
                <div className="mt-1 text-sm text-slate-400">{item.detail}</div>
                <div className="mt-3 text-[11px] text-slate-500">{hint ?? "OAuth 2.0 / PKCE / system browser"}</div>
              </button>
            );
          })}
        </div>
      )}

      {errorMessage ? (
        <div className="mt-4 rounded-xl border border-negative/30 bg-negative/10 px-4 py-3 text-sm text-negative">
          {errorMessage}
        </div>
      ) : null}

      <div className="mt-4 grid gap-2 text-[11px] text-slate-500 lg:grid-cols-3">
        <MetaChip label="Redirect URI" value={session.configuration.redirectUri || "not set"} />
        <MetaChip
          label="Broker"
          value={session.configuration.brokerBaseUrl || "required for Apple/Telegram"}
        />
        <MetaChip
          label="Mode"
          value={session.configuration.useEmulator ? "Firebase Emulator" : "Production Firebase"}
        />
      </div>
    </section>
  );
}

function ProfileMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="truncate text-[10px] uppercase tracking-[0.16em] text-slate-500">{label}</div>
      <div className="mt-1 truncate text-sm font-medium text-slate-100">{value}</div>
    </div>
  );
}

function MetaChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-full border border-white/10 bg-white/5 px-3 py-2">
      <span className="mr-2 uppercase tracking-[0.12em] text-slate-500">{label}</span>
      <span className="text-slate-300">{value}</span>
    </div>
  );
}
