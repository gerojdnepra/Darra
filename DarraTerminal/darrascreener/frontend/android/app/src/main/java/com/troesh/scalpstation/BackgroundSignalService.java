package com.troesh.scalpstation;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.TimeUnit;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;

import org.json.JSONArray;
import org.json.JSONObject;

public class BackgroundSignalService extends Service {
    public static final String ACTION_START = "com.troesh.scalpstation.action.START_BACKGROUND_SIGNALS";
    public static final String ACTION_STOP = "com.troesh.scalpstation.action.STOP_BACKGROUND_SIGNALS";
    public static final String EXTRA_BACKEND_WS_URL = "backendWsUrl";

    private static final String PREFS_NAME = "background_signal_monitor";
    private static final String PREF_BACKEND_WS_URL = "backendWsUrl";
    private static final String SIGNAL_CHANNEL_ID = "scalpstation_signals_v2";
    private static final String BACKGROUND_CHANNEL_ID = "scalpstation_background_monitor";
    private static final String SIGNAL_GROUP = "scalpstation-signals";
    private static final int BACKGROUND_NOTIFICATION_ID = 701001;
    private static final long RECONNECT_DELAY_MS = 5_000L;
    private static final long INITIAL_ALERT_REPLAY_WINDOW_MS = 120_000L;
    private static final int INITIAL_ALERT_REPLAY_LIMIT = 3;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Set<String> seenAlertIds = new HashSet<>();
    private OkHttpClient client;
    private WebSocket webSocket;
    private String backendWsUrl;
    private boolean primedAlertHistory = false;
    private boolean stopping = false;

    private final Runnable reconnectRunnable = new Runnable() {
        @Override
        public void run() {
            connect();
        }
    };

    @Override
    public void onCreate() {
        super.onCreate();
        client = new OkHttpClient.Builder()
            .pingInterval(20, TimeUnit.SECONDS)
            .retryOnConnectionFailure(true)
            .build();
        createNotificationChannels();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;

        if (ACTION_STOP.equals(action)) {
            stopMonitor();
            stopSelf();
            return START_NOT_STICKY;
        }

        String nextBackendWsUrl = intent != null ? intent.getStringExtra(EXTRA_BACKEND_WS_URL) : null;

        if (nextBackendWsUrl == null || nextBackendWsUrl.trim().isEmpty()) {
            nextBackendWsUrl = getPrefs().getString(PREF_BACKEND_WS_URL, null);
        }

        if (nextBackendWsUrl == null || nextBackendWsUrl.trim().isEmpty()) {
            stopSelf();
            return START_NOT_STICKY;
        }

        backendWsUrl = nextBackendWsUrl.trim();
        stopping = false;
        primedAlertHistory = false;
        seenAlertIds.clear();
        getPrefs().edit().putString(PREF_BACKEND_WS_URL, backendWsUrl).apply();

        startForeground(
            BACKGROUND_NOTIFICATION_ID,
            buildBackgroundNotification()
        );
        connect();

        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        stopMonitor();
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private SharedPreferences getPrefs() {
        return getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    private boolean isCurrentSocket(WebSocket socket) {
        return socket != null && socket == webSocket;
    }

    private void connect() {
        if (stopping || backendWsUrl == null || backendWsUrl.isEmpty()) {
            return;
        }

        handler.removeCallbacks(reconnectRunnable);

        if (webSocket != null) {
            webSocket.close(1000, "reconnecting");
            webSocket = null;
        }

        Request request = new Request.Builder().url(backendWsUrl).build();
        webSocket = client.newWebSocket(request, new WebSocketListener() {
            @Override
            public void onOpen(WebSocket socket, Response response) {
                if (!isCurrentSocket(socket) || stopping) {
                    return;
                }

                socket.send("{\"type\":\"hello\"}");
                socket.send("{\"type\":\"request_snapshot\"}");
            }

            @Override
            public void onMessage(WebSocket socket, String text) {
                if (!isCurrentSocket(socket) || stopping) {
                    return;
                }

                handleServerMessage(text);
            }

            @Override
            public void onClosed(WebSocket socket, int code, String reason) {
                if (!isCurrentSocket(socket)) {
                    return;
                }

                webSocket = null;
                scheduleReconnect();
            }

            @Override
            public void onFailure(WebSocket socket, Throwable throwable, Response response) {
                if (!isCurrentSocket(socket)) {
                    return;
                }

                webSocket = null;
                scheduleReconnect();
            }
        });
    }

    private void scheduleReconnect() {
        if (stopping) {
            return;
        }

        handler.removeCallbacks(reconnectRunnable);
        handler.postDelayed(reconnectRunnable, RECONNECT_DELAY_MS);
    }

    private void stopMonitor() {
        stopping = true;
        handler.removeCallbacks(reconnectRunnable);
        getPrefs().edit().remove(PREF_BACKEND_WS_URL).apply();

        if (webSocket != null) {
            webSocket.close(1000, "stopped");
            webSocket = null;
        }

        backendWsUrl = null;
        primedAlertHistory = false;
        seenAlertIds.clear();

        stopForeground(true);
    }

    private void handleServerMessage(String text) {
        try {
            JSONObject message = new JSONObject(text);
            JSONArray alerts = message.optJSONArray("alerts");

            if (alerts == null) {
                return;
            }

            if (!primedAlertHistory) {
                for (int index = 0; index < alerts.length(); index += 1) {
                    JSONObject alert = alerts.optJSONObject(index);
                    String id = alert == null ? "" : alert.optString("id", "");
                    if (!id.isEmpty()) {
                        seenAlertIds.add(id);
                    }
                }
                primedAlertHistory = true;

                List<JSONObject> replayAlerts = new ArrayList<>();
                for (int index = 0; index < alerts.length(); index += 1) {
                    JSONObject alert = alerts.optJSONObject(index);

                    if (alert == null || !shouldReplayInitialAlert(alert)) {
                        continue;
                    }

                    replayAlerts.add(alert);

                    if (replayAlerts.size() >= INITIAL_ALERT_REPLAY_LIMIT) {
                        break;
                    }
                }

                for (int index = replayAlerts.size() - 1; index >= 0; index -= 1) {
                    showSignalNotification(replayAlerts.get(index));
                }

                return;
            }

            for (int index = alerts.length() - 1; index >= 0; index -= 1) {
                JSONObject alert = alerts.optJSONObject(index);

                if (alert == null) {
                    continue;
                }

                String id = alert.optString("id", "");

                if (id.isEmpty() || seenAlertIds.contains(id)) {
                    continue;
                }

                seenAlertIds.add(id);
                showSignalNotification(alert);
            }

            if (seenAlertIds.size() > 500) {
                seenAlertIds.clear();
                for (int index = 0; index < alerts.length(); index += 1) {
                    JSONObject alert = alerts.optJSONObject(index);
                    String id = alert == null ? "" : alert.optString("id", "");
                    if (!id.isEmpty()) {
                        seenAlertIds.add(id);
                    }
                }
            }
        } catch (Exception ignored) {
            // Ignore non-frame messages such as welcome packets.
        }
    }

    private void showSignalNotification(JSONObject alert) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            return;
        }

        String id = alert.optString("id", String.valueOf(System.currentTimeMillis()));
        String symbol = alert.optString("symbol", "Signal");
        String bias = alert.optString("bias", "");
        String reason = alert.optString("reason", "New signal");
        double notionalUsd = alert.optDouble("notionalUsd", 0);
        String title = symbol + (bias.isEmpty() ? "" : " " + bias) + " signal";
        String body = reason + " | " + compactUsd(notionalUsd);
        Uri soundUri = getSignalSoundUri();

        Notification notification = new NotificationCompat.Builder(this, SIGNAL_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_scalpstation)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_STATUS)
            .setAutoCancel(true)
            .setSound(soundUri)
            .setGroup(SIGNAL_GROUP)
            .setColor(0xFF38BDF8)
            .build();

