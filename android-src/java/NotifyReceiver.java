package com.rippipupil.meteorshower;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.SystemClock;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Calendar;
import java.util.Locale;

/**
 * Avisos de Meteor Shower para el lugar principal:
 * - Resumen de la mañana, a la hora elegida.
 * - «Va a llover en 1 hora»: comprueba la previsión cada ~30 minutos.
 * Se programan con AlarmManager (sin alarmas exactas, así que Android
 * puede retrasarlos unos minutos para ahorrar batería) y se vuelven a
 * programar al reiniciar el móvil o al actualizar la app.
 */
public class NotifyReceiver extends BroadcastReceiver {

    static final String ACTION_MORNING = "com.rippipupil.meteorshower.MORNING";
    static final String ACTION_RAIN = "com.rippipupil.meteorshower.RAIN_CHECK";
    private static final String CHANNEL_MORNING = "morning";
    private static final String CHANNEL_RAIN = "rain";
    private static final long RAIN_INTERVAL = 30 * 60 * 1000L;

    /* ---------- Programación ---------- */

    static void saveSettings(Context context, boolean morning, String morningTime, boolean rain) {
        prefs(context).edit()
            .putBoolean("morning", morning)
            .putString("morningTime", morningTime)
            .putBoolean("rainAlert", rain)
            .apply();
        reschedule(context);
    }

