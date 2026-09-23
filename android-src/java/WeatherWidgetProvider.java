package com.rippipupil.meteorshower;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.SystemClock;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * Widget de la pantalla de inicio: muestra los grados, un icono del cielo y
 * si va a llover hoy y a qué hora. La app le pasa la ubicación elegida
 * (WidgetBridgePlugin) y el widget consulta Open-Meteo por su cuenta cada
 * 30 minutos, sin tener que abrir la app.
 *
 * Esta clase es también el «motor» de los otros widgets (reloj y semana):
 * una sola descarga y una sola alarma actualizan todos los que haya puestos.
 */
public class WeatherWidgetProvider extends AppWidgetProvider {

    static final String PREFS = "meteor_shower_widget";
    static final String ACTION_REFRESH = "com.rippipupil.meteorshower.WIDGET_REFRESH";
    // Android solo garantiza updatePeriodMillis de forma muy laxa (y en reposo
    // lo retrasa horas), así que el widget se programa su propia alarma.
    private static final long REFRESH_INTERVAL = 30 * 60 * 1000L;
    static final String FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
        + "?latitude=%s&longitude=%s&timezone=auto&forecast_days=5&temperature_unit=%s"
        + "&current=temperature_2m,weather_code,is_day"
        + "&hourly=precipitation_probability,precipitation,weather_code"
        + "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max";
    // Colores del widget (los mismos que la app)
    static final int WHITE = 0xFFF3ECFF;
    static final int LILAC = 0xFFD2BDFF;
    static final int DIM = 0xFFA790D6;
    static final int BLUE = 0xFF86C9FF;
    private static final String[] DAY_NAMES = { "Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb" };

