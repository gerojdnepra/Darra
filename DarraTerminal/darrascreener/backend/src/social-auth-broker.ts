import { createHash, randomUUID } from "node:crypto";
import type { Express, Request, Response } from "express";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import jwt, { type JwtHeader, type JwtPayload } from "jsonwebtoken";
import jwkToPem from "jwk-to-pem";
import { config } from "./config";

type ProviderName = "apple" | "telegram";

interface BrokerProfile {
  providerUserId: string;
  email: string | undefined;
  name: string | undefined;
  photoUrl: string | undefined;
}

interface PendingAuthorization {
  provider: ProviderName;
  appState: string;
  appRedirectUri: string;
  appCodeChallenge: string;
  appScope: string;
  providerState: string;
  providerCodeVerifier: string;
  upstreamNonce: string;
  locale: string | undefined;
  createdAt: number;
}

interface IssuedBrokerCode {
  provider: ProviderName;
  appRedirectUri: string;
  appCodeChallenge: string;
  profile: BrokerProfile;
  createdAt: number;
}

interface VerifiedJwtPayload extends JwtPayload {
  nonce?: string;
  email?: string;
  name?: string;
  preferred_username?: string;
  picture?: string;
  phone_number?: string;
}

interface JwkCacheEntry {
  expiresAt: number;
  keys: Array<Record<string, unknown>>;
}

const pendingAuthorizations = new Map<string, PendingAuthorization>();
const issuedBrokerCodes = new Map<string, IssuedBrokerCode>();
const jwkCache = new Map<string, JwkCacheEntry>();
const brokerStateTtlMs = 10 * 60_000;
const brokerCodeTtlMs = 5 * 60_000;

const mockProfiles: Record<ProviderName, BrokerProfile> = {
  apple: {
    providerUserId: "apple-demo-user",
    email: "apple.demo@scalpstation.local",
    name: "Apple Demo",
    photoUrl: undefined
  },
  telegram: {
    providerUserId: "telegram-demo-user",
    email: "telegram.demo@scalpstation.local",
    name: "Telegram Demo",
    photoUrl: "https://placehold.co/96x96/png"
  }
};

let adminAuthClient: Auth | null = null;

export const registerSocialAuthRoutes = (app: Express): void => {
  app.get("/.well-known/assetlinks.json", (_request, response) => {
    response.json(buildAssetLinksPayload());
  });

  app.get("/oauth/:provider/authorize", async (request, response) => {
    try {
      cleanupExpiredBrokerState();
      const provider = parseProvider(request.params.provider);
      const authorization = createPendingAuthorization(provider, request);

      if (config.authBrokerMode === "emulator") {
        pendingAuthorizations.set(authorization.providerState, authorization);
        response.type("html").send(renderMockConsentPage(provider, authorization.providerState));
        return;
      }

      pendingAuthorizations.set(authorization.providerState, authorization);
      response.redirect(buildProviderAuthorizationUrl(authorization));
    } catch (error) {
      sendBrokerError(response, error, 400);
    }
  });

  app.get("/oauth/:provider/mock/approve", (request, response) => {
    try {
      const provider = parseProvider(request.params.provider);
      const providerState = requiredString(request.query.state, "Missing broker state.");
      const authorization = consumePendingAuthorization(providerState, provider);
      const code = issueBrokerCode(authorization, mockProfiles[provider]);
      response.redirect(buildAppRedirectUri(authorization.appRedirectUri, authorization.appState, { code }));
    } catch (error) {
      sendBrokerError(response, error, 400);
    }
  });

  app.get("/oauth/:provider/mock/cancel", (request, response) => {
    try {
      const provider = parseProvider(request.params.provider);
      const providerState = requiredString(request.query.state, "Missing broker state.");
      const authorization = consumePendingAuthorization(providerState, provider);
      response.redirect(
        buildAppRedirectUri(authorization.appRedirectUri, authorization.appState, {
          error: "access_denied",
          error_description: "User cancelled the mock authorization flow."
        })
      );
    } catch (error) {
      sendBrokerError(response, error, 400);
    }
  });

  app.get("/oauth/:provider/callback", async (request, response) => {
    await handleProviderCallback(request, response);
  });

  app.post("/oauth/:provider/callback", async (request, response) => {
    await handleProviderCallback(request, response);
  });

  app.post("/oauth/:provider/token", async (request, response) => {
    try {
      cleanupExpiredBrokerState();
      const provider = parseProvider(request.params.provider);
      const tokenCode = requiredBodyValue(request.body?.code, "Missing broker code.");
      const redirectUri = requiredBodyValue(request.body?.redirect_uri, "Missing redirect_uri.");
      const codeVerifier = requiredBodyValue(request.body?.code_verifier, "Missing code_verifier.");
      const issuedCode = consumeIssuedBrokerCode(tokenCode, provider);

      if (issuedCode.appRedirectUri !== redirectUri) {
        throw new Error("redirect_uri mismatch.");
      }

      if (deriveCodeChallenge(codeVerifier) !== issuedCode.appCodeChallenge) {
        throw new Error("PKCE verification failed.");
      }

      const customToken = await createFirebaseCustomToken(provider, issuedCode.profile);
      response.json({
        access_token: customToken,
        token_type: "Bearer",
        expires_in: 3600,
        provider,
        provider_user_id: issuedCode.profile.providerUserId,
        email: issuedCode.profile.email ?? "",
        name: issuedCode.profile.name ?? "",
        photo_url: issuedCode.profile.photoUrl ?? ""
      });
    } catch (error) {
      sendBrokerError(response, error, 400);
    }
  });
};

