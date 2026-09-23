package com.rippipupil.meteorshower;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Widget de semana (4×2): los próximos 5 días en columnas, con el icono del
 * cielo, la máxima, la mínima y la probabilidad de lluvia si es alta.
 */
public class WeekWidgetProvider extends WeatherWidgetProvider {

    private static final int[][] CELLS = {
        { R.id.d0_name, R.id.d0_icon, R.id.d0_max, R.id.d0_min, R.id.d0_rain },
        { R.id.d1_name, R.id.d1_icon, R.id.d1_max, R.id.d1_min, R.id.d1_rain },
        { R.id.d2_name, R.id.d2_icon, R.id.d2_max, R.id.d2_min, R.id.d2_rain },
        { R.id.d3_name, R.id.d3_icon, R.id.d3_max, R.id.d3_min, R.id.d3_rain },
        { R.id.d4_name, R.id.d4_icon, R.id.d4_max, R.id.d4_min, R.id.d4_rain }
    };

    static void render(Context context, AppWidgetManager manager, int[] ids, JSONObject data) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_week);
        JSONArray days = data == null ? null : data.optJSONArray("days");
        PixelText.set(views, context, R.id.k_place, data == null ? "Abre Meteor Shower" : data.optString("place", ""), 18, LILAC);
        for (int i = 0; i < CELLS.length; i++) {
            JSONObject d = days == null ? null : days.optJSONObject(i);
            int[] c = CELLS[i];
            if (d == null) {
                PixelText.set(views, context, c[0], "–", 18, LILAC);
                PixelText.set(views, context, c[2], "", 22, WHITE);
                PixelText.set(views, context, c[3], "", 18, DIM);
                views.setViewVisibility(c[4], View.INVISIBLE);
                continue;
            }
            int rain = d.optInt("rain", 0);
            PixelText.set(views, context, c[0], d.optString("name"), 18, LILAC);
            views.setImageViewResource(c[1], iconRes(d.optString("icon", "cloudy")));
            PixelText.set(views, context, c[2], d.optString("max"), 22, WHITE);
            PixelText.set(views, context, c[3], d.optString("min"), 18, DIM);
            PixelText.set(views, context, c[4], rain + " %", 16, BLUE);
            // Solo se enseña la lluvia cuando es probable, en azul como en el widget grande
            views.setViewVisibility(c[4], rain >= 30 ? View.VISIBLE : View.INVISIBLE);
        }
        PendingIntent open = openApp(context);
        if (open != null) views.setOnClickPendingIntent(R.id.k_root, open);
        for (int id : ids) manager.updateAppWidget(id, views);
    }
}
