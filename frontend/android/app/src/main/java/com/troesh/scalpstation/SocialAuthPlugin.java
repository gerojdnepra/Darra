package com.troesh.scalpstation;

import android.content.Intent;
import android.net.Uri;
import android.text.TextUtils;
import android.util.Log;

import androidx.activity.result.ActivityResult;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.ContextCompat;
import androidx.credentials.ClearCredentialStateRequest;
import androidx.credentials.Credential;
import androidx.credentials.CredentialManager;
import androidx.credentials.GetCredentialRequest;
import androidx.credentials.GetCredentialResponse;
import androidx.credentials.CustomCredential;
import androidx.credentials.exceptions.ClearCredentialException;
import androidx.credentials.exceptions.GetCredentialException;
import androidx.credentials.exceptions.NoCredentialException;

import com.facebook.AccessToken;
import com.facebook.CallbackManager;
import com.facebook.FacebookCallback;
import com.facebook.FacebookException;
import com.facebook.login.LoginBehavior;
import com.facebook.login.LoginManager;
import com.facebook.login.LoginResult;
import com.getcapacitor.Bridge;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.tasks.OnFailureListener;
import com.google.android.gms.tasks.OnSuccessListener;
import com.google.android.libraries.identity.googleid.GetGoogleIdOption;
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential;
import com.google.firebase.FirebaseApp;
import com.google.firebase.auth.AuthCredential;
import com.google.firebase.auth.AuthResult;
import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.auth.FirebaseAuthException;
import com.google.firebase.auth.FirebaseUser;
import com.google.firebase.auth.GoogleAuthProvider;
import com.google.firebase.auth.FacebookAuthProvider;
import com.google.firebase.auth.OAuthProvider;
import com.google.firebase.auth.UserInfo;

import net.openid.appauth.AuthorizationException;
import net.openid.appauth.AuthorizationRequest;
import net.openid.appauth.AuthorizationResponse;
import net.openid.appauth.AuthorizationService;
import net.openid.appauth.AuthorizationServiceConfiguration;
import net.openid.appauth.CodeVerifierUtil;
import net.openid.appauth.ResponseTypeValues;
import net.openid.appauth.TokenResponse;

import java.util.Arrays;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Executor;

import org.json.JSONObject;

@CapacitorPlugin(name = "SocialAuth")
public class SocialAuthPlugin extends Plugin {
    private static final String LOG_TAG = "SocialAuthPlugin";
    private static final String PROVIDER_GOOGLE = "google";
    private static final String PROVIDER_FACEBOOK = "facebook";
    private static final String PROVIDER_APPLE = "apple";
    private static final String PROVIDER_TELEGRAM = "telegram";
    private static final String EVENT_AUTH_STATE = "authStateChange";

    private SocialAuthConfig config;
    private FirebaseAuth firebaseAuth;
    private CredentialManager credentialManager;
    private CallbackManager facebookCallbackManager;
    private AuthorizationService authorizationService;
    private Executor mainExecutor;
    private String initializationError;
    private boolean emulatorConfigured;
    private boolean facebookCallbackRegistered;
    private String pendingCallId;
    private String pendingProvider;
    private final FirebaseAuth.AuthStateListener authStateListener = auth ->
        notifyListeners(EVENT_AUTH_STATE, buildSessionPayload(auth.getCurrentUser(), null, null), true);

    @Override
    public void load() {
        super.load();
        config = SocialAuthConfig.fromBuildConfig();
        mainExecutor = ContextCompat.getMainExecutor(getContext());
        credentialManager = CredentialManager.create(getContext());
        facebookCallbackManager = CallbackManager.Factory.create();
        authorizationService = new AuthorizationService(getContext());

        try {
            FirebaseApp app = FirebaseAppInitializer.getOrCreate(getContext(), config);
            firebaseAuth = FirebaseAuth.getInstance(app);
            configureAuthEmulatorIfNeeded();
            firebaseAuth.addAuthStateListener(authStateListener);
        } catch (Exception exception) {
            initializationError = exception.getMessage();
        }
    }

