package com.rippipupil.meteorshower;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

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
 * - setNotifications({ morning, morningTime, rain, stormFrost, pollen, ask }): activa o desactiva los
 *   avisos; con ask = true pide permiso de notificaciones si hace falta.
 * - httpGet({ url }): descarga los avisos de MeteoAlarm, que no permite
 *   peticiones desde la web.
 * - batteryStatus() / allowBackground(): ver y quitar el ahorro de batería de
 *   Android para la app, que es lo que suele impedir que el widget y los
 *   avisos se actualicen solos.
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
        boolean stormFrost = Boolean.TRUE.equals(call.getBoolean("stormFrost", false));
        boolean pollen = Boolean.TRUE.equals(call.getBoolean("pollen", false));
        String time = call.getString("morningTime", "08:00");
        NotifyReceiver.saveSettings(getContext(), morning, time, rain, stormFrost, pollen);
        boolean needsPermission = Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") != PermissionState.GRANTED;
        if ((morning || rain || stormFrost || pollen) && needsPermission && Boolean.TRUE.equals(call.getBoolean("ask", false))) {
            requestPermissionForAlias("notifications", call, "notificationsPermission");
            return;
        }
        resolveGranted(call);
    }

    @PluginMethod
    public void httpGet(PluginCall call) {
        final String url = call.getString("url", "");
        if (!url.startsWith("https://feeds.meteoalarm.org/")) {
            call.reject("Dirección no permitida");
            return;
        }
        new Thread(() -> {
            try {
                JSObject ret = new JSObject();
                ret.put("data", WeatherWidgetProvider.download(url));
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("Sin conexión");
            }
        }).start();
    }

    @PluginMethod
    public void batteryStatus(PluginCall call) {
        PowerManager pm = (PowerManager) getContext().getSystemService(android.content.Context.POWER_SERVICE);
        JSObject ret = new JSObject();
        ret.put("unrestricted", pm == null || pm.isIgnoringBatteryOptimizations(getContext().getPackageName()));
        call.resolve(ret);
    }

    @PluginMethod
    public void allowBackground(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + getContext().getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
        } catch (Exception e) {
            // Si el móvil no tiene ese diálogo, se abren los ajustes de batería.
            Intent intent = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            try {
                getContext().startActivity(intent);
            } catch (Exception ignored) {
                call.reject("No se pudieron abrir los ajustes");
                return;
            }
        }
        call.resolve();
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