const handleProviderCallback = async (request: Request, response: Response): Promise<void> => {
  let authorization: PendingAuthorization | null = null;

  try {
    cleanupExpiredBrokerState();
    const provider = parseProvider(request.params.provider);
    const state = readProviderCallbackValue(request, "state");
    authorization = consumePendingAuthorization(state, provider);

    const providerError = readProviderCallbackValue(request, "error");
    if (providerError) {
      response.redirect(
        buildAppRedirectUri(authorization.appRedirectUri, authorization.appState, {
          error: providerError,
          error_description:
            readProviderCallbackValue(request, "error_description") || "Provider rejected the request."
        })
      );
      return;
    }

    const profile = await exchangeProviderAuthorizationCode(provider, authorization, request);
    const code = issueBrokerCode(authorization, profile);
    response.redirect(buildAppRedirectUri(authorization.appRedirectUri, authorization.appState, { code }));
  } catch (error) {
    if (authorization != null) {
      response.redirect(
        buildAppRedirectUri(authorization.appRedirectUri, authorization.appState, {
          error: "authorization_failed",
          error_description: error instanceof Error ? error.message : "Provider callback failed."
        })
      );
      return;
    }

    sendBrokerError(response, error, 400);
  }
};

const createPendingAuthorization = (provider: ProviderName, request: Request): PendingAuthorization => {
  if (!config.authAllowedRedirectUris.length) {
    throw new Error("AUTH_APP_ALLOWED_REDIRECT_URIS is empty.");
  }

  const redirectUri = requiredString(request.query.redirect_uri, "Missing redirect_uri.");
  if (!config.authAllowedRedirectUris.includes(redirectUri)) {
    throw new Error("redirect_uri is not allowed.");
  }

  const responseType = requiredString(request.query.response_type, "Missing response_type.");
  if (responseType !== "code") {
    throw new Error("Only response_type=code is supported.");
  }

  const challengeMethod = requiredString(
    request.query.code_challenge_method,
    "Missing code_challenge_method."
  );
  if (challengeMethod.toUpperCase() !== "S256") {
    throw new Error("Only PKCE S256 is supported.");
  }

  return {
    provider,
    appState: requiredString(request.query.state, "Missing state."),
    appRedirectUri: redirectUri,
    appCodeChallenge: requiredString(request.query.code_challenge, "Missing code_challenge."),
    appScope: optionalString(request.query.scope) ?? "",
    providerState: randomUUID(),
    providerCodeVerifier: randomPkceVerifier(),
    upstreamNonce: randomUUID(),
    locale: optionalString(request.query.locale),
    createdAt: Date.now()
  };
};