    @PluginMethod
    public void getSession(PluginCall call) {
        call.resolve(buildSessionPayload(getCurrentUser(), null, null));
    }

    @PluginMethod
    public void signInWithGoogle(PluginCall call) {
        if (!ensureFirebaseReady(call, PROVIDER_GOOGLE) || !ensureProviderConfigured(call, PROVIDER_GOOGLE)) {
            return;
        }

        if (!beginPendingCall(call, PROVIDER_GOOGLE)) {
            return;
        }
        requestGoogleCredential(true);
    }

    @PluginMethod
    public void signInWithFacebook(PluginCall call) {
        if (!ensureFirebaseReady(call, PROVIDER_FACEBOOK) || !ensureProviderConfigured(call, PROVIDER_FACEBOOK)) {
            return;
        }

        if (config.useEmulator) {
            call.reject(
                "Firebase Authentication Emulator does not support Facebook access-token credentials. Disable the emulator for Facebook sign-in.",
                "emulator_not_supported"
            );
            return;
        }

        AppCompatActivity activity = getActivity();
        if (activity == null) {
            call.reject("Android activity is not available.", "activity_unavailable");
            return;
        }

        ensureFacebookCallbackRegistered();
        if (!beginPendingCall(call, PROVIDER_FACEBOOK)) {
            return;
        }
        LoginManager.getInstance().setLoginBehavior(LoginBehavior.NATIVE_WITH_FALLBACK);
        LoginManager.getInstance().logInWithReadPermissions(
            activity,
            Arrays.asList("public_profile", "email")
        );
    }

    @PluginMethod
    public void signInWithApple(PluginCall call) {
        if (!ensureFirebaseReady(call, PROVIDER_APPLE) || !ensureProviderConfigured(call, PROVIDER_APPLE)) {
            return;
        }

        startBrokerAuthorization(call, PROVIDER_APPLE, "name email");
    }

    @PluginMethod
    public void signInWithTelegram(PluginCall call) {
        if (!ensureFirebaseReady(call, PROVIDER_TELEGRAM) || !ensureProviderConfigured(call, PROVIDER_TELEGRAM)) {
            return;
        }

        startBrokerAuthorization(call, PROVIDER_TELEGRAM, "openid profile phone");
    }

    @PluginMethod
    public void signOut(PluginCall call) {
        if (firebaseAuth != null) {
            firebaseAuth.signOut();
        }

        LoginManager.getInstance().logOut();
        clearGoogleCredentialState();
        call.resolve(buildSessionPayload(null, null, null));
    }

    @ActivityCallback
    private void handleBrokerAuthorizationResult(PluginCall call, ActivityResult activityResult) {
        if (call == null) {
            clearPendingState();
            return;
        }

        Intent data = activityResult.getData();
        AuthorizationResponse authorizationResponse = AuthorizationResponse.fromIntent(data);
        AuthorizationException authorizationException = AuthorizationException.fromIntent(data);

        if (authorizationException != null) {
            rejectSavedCall(
                call,
                isUserCancellation(authorizationException) ? "cancelled" : "authorization_failed",
                buildAuthorizationErrorMessage(authorizationException)
            );
            return;
        }

        if (authorizationResponse == null) {
            rejectSavedCall(call, "authorization_failed", "Authorization response is empty.");
            return;
        }

        authorizationService.performTokenRequest(
            authorizationResponse.createTokenExchangeRequest(),
            (tokenResponse, tokenException) -> {
                if (tokenException != null) {
                    rejectSavedCall(
                        call,
                        "token_exchange_failed",
                        tokenException.errorDescription != null && !tokenException.errorDescription.isEmpty()
                            ? tokenException.errorDescription
                            : "Token exchange failed."
                    );
                    return;
                }

                if (tokenResponse == null || tokenResponse.accessToken == null || tokenResponse.accessToken.isEmpty()) {
                    rejectSavedCall(call, "token_exchange_failed", "Broker did not return a Firebase custom token.");
                    return;
                }

                authenticateWithCustomToken(tokenResponse, call, pendingProvider);
            }
        );
    }

