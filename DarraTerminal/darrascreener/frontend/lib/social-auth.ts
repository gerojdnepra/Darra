"use client";

import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";

export interface SocialAuthUser {
  firebaseUid: string;
  id: string;
  email: string;
  name: string;
  photoUrl: string;
  provider: string;
  emailVerified: boolean;
}

export interface SocialAuthConfiguration {
  googleEnabled: boolean;
  facebookEnabled: boolean;
  appleEnabled: boolean;
  telegramEnabled: boolean;
  useEmulator: boolean;
  redirectUri: string;
  brokerBaseUrl: string;
  initializationError: string;
}

export interface SocialAuthSession {
  nativePlatform: boolean;
  authenticated: boolean;
  configuration: SocialAuthConfiguration;
  user: SocialAuthUser | null;
}

export type SocialProvider = "google" | "facebook" | "apple" | "telegram";

interface SocialAuthPlugin {
  getSession(): Promise<SocialAuthSession>;
  signInWithGoogle(): Promise<SocialAuthSession>;
  signInWithFacebook(): Promise<SocialAuthSession>;
  signInWithApple(): Promise<SocialAuthSession>;
  signInWithTelegram(): Promise<SocialAuthSession>;
  signOut(): Promise<SocialAuthSession>;
  addListener(
    eventName: "authStateChange",
    listenerFunc: (session: SocialAuthSession) => void
  ): Promise<PluginListenerHandle>;
}

const SocialAuth = registerPlugin<SocialAuthPlugin>("SocialAuth");

const browserFallbackSession: SocialAuthSession = {
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

const isNativeSocialAuthAvailable = (): boolean => Capacitor.getPlatform() === "android";

const normalizeSession = (session: SocialAuthSession | undefined | null): SocialAuthSession =>
  session
    ? {
        ...browserFallbackSession,
        ...session,
        configuration: {
          ...browserFallbackSession.configuration,
          ...session.configuration
        },
        user: session.user ?? null
      }
    : browserFallbackSession;

export const getSocialAuthSession = async (): Promise<SocialAuthSession> => {
  if (!isNativeSocialAuthAvailable()) {
    return browserFallbackSession;
  }

  try {
    return normalizeSession(await SocialAuth.getSession());
  } catch (error) {
    return {
      ...browserFallbackSession,
      nativePlatform: true,
      configuration: {
        ...browserFallbackSession.configuration,
        initializationError: error instanceof Error ? error.message : "Native auth plugin is unavailable."
      }
    };
  }
};

export const subscribeToSocialAuth = async (
  listener: (session: SocialAuthSession) => void
): Promise<PluginListenerHandle | null> => {
  if (!isNativeSocialAuthAvailable()) {
    return null;
  }

  try {
    return await SocialAuth.addListener("authStateChange", (session) => {
      listener(normalizeSession(session));
    });
  } catch {
    return null;
  }
};

export const signInWithProvider = async (provider: SocialProvider): Promise<SocialAuthSession> => {
  if (!isNativeSocialAuthAvailable()) {
    throw new Error("Native social auth is available only in the Android build.");
  }

  switch (provider) {
    case "google":
      return normalizeSession(await SocialAuth.signInWithGoogle());
    case "facebook":
      return normalizeSession(await SocialAuth.signInWithFacebook());
    case "apple":
      return normalizeSession(await SocialAuth.signInWithApple());
    case "telegram":
      return normalizeSession(await SocialAuth.signInWithTelegram());
  }
};

export const signOutFromSocialAuth = async (): Promise<SocialAuthSession> => {
  if (!isNativeSocialAuthAvailable()) {
    return browserFallbackSession;
  }

  return normalizeSession(await SocialAuth.signOut());
};