const buildProviderAuthorizationUrl = (authorization: PendingAuthorization): string => {
  if (authorization.provider === "telegram") {
    if (!config.telegramClientId || !config.telegramClientSecret || !config.telegramRedirectUri) {
      throw new Error("Telegram OIDC configuration is incomplete.");
    }

    return withQuery("https://oauth.telegram.org/auth", {
      client_id: config.telegramClientId,
      redirect_uri: config.telegramRedirectUri,
      response_type: "code",
      scope: authorization.appScope || "openid profile phone",
      state: authorization.providerState,
      nonce: authorization.upstreamNonce,
      code_challenge: deriveCodeChallenge(authorization.providerCodeVerifier),
      code_challenge_method: "S256"
    });
  }

  if (!config.appleClientId || !config.appleTeamId || !config.appleKeyId || !config.applePrivateKey) {
    throw new Error("Apple Sign In configuration is incomplete.");
  }

  return withQuery("https://appleid.apple.com/auth/authorize", {
    client_id: config.appleClientId,
    redirect_uri: config.appleRedirectUri,
    response_type: "code",
    response_mode: "form_post",
    scope: "name email",
    state: authorization.providerState,
    nonce: authorization.upstreamNonce
  });
};

const exchangeProviderAuthorizationCode = async (
  provider: ProviderName,
  authorization: PendingAuthorization,
  request: Request
): Promise<BrokerProfile> => {
  const code = readProviderCallbackValue(request, "code");
  if (!code) {
    throw new Error("Provider did not return an authorization code.");
  }

  if (provider === "telegram") {
    const tokenResponse = await postForm(
      "https://oauth.telegram.org/token",
      new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: config.telegramRedirectUri,
        client_id: config.telegramClientId,
        code_verifier: authorization.providerCodeVerifier
      }),
      {
        Authorization: `Basic ${Buffer.from(
          `${config.telegramClientId}:${config.telegramClientSecret}`,
          "utf8"
        ).toString("base64")}`
      }
    );

    const payload = await verifyJwt(requiredProviderToken(tokenResponse, "id_token"), {
      issuer: "https://oauth.telegram.org",
      audience: config.telegramClientId,
      jwksUri: "https://oauth.telegram.org/.well-known/jwks.json",
      nonce: authorization.upstreamNonce
    });

    return compactProfile({
      providerUserId: String(payload.sub ?? payload.id ?? ""),
      email: typeof payload.email === "string" ? payload.email : undefined,
      name:
        typeof payload.name === "string"
          ? payload.name
          : typeof payload.preferred_username === "string"
            ? payload.preferred_username
            : undefined,
      photoUrl: typeof payload.picture === "string" ? payload.picture : undefined
    });
  }

  const tokenResponse = await postForm(
    "https://appleid.apple.com/auth/token",
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: config.appleRedirectUri,
      client_id: config.appleClientId,
      client_secret: createAppleClientSecret()
    })
  );

  const payload = await verifyJwt(requiredProviderToken(tokenResponse, "id_token"), {
    issuer: "https://appleid.apple.com",
    audience: config.appleClientId,
    jwksUri: "https://appleid.apple.com/auth/keys",
    nonce: authorization.upstreamNonce
  });

  const userJson = readProviderCallbackValue(request, "user");
  const parsedUser = userJson ? safeJsonParse(userJson) : null;
  const firstName =
    parsedUser && typeof parsedUser === "object" && "name" in parsedUser
      ? safeNestedString(parsedUser, ["name", "firstName"])
      : "";
  const lastName =
    parsedUser && typeof parsedUser === "object" && "name" in parsedUser
      ? safeNestedString(parsedUser, ["name", "lastName"])
      : "";
  const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();

  return compactProfile({
    providerUserId: String(payload.sub ?? ""),
    email: typeof payload.email === "string" ? payload.email : undefined,
    name: fullName || undefined,
    photoUrl: undefined
  });
};