    @Override
    protected void handleOnActivityResult(int requestCode, int resultCode, Intent data) {
        if (PROVIDER_FACEBOOK.equals(pendingProvider) && facebookCallbackManager != null) {
            facebookCallbackManager.onActivityResult(requestCode, resultCode, data);
            return;
        }

        super.handleOnActivityResult(requestCode, resultCode, data);
    }

    @Override
    protected void handleOnDestroy() {
        if (firebaseAuth != null) {
            firebaseAuth.removeAuthStateListener(authStateListener);
        }

        if (authorizationService != null) {
            authorizationService.dispose();
        }

        super.handleOnDestroy();
    }

    private boolean ensureFirebaseReady(PluginCall call, String provider) {
        if (firebaseAuth != null) {
            return true;
        }

        String message = initializationError == null || initializationError.isEmpty()
            ? "Firebase Authentication is not initialized."
            : initializationError;
        call.reject(message, provider + "_unavailable");
        return false;
    }

    private boolean ensureProviderConfigured(PluginCall call, String provider) {
        boolean configured;

        switch (provider) {
            case PROVIDER_GOOGLE:
                configured = config.hasGoogle();
                break;
            case PROVIDER_FACEBOOK:
                configured = config.hasFacebook();
                break;
            case PROVIDER_APPLE:
                configured = config.hasApple();
                break;
            case PROVIDER_TELEGRAM:
                configured = config.hasTelegram();
                break;
            default:
                configured = false;
                break;
        }

        if (configured) {
            return true;
        }

        call.reject(
            "Provider configuration is missing. Check ANDROID_FIREBASE_WEB_CLIENT_ID, ANDROID_FACEBOOK_* and ANDROID_AUTH_* values.",
            "provider_not_configured"
        );
        return false;
    }

    private void configureAuthEmulatorIfNeeded() {
        if (firebaseAuth == null || !config.useEmulator || emulatorConfigured) {
            return;
        }

        firebaseAuth.useEmulator(config.emulatorHost, config.emulatorPort);
        emulatorConfigured = true;
    }

    private void ensureFacebookCallbackRegistered() {
        if (facebookCallbackRegistered) {
            return;
        }

        LoginManager.getInstance().registerCallback(
            facebookCallbackManager,
            new FacebookCallback<LoginResult>() {
                @Override
                public void onSuccess(LoginResult loginResult) {
                    AccessToken accessToken = loginResult == null ? null : loginResult.getAccessToken();
                    if (accessToken == null) {
                        rejectPendingCall("authorization_failed", "Facebook did not return an access token.");
                        return;
                    }

                    AuthCredential credential = FacebookAuthProvider.getCredential(accessToken.getToken());
                    firebaseAuth.signInWithCredential(credential)
                        .addOnSuccessListener(authResult -> resolvePendingAuthResult(authResult, PROVIDER_FACEBOOK, null))
                        .addOnFailureListener(exception ->
                            rejectPendingCall("authentication_failed", buildFirebaseErrorMessage(exception))
                        );
                }

                @Override
                public void onCancel() {
                    rejectPendingCall("cancelled", "Facebook sign-in was cancelled.");
                }

                @Override
                public void onError(@NonNull FacebookException error) {
                    rejectPendingCall("authorization_failed", error.getMessage());
                }
            }
        );

        facebookCallbackRegistered = true;
    }

    private void requestGoogleCredential(boolean authorizedOnly) {
        AppCompatActivity activity = getActivity();
        if (activity == null) {
            rejectPendingCall("activity_unavailable", "Android activity is not available.");
            return;
        }

        // First we try previously authorized accounts for a fast one-tap flow.
        // If the device has no prior authorization, we automatically fall back
        // to the full account chooser on the next callback.
        GetGoogleIdOption option = new GetGoogleIdOption.Builder()
            .setServerClientId(config.googleWebClientId)
            .setFilterByAuthorizedAccounts(authorizedOnly)
            .setAutoSelectEnabled(authorizedOnly)
            .setNonce(UUID.randomUUID().toString())
            .build();

        GetCredentialRequest request = new GetCredentialRequest.Builder()
            .addCredentialOption(option)
            .build();

        credentialManager.getCredentialAsync(
            activity,
            request,
            null,
            mainExecutor,
            new androidx.credentials.CredentialManagerCallback<GetCredentialResponse, GetCredentialException>() {
                @Override
                public void onResult(GetCredentialResponse result) {
                    handleGoogleCredentialResponse(result);
                }

                @Override
                public void onError(@NonNull GetCredentialException error) {
                    if (authorizedOnly && error instanceof NoCredentialException) {
                        requestGoogleCredential(false);
                        return;
                    }

                    rejectPendingCall("authorization_failed", buildCredentialErrorMessage(error));
                }
            }
        );
    }

