package com.troesh.scalpstation;

import android.content.Context;
import android.content.Intent;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "BackgroundSignalMonitor")
public class BackgroundSignalMonitorPlugin extends Plugin {
    @PluginMethod
    public void start(PluginCall call) {
        String backendWsUrl = call.getString("backendWsUrl");

        if (backendWsUrl == null || backendWsUrl.trim().isEmpty()) {
            call.reject("backendWsUrl is required");
            return;
        }

        Context context = getContext();
        Intent intent = new Intent(context, BackgroundSignalService.class);
        intent.setAction(BackgroundSignalService.ACTION_START);
        intent.putExtra(BackgroundSignalService.EXTRA_BACKEND_WS_URL, backendWsUrl.trim());
        ContextCompat.startForegroundService(context, intent);

        JSObject result = new JSObject();
        result.put("running", true);
        call.resolve(result);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Context context = getContext();
        Intent intent = new Intent(context, BackgroundSignalService.class);
        intent.setAction(BackgroundSignalService.ACTION_STOP);
        context.startService(intent);

        JSObject result = new JSObject();
        result.put("running", false);
        call.resolve(result);
    }
}