const createFirebaseCustomToken = async (
  provider: ProviderName,
  profile: BrokerProfile
): Promise<string> => {
  if (!profile.providerUserId) {
    throw new Error("Provider profile is missing a stable user identifier.");
  }

  if (config.authBrokerMode === "emulator") {
    return createEmulatorCustomToken(provider, profile.providerUserId);
  }

  const auth = getAdminAuthClient();
  let uid = `${provider}:${profile.providerUserId}`;

  if (profile.email) {
    try {
      const existing = await auth.getUserByEmail(profile.email);
      uid = existing.uid;
    } catch (error) {
      if (!isFirebaseAuthCode(error, "auth/user-not-found")) {
        throw error;
      }
    }
  }

  await upsertFirebaseUser(auth, uid, profile);
  return auth.createCustomToken(uid, {
    social_provider: provider,
    provider_user_id: profile.providerUserId
  });
};

const createEmulatorCustomToken = (provider: ProviderName, providerUserId: string): string => {
  const nowSeconds = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      aud: "https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit",
      iss: "firebase-auth-emulator@example.local",
      sub: "firebase-auth-emulator@example.local",
      iat: nowSeconds,
      exp: nowSeconds + 3600,
      uid: `${provider}:${providerUserId}`,
      claims: {
        social_provider: provider,
        provider_user_id: providerUserId
      }
    },
    "firebase-auth-emulator",
    { algorithm: "HS256" }
  );
};

const upsertFirebaseUser = async (auth: Auth, uid: string, profile: BrokerProfile): Promise<void> => {
  const userRecord = buildFirebaseUserRecord(uid, profile);

  try {
    await auth.updateUser(uid, userRecord);
    return;
  } catch (error) {
    if (!isFirebaseAuthCode(error, "auth/user-not-found")) {
      throw error;
    }
  }

  try {
    await auth.createUser(userRecord);
  } catch (error) {
    if (isFirebaseAuthCode(error, "auth/email-already-exists")) {
      await auth.createUser({
        uid,
        displayName: profile.name ?? null,
        photoURL: profile.photoUrl ?? null
      });
      return;
    }

    throw error;
  }
};

const getAdminAuthClient = (): Auth => {
  if (adminAuthClient) {
    return adminAuthClient;
  }

  if (!config.firebaseProjectId) {
    throw new Error("FIREBASE_PROJECT_ID is required for live custom token minting.");
  }

  if (!getApps().length) {
    if (config.firebaseServiceAccountJson) {
      const serviceAccount = JSON.parse(config.firebaseServiceAccountJson) as Record<string, string>;
      initializeApp({
        credential: cert({
          projectId: requiredProviderToken(serviceAccount, "project_id"),
          clientEmail: requiredProviderToken(serviceAccount, "client_email"),
          privateKey: requiredProviderToken(serviceAccount, "private_key")
        }),
        projectId: config.firebaseProjectId
      });
    } else if (config.firebaseClientEmail && config.firebasePrivateKey) {
      initializeApp({
        credential: cert({
          projectId: config.firebaseProjectId,
          clientEmail: config.firebaseClientEmail,
          privateKey: config.firebasePrivateKey
        }),
        projectId: config.firebaseProjectId
      });
    } else {
      initializeApp({
        projectId: config.firebaseProjectId
      });
    }
  }

  adminAuthClient = getAuth();
  return adminAuthClient;
};

const verifyJwt = async (
  token: string,
  options: {
    issuer: string;
    audience: string;
    jwksUri: string;
    nonce?: string;
  }
): Promise<VerifiedJwtPayload> => {
  const decoded = jwt.decode(token, { complete: true });
  if (!decoded || typeof decoded === "string") {
    throw new Error("Provider returned a malformed ID token.");
  }

  const header = decoded.header as JwtHeader;
  const keys = await fetchJwks(options.jwksUri);
  const jwk = keys.find((candidate) => candidate.kid === header.kid);
  if (!jwk) {
    throw new Error("Could not find a signing key for the provider ID token.");
  }

  const payload = jwt.verify(token, jwkToPem(jwk as unknown as Parameters<typeof jwkToPem>[0]), {
    algorithms: [((header.alg ?? "RS256") as jwt.Algorithm)],
    issuer: options.issuer,
    audience: options.audience
  }) as VerifiedJwtPayload;

  if (options.nonce && payload.nonce !== options.nonce) {
    throw new Error("ID token nonce mismatch.");
  }

  return payload;
};