    private void handleGoogleCredentialResponse(GetCredentialResponse response) {
        Credential credential = response.getCredential();

        if (!(credential instanceof CustomCredential)) {
            rejectPendingCall("authorization_failed", "Google returned an unsupported credential type.");
            return;
        }

        CustomCredential customCredential = (CustomCredential) credential;
        if (!GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL.equals(customCredential.getType())) {
            rejectPendingCall("authorization_failed", "Google returned an unexpected credential payload.");
            return;
        }

        GoogleIdTokenCredential googleCredential = GoogleIdTokenCredential.createFrom(customCredential.getData());
        AuthCredential firebaseCredential = GoogleAuthProvider.getCredential(googleCredential.getIdToken(), null);

        firebaseAuth.signInWithCredential(firebaseCredential)
            .addOnSuccessListener(authResult -> resolvePendingAuthResult(authResult, PROVIDER_GOOGLE, null))
            .addOnFailureListener(exception ->
                rejectPendingCall("authentication_failed", buildFirebaseErrorMessage(exception))
            );
    }

    private void startBrokerAuthorization(PluginCall call, String provider, String scope) {
        AppCompatActivity activity = getActivity();
        if (activity == null) {
            call.reject("Android activity is not available.", "activity_unavailable");
            return;
        }

        // Apple and Telegram go through a small OAuth broker so the app keeps
        // control over PKCE, App Links and local emulator/dev redirects.
        String authorizeEndpoint = config.brokerBaseUrl + "/oauth/" + provider + "/authorize";
        String tokenEndpoint = config.brokerBaseUrl + "/oauth/" + provider + "/token";

        AuthorizationServiceConfiguration configuration = new AuthorizationServiceConfiguration(
            Uri.parse(authorizeEndpoint),
            Uri.parse(tokenEndpoint)
        );

        AuthorizationRequest request = new AuthorizationRequest.Builder(
            configuration,
            getAppId(),
            ResponseTypeValues.CODE,
            Uri.parse(config.redirectUri)
        )
            .setScope(scope)
            .setState(UUID.randomUUID().toString())
            .setCodeVerifier(CodeVerifierUtil.generateRandomCodeVerifier())
            .setAdditionalParameters(buildBrokerRequestParameters(provider))
            .build();

        pendingProvider = provider;
        startActivityForResult(call, authorizationService.getAuthorizationRequestIntent(request), "handleBrokerAuthorizationResult");
    }

    private Map<String, String> buildBrokerRequestParameters(String provider) {
        Map<String, String> parameters = new HashMap<>();
        parameters.put("platform", "android");
        parameters.put("locale", Locale.getDefault().toLanguageTag());

        if (PROVIDER_APPLE.equals(provider)) {
            parameters.put("prompt", "login");
        }

        return parameters;
    }

    private void authenticateWithCustomToken(TokenResponse tokenResponse, PluginCall call, String provider) {
        JSObject fallbackProfile = profileFromTokenResponse(tokenResponse, provider);

        firebaseAuth.signInWithCustomToken(tokenResponse.accessToken)
            .addOnSuccessListener(authResult -> resolveSavedCall(call, buildSessionPayload(authResult.getUser(), provider, fallbackProfile)))
            .addOnFailureListener(exception ->
                rejectSavedCall(call, "authentication_failed", buildFirebaseErrorMessage(exception))
            );
    }

