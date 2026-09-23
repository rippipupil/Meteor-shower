package com.rippipupil.meteorshower;

import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * Puente entre la app web y la parte nativa:
 * - setPlace({ lat, lon, name, unit }): lugar principal para el widget y los avisos.
 * - setNotifications({ morning, morningTime, rain, ask }): activa o desactiva los
 *   avisos; con ask = true pide permiso de notificaciones si hace falta.
 */
@CapacitorPlugin(
    name = "WidgetBridge",
    permissions = { @Permission(strings = { "android.permission.POST_NOTIFICATIONS" }, alias = "notifications") }
)
public class WidgetBridgePlugin extends Plugin {

    @PluginMethod
    public void setPlace(PluginCall call) {
        Double lat = call.getDouble("lat");
        Double lon = call.getDouble("lon");
        if (lat == null || lon == null) {
            call.reject("Faltan las coordenadas");
            return;
        }
        WeatherWidgetProvider.savePlace(getContext(), lat, lon, call.getString("name", ""), call.getString("unit", "celsius"));
        WeatherWidgetProvider.requestUpdate(getContext());
        call.resolve();
    }

    @PluginMethod
    public void setNotifications(PluginCall call) {
        boolean morning = Boolean.TRUE.equals(call.getBoolean("morning", false));
        boolean rain = Boolean.TRUE.equals(call.getBoolean("rain", false));
        String time = call.getString("morningTime", "08:00");
        NotifyReceiver.saveSettings(getContext(), morning, time, rain);
        boolean needsPermission = Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") != PermissionState.GRANTED;
        if ((morning || rain) && needsPermission && Boolean.TRUE.equals(call.getBoolean("ask", false))) {
            requestPermissionForAlias("notifications", call, "notificationsPermission");
            return;
        }
        resolveGranted(call);
    }

    @PermissionCallback
    private void notificationsPermission(PluginCall call) {
        resolveGranted(call);
    }

    private void resolveGranted(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", Build.VERSION.SDK_INT < 33 || getPermissionState("notifications") == PermissionState.GRANTED);
        call.resolve(ret);
    }
}