        try {
            NotificationManagerCompat.from(this).notify(getNotificationId(id), notification);
        } catch (SecurityException ignored) {
            // Notification permission can be revoked while the foreground service is alive.
        }
    }

    private boolean shouldReplayInitialAlert(JSONObject alert) {
        long createdAt = alert.optLong("createdAt", 0L);

        if (createdAt <= 0) {
            return false;
        }

        long now = System.currentTimeMillis();
        return createdAt <= now + 5_000L && now - createdAt <= INITIAL_ALERT_REPLAY_WINDOW_MS;
    }

    private Notification buildBackgroundNotification() {
        return new NotificationCompat.Builder(this, BACKGROUND_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_scalpstation)
            .setContentTitle("Scalp Station")
            .setContentText("Background signal monitor active")
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setSilent(true)
            .setColor(0xFF38BDF8)
            .build();
    }

    private void createNotificationChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }

        NotificationManager manager = getSystemService(NotificationManager.class);

        if (manager == null) {
            return;
        }

        NotificationChannel backgroundChannel = new NotificationChannel(
            BACKGROUND_CHANNEL_ID,
            "Scalp Station Background",
            NotificationManager.IMPORTANCE_LOW
        );
        backgroundChannel.setDescription("Keeps the signal monitor running in the background");
        backgroundChannel.enableVibration(false);
        backgroundChannel.setSound(null, null);
        manager.createNotificationChannel(backgroundChannel);

        NotificationChannel signalChannel = new NotificationChannel(
            SIGNAL_CHANNEL_ID,
            "Scalp Station Signals",
            NotificationManager.IMPORTANCE_HIGH
        );
        signalChannel.setDescription("Live trading signal alerts");
        signalChannel.enableVibration(true);
        signalChannel.enableLights(true);
        signalChannel.setLightColor(0xFF38BDF8);
        signalChannel.setSound(
            getSignalSoundUri(),
            new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build()
        );
        manager.createNotificationChannel(signalChannel);
    }

    private Uri getSignalSoundUri() {
        return Uri.parse(ContentResolver.SCHEME_ANDROID_RESOURCE + "://" + getPackageName() + "/" + R.raw.signal_chime);
    }

    private int getNotificationId(String id) {
        int hash = 0;
        for (int index = 0; index < id.length(); index += 1) {
            hash = (hash * 31) + id.charAt(index);
        }
        return (hash & 0x7fffffff) == 0 ? 1 : (hash & 0x7fffffff);
    }

    private String compactUsd(double value) {
        double absolute = Math.abs(value);

        if (absolute >= 1_000_000_000) {
            return "$" + String.format(Locale.US, "%.2fB", value / 1_000_000_000);
        }

        if (absolute >= 1_000_000) {
            return "$" + String.format(Locale.US, "%.2fM", value / 1_000_000);
        }

        if (absolute >= 1_000) {
            return "$" + String.format(Locale.US, "%.2fK", value / 1_000);
        }

        return "$" + String.format(Locale.US, "%.0f", value);
    }
}