    private void clearGoogleCredentialState() {
        if (credentialManager == null) {
            return;
        }

        credentialManager.clearCredentialStateAsync(
            new ClearCredentialStateRequest(),
            null,
            mainExecutor,
            new androidx.credentials.CredentialManagerCallback<Void, ClearCredentialException>() {
                @Override
                public void onResult(Void unused) {
                    // Nothing else to do here; Firebase session is already cleared.
                }

                @Override
                public void onError(@NonNull ClearCredentialException error) {
                    Log.w(LOG_TAG, "Could not clear Credential Manager state.", error);
                }
            }
        );
    }

    private JSObject profileFromTokenResponse(TokenResponse tokenResponse, String provider) {
        JSObject profile = new JSObject();
        Map<String, String> parameters = tokenResponse.additionalParameters;

        profile.put("provider", provider);
        profile.put("providerUserId", parameters.getOrDefault("provider_user_id", ""));
        profile.put("email", parameters.getOrDefault("email", ""));
        profile.put("name", parameters.getOrDefault("name", ""));
        profile.put("photoUrl", parameters.getOrDefault("photo_url", ""));

        return profile;
    }

    private boolean beginPendingCall(PluginCall call, String provider) {
        if (pendingCallId != null) {
            call.reject("Another sign-in request is already in progress.", "operation_in_progress");
            return false;
        }

        Bridge currentBridge = bridge;
        currentBridge.saveCall(call);
        pendingCallId = call.getCallbackId();
        pendingProvider = provider;
        return true;
    }

    private void resolvePendingAuthResult(AuthResult authResult, String provider, @Nullable JSObject profileFallback) {
        PluginCall call = getPendingCall();
        if (call == null) {
            clearPendingState();
            return;
        }

        resolveSavedCall(call, buildSessionPayload(authResult.getUser(), provider, profileFallback));
    }

    private void rejectPendingCall(String code, String message) {
        PluginCall call = getPendingCall();
        if (call == null) {
            clearPendingState();
            return;
        }

        rejectSavedCall(call, code, message);
    }

    private void resolveSavedCall(PluginCall call, JSObject payload) {
        call.resolve(payload);
        releaseCall(call);
        clearPendingState();
    }

    private void rejectSavedCall(PluginCall call, String code, String message) {
        call.reject(message, code);
        releaseCall(call);
        clearPendingState();
    }

    private void releaseCall(PluginCall call) {
        bridge.releaseCall(call);
    }

    @Nullable
    private PluginCall getPendingCall() {
        return pendingCallId == null ? null : bridge.getSavedCall(pendingCallId);
    }

    private void clearPendingState() {
        pendingCallId = null;
        pendingProvider = null;
    }

    @Nullable
    private FirebaseUser getCurrentUser() {
        return firebaseAuth == null ? null : firebaseAuth.getCurrentUser();
    }

    private JSObject buildSessionPayload(@Nullable FirebaseUser user, @Nullable String providerHint, @Nullable JSObject fallbackProfile) {
        JSObject payload = new JSObject();
        payload.put("nativePlatform", true);
        payload.put("authenticated", user != null);
        payload.put("configuration", buildConfigurationPayload());

        if (user == null) {
            payload.put("user", JSONObject.NULL);
            return payload;
        }

        payload.put("user", buildUserPayload(user, providerHint, fallbackProfile));
        return payload;
    }

    private JSObject buildConfigurationPayload() {
        JSObject configuration = new JSObject();
        configuration.put("googleEnabled", config != null && config.hasGoogle());
        configuration.put("facebookEnabled", config != null && config.hasFacebook());
        configuration.put("appleEnabled", config != null && config.hasApple());
        configuration.put("telegramEnabled", config != null && config.hasTelegram());
        configuration.put("useEmulator", config != null && config.useEmulator);
        configuration.put("redirectUri", config == null ? "" : config.redirectUri);
        configuration.put("brokerBaseUrl", config == null ? "" : config.brokerBaseUrl);
        configuration.put("initializationError", initializationError == null ? "" : initializationError);
        return configuration;
    }

