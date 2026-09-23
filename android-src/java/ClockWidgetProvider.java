package com.rippipupil.meteorshower;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.widget.RemoteViews;

import org.json.JSONObject;

/**
 * Widget pequeño (2×1): la hora y la fecha como un reloj, con el icono del
 * cielo y los grados. La hora la mueve el propio Android (TextClock), sin
 * gastar batería; el tiempo lo actualiza el motor de WeatherWidgetProvider.
 */
public class ClockWidgetProvider extends WeatherWidgetProvider {

    static void render(Context context, AppWidgetManager manager, int[] ids, JSONObject data) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_clock);
        if (data == null) {
            views.setTextViewText(R.id.c_temp, "--°");
            views.setImageViewResource(R.id.c_icon, R.drawable.wx_partly_day);
        } else {
            views.setTextViewText(R.id.c_temp, data.optString("temp", "--°"));
            views.setImageViewResource(R.id.c_icon, iconRes(data.optString("icon", "cloudy")));
        }
        PendingIntent open = openApp(context);
        if (open != null) views.setOnClickPendingIntent(R.id.c_root, open);
        for (int id : ids) manager.updateAppWidget(id, views);
    }
}
