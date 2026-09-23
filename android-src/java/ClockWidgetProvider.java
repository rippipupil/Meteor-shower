package com.rippipupil.meteorshower;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.text.format.DateFormat;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONObject;

import java.util.Calendar;
import java.util.Locale;

/**
 * Widget pequeño (2×1): la hora y la fecha como un reloj, con el icono del
 * cielo y los grados, todo en la fuente pixel. Como los widgets no admiten
 * fuentes propias, la hora es una imagen que se redibuja cada minuto con una
 * alarma exacta que no despierta el móvil (con la pantalla apagada espera y
 * salta al encenderla). Si Android no deja usar alarmas exactas, se usa el
 * reloj del sistema (TextClock) para que la hora nunca se quede parada.
 */
public class ClockWidgetProvider extends WeatherWidgetProvider {

    static final String ACTION_TICK = "com.rippipupil.meteorshower.CLOCK_TICK";
    private static final String[] DAYS = { "dom", "lun", "mar", "mié", "jue", "vie", "sáb" };
    private static final String[] MONTHS = { "ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic" };

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        if (ACTION_TICK.equals(action) || Intent.ACTION_TIME_CHANGED.equals(action)
            || Intent.ACTION_TIMEZONE_CHANGED.equals(action)) {
            tick(context);
            return;
        }
        super.onReceive(context, intent);
    }

    @Override
    public void onDisabled(Context context) {
        AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (am != null) am.cancel(tickIntent(context));
        super.onDisabled(context);
    }

    /** Cambia solo la hora y la fecha, y programa el siguiente minuto. */
    private static void tick(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, ClockWidgetProvider.class));
        if (ids.length == 0) return;
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_clock);
        drawTime(context, views);
        manager.partiallyUpdateAppWidget(ids, views);
    }

    private static boolean canTick(Context context) {
        if (Build.VERSION.SDK_INT < 31) return true;
        AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        return am != null && am.canScheduleExactAlarms();
    }

    private static void drawTime(Context context, RemoteViews views) {
        boolean pixel = canTick(context);
        views.setViewVisibility(R.id.c_time, pixel ? View.VISIBLE : View.GONE);
        views.setViewVisibility(R.id.c_date, pixel ? View.VISIBLE : View.GONE);
        views.setViewVisibility(R.id.c_time_sys, pixel ? View.GONE : View.VISIBLE);
        views.setViewVisibility(R.id.c_date_sys, pixel ? View.GONE : View.VISIBLE);
        if (!pixel) return;
        Calendar now = Calendar.getInstance();
        int hour = now.get(Calendar.HOUR_OF_DAY);
        if (!DateFormat.is24HourFormat(context)) hour = hour % 12 == 0 ? 12 : hour % 12;
        String time = String.format(Locale.US, DateFormat.is24HourFormat(context) ? "%02d:%02d" : "%d:%02d", hour, now.get(Calendar.MINUTE));
        String date = DAYS[now.get(Calendar.DAY_OF_WEEK) - 1] + " " + now.get(Calendar.DAY_OF_MONTH) + " " + MONTHS[now.get(Calendar.MONTH)];
        PixelText.set(views, context, R.id.c_time, time, 44, WHITE);
        PixelText.set(views, context, R.id.c_date, date, 17, DIM);
        scheduleTick(context, now);
    }

    private static void scheduleTick(Context context, Calendar now) {
        AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        Calendar next = (Calendar) now.clone();
        next.set(Calendar.SECOND, 0);
        next.set(Calendar.MILLISECOND, 0);
        next.add(Calendar.MINUTE, 1);
        try {
            // RTC (no «WAKEUP»): con la pantalla apagada no despierta el móvil
            am.setExact(AlarmManager.RTC, next.getTimeInMillis(), tickIntent(context));
        } catch (SecurityException ignored) {
            // Sin permiso de alarmas exactas: el siguiente dibujado usará TextClock
        }
    }

    private static PendingIntent tickIntent(Context context) {
        Intent intent = new Intent(context, ClockWidgetProvider.class);
        intent.setAction(ACTION_TICK);
        return PendingIntent.getBroadcast(context, 30, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static void render(Context context, AppWidgetManager manager, int[] ids, JSONObject data) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_clock);
        drawTime(context, views);
        String temp = data == null ? "--°" : data.optString("temp", "--°");
        PixelText.set(views, context, R.id.c_temp, temp, 36, WHITE);
        views.setImageViewResource(R.id.c_icon, data == null ? R.drawable.wx_partly_day : iconRes(data.optString("icon", "cloudy")));
        PendingIntent open = openApp(context);
        if (open != null) views.setOnClickPendingIntent(R.id.c_root, open);
        for (int id : ids) manager.updateAppWidget(id, views);
    }
}