const fetchJwks = async (jwksUri: string): Promise<Array<Record<string, unknown>>> => {
  const cached = jwkCache.get(jwksUri);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.keys;
  }

  const response = await fetch(jwksUri);
  if (!response.ok) {
    throw new Error(`Could not download JWKS from ${jwksUri}.`);
  }

  const payload = (await response.json()) as { keys?: Array<Record<string, unknown>> };
  const keys = Array.isArray(payload.keys) ? payload.keys : [];
  jwkCache.set(jwksUri, { keys, expiresAt: Date.now() + 60 * 60_000 });
  return keys;
};

const createAppleClientSecret = (): string =>
  jwt.sign(
    {},
    config.applePrivateKey,
    {
      algorithm: "ES256",
      issuer: config.appleTeamId,
      subject: config.appleClientId,
      audience: "https://appleid.apple.com",
      expiresIn: "180d",
      keyid: config.appleKeyId
    }
  );

const buildAssetLinksPayload = (): Array<Record<string, unknown>> =>
  config.androidAppSha256Fingerprints.length
    ? [
        {
          relation: ["delegate_permission/common.handle_all_urls"],
          target: {
            namespace: "android_app",
            package_name: config.androidAppPackage,
            sha256_cert_fingerprints: config.androidAppSha256Fingerprints
          }
        }
      ]
    : [];

const issueBrokerCode = (authorization: PendingAuthorization, profile: BrokerProfile): string => {
  const code = randomUUID();
  issuedBrokerCodes.set(code, {
    provider: authorization.provider,
    appRedirectUri: authorization.appRedirectUri,
    appCodeChallenge: authorization.appCodeChallenge,
    profile,
    createdAt: Date.now()
  });
  return code;
};

const consumePendingAuthorization = (
  providerState: string,
  expectedProvider: ProviderName
): PendingAuthorization => {
  const authorization = pendingAuthorizations.get(providerState);
  if (!authorization || authorization.provider !== expectedProvider) {
    throw new Error("Authorization state was not found or has expired.");
  }

  pendingAuthorizations.delete(providerState);
  return authorization;
};

const consumeIssuedBrokerCode = (code: string, expectedProvider: ProviderName): IssuedBrokerCode => {
  const brokerCode = issuedBrokerCodes.get(code);
  if (!brokerCode || brokerCode.provider !== expectedProvider) {
    throw new Error("Broker code was not found or has expired.");
  }

  issuedBrokerCodes.delete(code);
  return brokerCode;
};

const cleanupExpiredBrokerState = (): void => {
  const now = Date.now();

  for (const [state, authorization] of pendingAuthorizations.entries()) {
    if (authorization.createdAt + brokerStateTtlMs <= now) {
      pendingAuthorizations.delete(state);
    }
  }

  for (const [code, issuedCode] of issuedBrokerCodes.entries()) {
    if (issuedCode.createdAt + brokerCodeTtlMs <= now) {
      issuedBrokerCodes.delete(code);
    }
  }
};

const buildAppRedirectUri = (
  redirectUri: string,
  state: string,
  payload: Record<string, string>
): string => {
  const target = new URL(redirectUri);
  target.searchParams.set("state", state);

  for (const [key, value] of Object.entries(payload)) {
    target.searchParams.set(key, value);
  }

  return target.toString();
};

const renderMockConsentPage = (provider: ProviderName, state: string): string => `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Scalp Station ${provider} mock sign-in</title>
    <style>
      body { font-family: Arial, sans-serif; background: #0b1017; color: #f8fafc; margin: 0; padding: 24px; }
      .card { max-width: 520px; margin: 0 auto; border: 1px solid rgba(255,255,255,.12); border-radius: 20px; padding: 24px; background: rgba(15,23,42,.92); }
      .tag { display: inline-block; font-size: 12px; letter-spacing: .18em; text-transform: uppercase; color: #38bdf8; }
      h1 { margin: 12px 0 8px; font-size: 28px; }
      p { color: #94a3b8; line-height: 1.5; }
      .actions { display: flex; gap: 12px; margin-top: 20px; }
      a { text-decoration: none; padding: 12px 16px; border-radius: 12px; font-weight: 600; }
      .approve { background: #0ea5e9; color: #00131d; }
      .cancel { background: rgba(255,255,255,.08); color: #e2e8f0; }
    </style>
  </head>
  <body>
    <div class="card">
      <div class="tag">Firebase Emulator</div>
      <h1>${provider === "apple" ? "Apple" : "Telegram"} mock authorization</h1>
      <p>This development-only page simulates the provider consent screen while your Android app talks to the Firebase Auth Emulator.</p>
      <div class="actions">
        <a class="approve" href="/oauth/${provider}/mock/approve?state=${encodeURIComponent(state)}">Continue</a>
        <a class="cancel" href="/oauth/${provider}/mock/cancel?state=${encodeURIComponent(state)}">Cancel</a>
      </div>
    </div>
  </body>
</html>`;

