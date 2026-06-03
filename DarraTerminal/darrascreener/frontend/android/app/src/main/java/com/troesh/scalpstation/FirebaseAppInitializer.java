package com.troesh.scalpstation;

import android.content.Context;

import com.google.firebase.FirebaseApp;
import com.google.firebase.FirebaseOptions;

import java.util.List;

final class FirebaseAppInitializer {
    private FirebaseAppInitializer() {}

    static FirebaseApp getOrCreate(Context context, SocialAuthConfig config) {
        List<FirebaseApp> apps = FirebaseApp.getApps(context);
        if (!apps.isEmpty()) {
            return FirebaseApp.getInstance();
        }

        FirebaseApp resourceApp = FirebaseApp.initializeApp(context);
        if (resourceApp != null) {
            return resourceApp;
        }

        if (!config.hasManualFirebaseConfig()) {
            throw new IllegalStateException(
                "Firebase is not configured. Add google-services.json or set ANDROID_FIREBASE_* values in .env."
            );
        }

        FirebaseOptions.Builder builder = new FirebaseOptions.Builder()
            .setApiKey(config.firebaseApiKey)
            .setApplicationId(config.firebaseAppId)
            .setProjectId(config.firebaseProjectId)
            .setGcmSenderId(config.firebaseMessagingSenderId);

        if (!config.firebaseStorageBucket.isEmpty()) {
            builder.setStorageBucket(config.firebaseStorageBucket);
        }

        FirebaseApp initialized = FirebaseApp.initializeApp(context, builder.build());
        if (initialized == null) {
            throw new IllegalStateException("FirebaseApp initialization returned null.");
        }

        return initialized;
    }
}