    /** Todos los widgets colocados, de cualquier tipo. */
    static int countAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        return ids(manager, context, WeatherWidgetProvider.class).length
            + ids(manager, context, ClockWidgetProvider.class).length
            + ids(manager, context, WeekWidgetProvider.class).length;
    }

    private static int[] ids(AppWidgetManager manager, Context context, Class<?> kind) {
        return manager.getAppWidgetIds(new ComponentName(context, kind));
    }

    public static void savePlace(Context context, double lat, double lon, String name, String unit) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString("lat", Double.toString(lat))
            .putString("lon", Double.toString(lon))
            .putString("name", name)
            .putString("unit", "fahrenheit".equals(unit) ? "fahrenheit" : "celsius")
            .apply();
    }

    /** Pide a todos los widgets colocados que se actualicen ya. */
    public static void requestUpdate(Context context) {
        if (countAll(context) == 0) return;
        Intent intent = new Intent(context, WeatherWidgetProvider.class);
        intent.setAction(ACTION_REFRESH);
        context.sendBroadcast(intent);
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        if (ACTION_REFRESH.equals(intent.getAction())) {
            // Alarma de refresco, botón ↻ del widget o la app pidiendo actualizar
            if (countAll(context) == 0) return;
            AppWidgetManager manager = AppWidgetManager.getInstance(context);
            int[] big = ids(manager, context, WeatherWidgetProvider.class);
            if (intent.getBooleanExtra("manual", false) && big.length > 0) {
                RemoteViews busy = new RemoteViews(context.getPackageName(), R.layout.widget_weather);
                PixelText.set(busy, context, R.id.w_updated, "actualizando…", 15, DIM);
                manager.partiallyUpdateAppWidget(big, busy);
            }
            onUpdate(context, manager, big);
            return;
        }
        super.onReceive(context, intent);
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        final PendingResult result = goAsync();
        final Context app = context.getApplicationContext();
        new Thread(() -> {
            try {
                refresh(app, manager);
            } catch (Exception ignored) {
                // Si algo falla, el widget conserva lo último que mostraba.
            } finally {
                scheduleRefresh(app);
                result.finish();
            }
        }).start();
    }

    @Override
    public void onDisabled(Context context) {
        // Se ha quitado el último widget (de cualquier tipo): ya no hace falta la alarma.
        if (countAll(context) > 0) return;
        AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (am != null) am.cancel(refreshIntent(context, false));
    }

    /** Programa la siguiente actualización (funciona también con el móvil en reposo). */
    static void scheduleRefresh(Context context) {
        AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        if (countAll(context) == 0) return;
        am.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, SystemClock.elapsedRealtime() + REFRESH_INTERVAL, refreshIntent(context, false));
    }

    private static PendingIntent refreshIntent(Context context, boolean manual) {
        Intent intent = new Intent(context, WeatherWidgetProvider.class);
        intent.setAction(ACTION_REFRESH);
        intent.putExtra("manual", manual);
        return PendingIntent.getBroadcast(context, manual ? 21 : 20, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static void refresh(Context context, AppWidgetManager manager) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String lat = prefs.getString("lat", null);
        String lon = prefs.getString("lon", null);
        if (lat == null || lon == null) {
            renderAll(context, manager, null, false);
            return;
        }
        try {
            String url = String.format(Locale.US, FORECAST_URL, lat, lon, prefs.getString("unit", "celsius"));
            JSONObject snapshot = summarize(new JSONObject(download(url)), prefs.getString("name", ""));
            prefs.edit().putString("last", snapshot.toString()).apply();
            renderAll(context, manager, snapshot, false);
        } catch (Exception e) {
            JSONObject cached = null;
            try {
                String last = prefs.getString("last", null);
                if (last != null) cached = new JSONObject(last);
            } catch (Exception ignored) {
                cached = null;
            }
            renderAll(context, manager, cached, true);
        }
    }

    private static void renderAll(Context context, AppWidgetManager manager, JSONObject data, boolean stale) {
        int[] big = ids(manager, context, WeatherWidgetProvider.class);
        if (big.length > 0) render(context, manager, big, data, stale);
        int[] clock = ids(manager, context, ClockWidgetProvider.class);
        if (clock.length > 0) ClockWidgetProvider.render(context, manager, clock, data);
        int[] week = ids(manager, context, WeekWidgetProvider.class);
        if (week.length > 0) WeekWidgetProvider.render(context, manager, week, data);
    }

    /** Abre la app al tocar el widget. */
    static PendingIntent openApp(Context context) {
        Intent launch = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        if (launch == null) return null;
        return PendingIntent.getActivity(context, 0, launch, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static String download(String address) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(address).openConnection();
        connection.setConnectTimeout(10000);
        connection.setReadTimeout(10000);
        try {
            if (connection.getResponseCode() != 200) throw new Exception("HTTP " + connection.getResponseCode());
            StringBuilder body = new StringBuilder();
            try (BufferedReader reader = new BufferedReader(
                new InputStreamReader(connection.getInputStream(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null) body.append(line);
            }
            return body.toString();
        } finally {
            connection.disconnect();
        }
    }

    /** Reduce la respuesta de Open-Meteo a lo que enseña el widget. */
    static JSONObject summarize(JSONObject data, String place) throws Exception {
        JSONObject current = data.getJSONObject("current");
        JSONObject hourly = data.getJSONObject("hourly");
        JSONObject daily = data.getJSONObject("daily");
        int code = current.optInt("weather_code", 3);
        boolean isDay = current.optInt("is_day", 1) == 1;
        String now = current.getString("time");

        JSONObject out = new JSONObject();
        out.put("temp", Math.round(current.getDouble("temperature_2m")) + "°");
        out.put("desc", describe(code));
        out.put("icon", iconKey(code, isDay));
        out.put("maxmin", Math.round(daily.getJSONArray("temperature_2m_max").getDouble(0)) + "° / "
            + Math.round(daily.getJSONArray("temperature_2m_min").getDouble(0)) + "°");
        out.put("place", place);
        out.put("updated", new SimpleDateFormat("HH:mm", Locale.getDefault()).format(new Date()));
        String[] rain = rainToday(hourly, now, code);
        out.put("rain", rain[0]);
        out.put("wet", "1".equals(rain[1]));
        out.put("days", days(daily));
        return out;
    }

    /** Los próximos días para el widget de semana. */
    private static JSONArray days(JSONObject daily) throws Exception {
        JSONArray times = daily.getJSONArray("time");
        JSONArray codes = daily.optJSONArray("weather_code");
        JSONArray max = daily.getJSONArray("temperature_2m_max");
        JSONArray min = daily.getJSONArray("temperature_2m_min");
        JSONArray probs = daily.optJSONArray("precipitation_probability_max");
        JSONArray out = new JSONArray();
        SimpleDateFormat iso = new SimpleDateFormat("yyyy-MM-dd", Locale.US);
        java.util.Calendar cal = java.util.Calendar.getInstance();
        for (int i = 0; i < times.length() && i < 5; i++) {
            cal.setTime(iso.parse(times.getString(i)));
            JSONObject d = new JSONObject();
            d.put("name", i == 0 ? "Hoy" : DAY_NAMES[cal.get(java.util.Calendar.DAY_OF_WEEK) - 1]);
            d.put("icon", iconKey(codes == null ? 3 : codes.optInt(i, 3), true));
            d.put("max", Math.round(max.getDouble(i)) + "°");
            d.put("min", Math.round(min.getDouble(i)) + "°");
            d.put("rain", probs == null || probs.isNull(i) ? 0 : probs.getInt(i));
            out.put(d);
        }
        return out;
    }

    /** Primera hora de lo que queda de hoy en la que se espera lluvia (la misma regla que la app). */
    private static String[] rainToday(JSONObject hourly, String now, int currentCode) throws Exception {
        if (currentCode >= 51) return new String[] { isSnow(currentCode) ? "Nevando ahora" : "Lloviendo ahora", "1" };
        JSONArray times = hourly.getJSONArray("time");
        JSONArray probs = hourly.getJSONArray("precipitation_probability");
        JSONArray amounts = hourly.getJSONArray("precipitation");
        JSONArray codes = hourly.getJSONArray("weather_code");
        String today = now.substring(0, 10);
        String thisHour = now.substring(0, 13);
        int first = -1;
        int best = -1;
        int bestProb = -1;
        for (int i = 0; i < times.length(); i++) {
            String time = times.getString(i);
            if (!time.startsWith(today) || time.substring(0, 13).compareTo(thisHour) < 0) continue;
            int prob = probs.isNull(i) ? 0 : probs.getInt(i);
            double mm = amounts.isNull(i) ? 0 : amounts.getDouble(i);
            if (first < 0 && (prob >= 50 || mm >= 0.3)) first = i;
            if (prob > bestProb) {
                bestProb = prob;
                best = i;
            }
        }
        if (first >= 0) {
            String what = isSnow(codes.optInt(first, 0)) ? "Nieve" : "Lluvia";
            String prob = probs.isNull(first) ? "" : " · " + probs.getInt(first) + " %";
            return new String[] { what + " hoy " + times.getString(first).substring(11, 16) + prob, "1" };
        }
        if (bestProb >= 25) {
            return new String[] { "Poca lluvia hoy " + times.getString(best).substring(11, 16) + " · " + bestProb + " %", "0" };
        }
        return new String[] { "Sin lluvia hoy", "0" };
    }

    static boolean isSnow(int code) {
        return (code >= 71 && code <= 77) || code == 85 || code == 86;
    }

    private static String iconKey(int code, boolean isDay) {
        if (code <= 1) return isDay ? "clear_day" : "clear_night";
        if (code == 2) return isDay ? "partly_day" : "partly_night";
        if (code == 3) return "cloudy";
        if (code == 45 || code == 48) return "fog";
        if (code >= 51 && code <= 57) return "drizzle";
        if (isSnow(code)) return "snow";
        if (code == 82 || code >= 95) return "storm";
        return "rain";
    }

    static int iconRes(String key) {
        switch (key) {
            case "clear_day": return R.drawable.wx_clear_day;
            case "clear_night": return R.drawable.wx_clear_night;
            case "partly_day": return R.drawable.wx_partly_day;
            case "partly_night": return R.drawable.wx_partly_night;
            case "fog": return R.drawable.wx_fog;
            case "drizzle": return R.drawable.wx_drizzle;
            case "rain": return R.drawable.wx_rain;
            case "snow": return R.drawable.wx_snow;
            case "storm": return R.drawable.wx_storm;
            default: return R.drawable.wx_cloudy;
        }
    }

    static String describe(int code) {
        switch (code) {
            case 0: return "Despejado";
            case 1: return "Mayormente despejado";
            case 2: return "Parcialmente nuboso";
            case 3: return "Cubierto";
            case 45: return "Niebla";
            case 48: return "Niebla con escarcha";
            case 51: return "Llovizna débil";
            case 53: return "Llovizna";
            case 55: return "Llovizna intensa";
            case 56: case 57: return "Llovizna helada";
            case 61: return "Lluvia débil";
            case 63: return "Lluvia";
            case 65: return "Lluvia fuerte";
            case 66: case 67: return "Lluvia helada";
            case 71: return "Nevada débil";
            case 73: return "Nevada";
            case 75: return "Nevada intensa";
            case 77: return "Granizo fino";
            case 80: return "Chubascos débiles";
            case 81: return "Chubascos";
            case 82: return "Chubascos muy fuertes";
            case 85: case 86: return "Chubascos de nieve";
            case 95: return "Tormenta";
            case 96: case 99: return "Tormenta con granizo";
            default: return "Sin datos";
        }
    }

    private static void render(Context context, AppWidgetManager manager, int[] ids, JSONObject data, boolean stale) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_weather);
        if (data == null) {
            PixelText.set(views, context, R.id.w_temp, "--°", 46, WHITE);
            PixelText.set(views, context, R.id.w_desc, stale ? "Sin conexión" : "Sin ubicación", 18, LILAC);
            PixelText.set(views, context, R.id.w_place, "", 18, LILAC);
            PixelText.set(views, context, R.id.w_maxmin, "", 22, WHITE);
            PixelText.set(views, context, R.id.w_rain, stale
                ? "No se pudo consultar el tiempo"
                : "Abre Meteor Shower y elige tu ubicación", 20, LILAC);
            views.setImageViewResource(R.id.w_icon, R.drawable.wx_partly_day);
            views.setViewVisibility(R.id.w_rain_icon, View.GONE);
            views.setViewVisibility(R.id.w_rain_row, View.VISIBLE);
            PixelText.set(views, context, R.id.w_updated, "", 16, DIM);
        } else {
            boolean wet = data.optBoolean("wet", false);
            PixelText.set(views, context, R.id.w_temp, data.optString("temp", "--°"), 46, WHITE);
            PixelText.set(views, context, R.id.w_desc, data.optString("desc", ""), 18, LILAC);
            PixelText.set(views, context, R.id.w_place, data.optString("place", ""), 18, LILAC);
            PixelText.set(views, context, R.id.w_maxmin, data.optString("maxmin", ""), 22, WHITE);
            // La lluvia solo aparece si va a llover hoy: texto azul con el paraguas pixel
            PixelText.set(views, context, R.id.w_rain, data.optString("rain", ""), 20, BLUE);
            views.setViewVisibility(R.id.w_rain_icon, View.VISIBLE);
            views.setViewVisibility(R.id.w_rain_row, wet ? View.VISIBLE : View.GONE);
            views.setImageViewResource(R.id.w_icon, iconRes(data.optString("icon", "cloudy")));
            PixelText.set(views, context, R.id.w_updated, (stale ? "sin red " : "") + data.optString("updated", ""), 16, DIM);
        }
        PendingIntent open = openApp(context);
        if (open != null) views.setOnClickPendingIntent(R.id.w_root, open);
        // Tocar la hora (con el icono ↻) actualiza sin abrir la app
        views.setOnClickPendingIntent(R.id.w_refresh, refreshIntent(context, true));
        for (int id : ids) manager.updateAppWidget(id, views);
    }
}