    static void reschedule(Context context) {
        SharedPreferences p = prefs(context);
        AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        PendingIntent morning = pending(context, ACTION_MORNING, 1);
        PendingIntent rain = pending(context, ACTION_RAIN, 2);
        am.cancel(morning);
        am.cancel(rain);
        if (p.getBoolean("morning", false)) {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, nextMorning(p.getString("morningTime", "08:00")), morning);
        }
        if (p.getBoolean("rainAlert", false)) {
            am.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, SystemClock.elapsedRealtime() + 5 * 60 * 1000L, rain);
        }
    }

    private static long nextMorning(String hhmm) {
        int h = 8;
        int m = 0;
        try {
            String[] parts = hhmm.split(":");
            h = Integer.parseInt(parts[0]);
            m = Integer.parseInt(parts[1]);
        } catch (Exception ignored) {
            // hora por defecto
        }
        Calendar c = Calendar.getInstance();
        c.set(Calendar.HOUR_OF_DAY, h);
        c.set(Calendar.MINUTE, m);
        c.set(Calendar.SECOND, 0);
        c.set(Calendar.MILLISECOND, 0);
        if (c.getTimeInMillis() <= System.currentTimeMillis() + 60 * 1000L) c.add(Calendar.DAY_OF_YEAR, 1);
        return c.getTimeInMillis();
    }

    private static PendingIntent pending(Context context, String action, int code) {
        Intent intent = new Intent(context, NotifyReceiver.class);
        intent.setAction(action);
        return PendingIntent.getBroadcast(context, code, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(WeatherWidgetProvider.PREFS, Context.MODE_PRIVATE);
    }

    /* ---------- Al sonar la alarma ---------- */

    @Override
    public void onReceive(Context context, Intent intent) {
        final String action = intent.getAction();
        final Context app = context.getApplicationContext();
        if (!ACTION_MORNING.equals(action) && !ACTION_RAIN.equals(action)) {
            // Reinicio del móvil o actualización de la app: las alarmas se pierden.
            reschedule(app);
            return;
        }
        final PendingResult result = goAsync();
        new Thread(() -> {
            try {
                if (ACTION_MORNING.equals(action)) morning(app);
                else rainCheck(app);
            } catch (Exception ignored) {
                // sin red o sin datos: se vuelve a intentar en la siguiente alarma
            } finally {
                scheduleNext(app, action);
                result.finish();
            }
        }).start();
    }

    private static void scheduleNext(Context context, String action) {
        SharedPreferences p = prefs(context);
        AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        if (ACTION_MORNING.equals(action) && p.getBoolean("morning", false)) {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, nextMorning(p.getString("morningTime", "08:00")), pending(context, ACTION_MORNING, 1));
        } else if (ACTION_RAIN.equals(action) && p.getBoolean("rainAlert", false)) {
            am.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, SystemClock.elapsedRealtime() + RAIN_INTERVAL, pending(context, ACTION_RAIN, 2));
        }
    }

    private static JSONObject forecast(Context context) throws Exception {
        SharedPreferences p = prefs(context);
        String lat = p.getString("lat", null);
        String lon = p.getString("lon", null);
        if (lat == null || lon == null) return null;
        String url = String.format(Locale.US, WeatherWidgetProvider.FORECAST_URL, lat, lon, p.getString("unit", "celsius"));
        return new JSONObject(WeatherWidgetProvider.download(url));
    }

    private static void morning(Context context) throws Exception {
        JSONObject data = forecast(context);
        if (data == null) return;
        String place = prefs(context).getString("name", "");
        JSONObject s = WeatherWidgetProvider.summarize(data, place);
        String title = "Buenos días" + (place.isEmpty() ? "" : " · " + place);
        String text = s.optString("desc") + " · " + s.optString("temp") + " ahora · " + s.optString("maxmin")
            + "\n" + s.optString("rain");
        notify(context, 1, CHANNEL_MORNING, title, text);
    }

    private static void rainCheck(Context context) throws Exception {
        int hour = Calendar.getInstance().get(Calendar.HOUR_OF_DAY);
        if (hour >= 23 || hour < 7) return; // horas de silencio
        JSONObject data = forecast(context);
        if (data == null) return;
        JSONObject current = data.getJSONObject("current");
        if (current.optInt("weather_code", 0) >= 51) return; // ya está lloviendo
        String now = current.getString("time");
        JSONObject hourly = data.getJSONObject("hourly");
        JSONArray times = hourly.getJSONArray("time");
        JSONArray probs = hourly.getJSONArray("precipitation_probability");
        JSONArray amounts = hourly.getJSONArray("precipitation");
        JSONArray codes = hourly.getJSONArray("weather_code");
        // La franja horaria que empieza dentro de la próxima hora
        for (int i = 0; i < times.length(); i++) {
            String t = times.getString(i);
            if (t.compareTo(now) <= 0) continue;
            int prob = probs.isNull(i) ? 0 : probs.getInt(i);
            double mm = amounts.isNull(i) ? 0 : amounts.getDouble(i);
            if (prob >= 60 || mm >= 0.5) {
                SharedPreferences p = prefs(context);
                if (t.equals(p.getString("rainNotifiedFor", ""))) return; // ya avisado
                long last = p.getLong("rainNotifiedAt", 0);
                if (System.currentTimeMillis() - last < 3 * 60 * 60 * 1000L) return; // como mucho un aviso cada 3 h
                p.edit().putString("rainNotifiedFor", t).putLong("rainNotifiedAt", System.currentTimeMillis()).apply();
                String what = WeatherWidgetProvider.isSnow(codes.optInt(i, 0)) ? "nevar" : "llover";
                String place = p.getString("name", "");
                notify(context, 2, CHANNEL_RAIN, "Va a " + what + " en 1 hora",
                    "Hacia las " + t.substring(11, 16) + " (" + prob + " %)" + (place.isEmpty() ? "" : " en " + place) + ". ¡Coge el paraguas!");
            }
            return; // solo se mira la próxima franja
        }
    }

    /* ---------- Notificaciones ---------- */

    private static void notify(Context context, int id, String channel, String title, String text) {
        if (Build.VERSION.SDK_INT >= 33
            && context.checkSelfPermission("android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED) {
            return;
        }
        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        Notification.Builder b;
        if (Build.VERSION.SDK_INT >= 26) {
            if (nm.getNotificationChannel(channel) == null) {
                boolean rain = CHANNEL_RAIN.equals(channel);
                NotificationChannel ch = new NotificationChannel(channel, rain ? "Aviso de lluvia" : "Resumen de la mañana",
                    rain ? NotificationManager.IMPORTANCE_HIGH : NotificationManager.IMPORTANCE_DEFAULT);
                nm.createNotificationChannel(ch);
            }
            b = new Notification.Builder(context, channel);
        } else {
            b = new Notification.Builder(context);
        }
        Intent launch = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        if (launch != null) {
            b.setContentIntent(PendingIntent.getActivity(context, 10 + id, launch,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
        }
        b.setSmallIcon(R.drawable.ic_stat_meteor)
            .setColor(0xFF8A5CF0)
            .setContentTitle(title)
            .setContentText(text.replace('\n', ' '))
            .setStyle(new Notification.BigTextStyle().bigText(text))
            .setAutoCancel(true);
        nm.notify(id, b.build());
    }
}