const postForm = async (
  url: string,
  form: URLSearchParams,
  headers: Record<string, string> = {}
): Promise<Record<string, string>> => {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      ...headers
    },
    body: form.toString()
  });

  const payload = (await response.json().catch(() => ({}))) as Record<string, string>;
  if (!response.ok) {
    throw new Error(payload.error_description || payload.error || `Provider token request failed with ${response.status}.`);
  }

  return payload;
};

const withQuery = (baseUrl: string, params: Record<string, string>): string => {
  const url = new URL(baseUrl);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  return url.toString();
};

const deriveCodeChallenge = (codeVerifier: string): string =>
  createHash("sha256").update(codeVerifier, "utf8").digest("base64url");

const randomPkceVerifier = (): string =>
  createHash("sha256").update(randomUUID(), "utf8").digest("base64url");

const parseProvider = (providerParam: unknown): ProviderName => {
  if (providerParam === "apple" || providerParam === "telegram") {
    return providerParam;
  }

  throw new Error("Unsupported provider.");
};

const readProviderCallbackValue = (request: Request, key: string): string => {
  const bodyValue = request.body?.[key];
  if (typeof bodyValue === "string" && bodyValue.trim()) {
    return bodyValue.trim();
  }

  const queryValue = request.query[key];
  if (typeof queryValue === "string" && queryValue.trim()) {
    return queryValue.trim();
  }

  return "";
};

const requiredString = (value: unknown, message: string): string => {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(message);
  }

  return value.trim();
};

const optionalString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const requiredBodyValue = (value: unknown, message: string): string => requiredString(value, message);

const safeJsonParse = (value: string): unknown => {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
};

const safeNestedString = (value: unknown, path: string[]): string => {
  let cursor: unknown = value;

  for (const segment of path) {
    if (!cursor || typeof cursor !== "object" || !(segment in cursor)) {
      return "";
    }

    cursor = (cursor as Record<string, unknown>)[segment];
  }

  return typeof cursor === "string" ? cursor : "";
};

const isFirebaseAuthCode = (error: unknown, code: string): boolean =>
  !!error &&
  typeof error === "object" &&
  "code" in error &&
  (error as { code?: string }).code === code;

const sendBrokerError = (response: Response, error: unknown, status: number): void => {
  response.status(status).json({
    error: "broker_error",
    message: error instanceof Error ? error.message : "Unknown broker failure."
  });
};

const requiredProviderToken = (
  source: Record<string, string> | Record<string, unknown>,
  key: string
): string => {
  const value = source[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Provider response is missing ${key}.`);
  }

  return value.trim();
};

const compactProfile = (profile: BrokerProfile): BrokerProfile => ({
  providerUserId: profile.providerUserId,
  email: profile.email,
  name: profile.name,
  photoUrl: profile.photoUrl
});

const buildFirebaseUserRecord = (
  uid: string,
  profile: BrokerProfile
): {
  uid: string;
  email?: string;
  displayName?: string | null;
  photoURL?: string | null;
} => {
  const record: {
    uid: string;
    email?: string;
    displayName?: string | null;
    photoURL?: string | null;
  } = { uid };

  if (profile.email) {
    record.email = profile.email;
  }

  if (profile.name) {
    record.displayName = profile.name;
  }

  if (profile.photoUrl) {
    record.photoURL = profile.photoUrl;
  }

  return record;
};
