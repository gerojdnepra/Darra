package com.troesh.scalpstation;

final class SocialAuthConfig {
    final String firebaseApiKey;
    final String firebaseAppId;
    final String firebaseProjectId;
    final String firebaseMessagingSenderId;
    final String firebaseStorageBucket;
    final String googleWebClientId;
    final String facebookAppId;
    final String facebookClientToken;
    final String brokerBaseUrl;
    final String redirectUri;
    final boolean useEmulator;
    final String emulatorHost;
    final int emulatorPort;

    private SocialAuthConfig(
        String firebaseApiKey,
        String firebaseAppId,
        String firebaseProjectId,
        String firebaseMessagingSenderId,
        String firebaseStorageBucket,
        String googleWebClientId,
        String facebookAppId,
        String facebookClientToken,
        String brokerBaseUrl,
        String redirectUri,
        boolean useEmulator,
        String emulatorHost,
        int emulatorPort
    ) {
        this.firebaseApiKey = normalize(firebaseApiKey);
        this.firebaseAppId = normalize(firebaseAppId);
        this.firebaseProjectId = normalize(firebaseProjectId);
        this.firebaseMessagingSenderId = normalize(firebaseMessagingSenderId);
        this.firebaseStorageBucket = normalize(firebaseStorageBucket);
        this.googleWebClientId = normalize(googleWebClientId);
        this.facebookAppId = normalize(facebookAppId);
        this.facebookClientToken = normalize(facebookClientToken);
        this.brokerBaseUrl = trimTrailingSlash(normalize(brokerBaseUrl));
        this.redirectUri = normalize(redirectUri);
        this.useEmulator = useEmulator;
        this.emulatorHost = normalize(emulatorHost);
        this.emulatorPort = emulatorPort;
    }

    static SocialAuthConfig fromBuildConfig() {
        return new SocialAuthConfig(
            BuildConfig.SOCIAL_AUTH_FIREBASE_API_KEY,
            BuildConfig.SOCIAL_AUTH_FIREBASE_APP_ID,
            BuildConfig.SOCIAL_AUTH_FIREBASE_PROJECT_ID,
            BuildConfig.SOCIAL_AUTH_FIREBASE_MESSAGING_SENDER_ID,
            BuildConfig.SOCIAL_AUTH_FIREBASE_STORAGE_BUCKET,
            BuildConfig.SOCIAL_AUTH_GOOGLE_WEB_CLIENT_ID,
            BuildConfig.SOCIAL_AUTH_FACEBOOK_APP_ID,
            BuildConfig.SOCIAL_AUTH_FACEBOOK_CLIENT_TOKEN,
            BuildConfig.SOCIAL_AUTH_BROKER_BASE_URL,
            BuildConfig.SOCIAL_AUTH_REDIRECT_URI,
            BuildConfig.SOCIAL_AUTH_USE_EMULATOR,
            BuildConfig.SOCIAL_AUTH_EMULATOR_HOST,
            BuildConfig.SOCIAL_AUTH_EMULATOR_PORT
        );
    }

    boolean hasManualFirebaseConfig() {
        return !firebaseApiKey.isEmpty() &&
            !firebaseAppId.isEmpty() &&
            !firebaseProjectId.isEmpty() &&
            !firebaseMessagingSenderId.isEmpty();
    }

    boolean hasGoogle() {
        return !googleWebClientId.isEmpty();
    }

    boolean hasFacebook() {
        return !facebookAppId.isEmpty();
    }

    boolean hasBroker() {
        return !brokerBaseUrl.isEmpty() && !redirectUri.isEmpty();
    }

    boolean hasApple() {
        return hasBroker();
    }

    boolean hasTelegram() {
        return hasBroker();
    }

    private static String normalize(String value) {
        return value == null ? "" : value.trim();
    }

    private static String trimTrailingSlash(String value) {
        if (value.isEmpty()) {
            return value;
        }

        return value.endsWith("/") ? value.substring(0, value.length() - 1) : value;
    }
}