    private JSObject buildUserPayload(FirebaseUser user, @Nullable String providerHint, @Nullable JSObject fallbackProfile) {
        UserInfo providerInfo = findProviderInfo(user, providerHint);
        String fallbackProviderUserId = fallbackProfile != null ? fallbackProfile.getString("providerUserId", "") : "";
        String fallbackEmail = fallbackProfile != null ? fallbackProfile.getString("email", "") : "";
        String fallbackName = fallbackProfile != null ? fallbackProfile.getString("name", "") : "";
        String fallbackPhotoUrl = fallbackProfile != null ? fallbackProfile.getString("photoUrl", "") : "";

        JSObject userObject = new JSObject();
        userObject.put("firebaseUid", user.getUid());
        userObject.put("id", firstNonEmpty(providerInfo == null ? "" : providerInfo.getUid(), fallbackProviderUserId, user.getUid()));
        userObject.put("email", firstNonEmpty(user.getEmail(), fallbackEmail));
        userObject.put("name", firstNonEmpty(user.getDisplayName(), fallbackName));
        userObject.put("photoUrl", firstNonEmpty(user.getPhotoUrl() == null ? "" : user.getPhotoUrl().toString(), fallbackPhotoUrl));
        userObject.put("provider", normalizeProviderName(providerHint, providerInfo));
        userObject.put("emailVerified", user.isEmailVerified());
        return userObject;
    }

    @Nullable
    private UserInfo findProviderInfo(FirebaseUser user, @Nullable String providerHint) {
        if (providerHint != null) {
            String expectedProviderId = toFirebaseProviderId(providerHint);
            for (UserInfo providerData : user.getProviderData()) {
                if (expectedProviderId.equals(providerData.getProviderId())) {
                    return providerData;
                }
            }
        }

        for (UserInfo providerData : user.getProviderData()) {
            if (!"firebase".equals(providerData.getProviderId())) {
                return providerData;
            }
        }

        return null;
    }

    private String normalizeProviderName(@Nullable String providerHint, @Nullable UserInfo providerInfo) {
        if (providerHint != null && !providerHint.isEmpty()) {
            return providerHint;
        }

        if (providerInfo == null) {
            return "firebase";
        }

        switch (providerInfo.getProviderId()) {
            case "google.com":
                return PROVIDER_GOOGLE;
            case "facebook.com":
                return PROVIDER_FACEBOOK;
            case "apple.com":
                return PROVIDER_APPLE;
            default:
                return providerInfo.getProviderId();
        }
    }

    private String toFirebaseProviderId(String provider) {
        switch (provider) {
            case PROVIDER_GOOGLE:
                return "google.com";
            case PROVIDER_FACEBOOK:
                return "facebook.com";
            case PROVIDER_APPLE:
                return "apple.com";
            default:
                return provider;
        }
    }

    private String buildAuthorizationErrorMessage(AuthorizationException exception) {
        if (!TextUtils.isEmpty(exception.errorDescription)) {
            return exception.errorDescription;
        }

        return "Authorization failed.";
    }

    private boolean isUserCancellation(AuthorizationException exception) {
        AuthorizationException cancellation = AuthorizationException.GeneralErrors.USER_CANCELED_AUTH_FLOW;
        return exception.type == cancellation.type && exception.code == cancellation.code;
    }

    private String buildCredentialErrorMessage(GetCredentialException exception) {
        String errorType = exception.getType();
        if (exception instanceof NoCredentialException) {
            return "No Google accounts are available for sign-in on this device.";
        }

        return errorType == null || errorType.isEmpty()
            ? "Credential manager failed."
            : "Credential manager failed: " + errorType;
    }

    private String buildFirebaseErrorMessage(Exception exception) {
        if (exception instanceof FirebaseAuthException) {
            FirebaseAuthException authException = (FirebaseAuthException) exception;
            if (authException.getErrorCode() != null && !authException.getErrorCode().isEmpty()) {
                return authException.getErrorCode() + ": " + authException.getMessage();
            }
        }

        return exception.getMessage() == null || exception.getMessage().isEmpty()
            ? "Authentication failed."
            : exception.getMessage();
    }

    private String firstNonEmpty(String... values) {
        for (String value : values) {
            if (value != null && !value.trim().isEmpty()) {
                return value.trim();
            }
        }

        return "";
    }
}
