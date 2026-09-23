package com.rippipupil.meteorshower;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Typeface;
import android.util.DisplayMetrics;
import android.util.TypedValue;
import android.widget.RemoteViews;

import androidx.core.content.res.ResourcesCompat;

/**
 * Dibuja textos con la fuente pixel VT323 como imagen. Los widgets no pueden
 * usar fuentes propias en sus TextView (el launcher usa la del sistema), así
 * que cada texto del widget es un ImageView con esta imagen.
 */
final class PixelText {

    private static Typeface font;

    private PixelText() {}

    private static Typeface font(Context context) {
        if (font == null) {
            try {
                font = ResourcesCompat.getFont(context, R.font.vt323);
            } catch (Exception ignored) {
                font = null;
            }
            if (font == null) font = Typeface.MONOSPACE;
        }
        return font;
    }

    static Bitmap bitmap(Context context, String text, float sp, int color) {
        DisplayMetrics metrics = context.getResources().getDisplayMetrics();
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        paint.setTypeface(font(context));
        paint.setTextSize(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_SP, sp, metrics));
        paint.setColor(color);
        String value = text == null || text.isEmpty() ? " " : text;
        Paint.FontMetricsInt fm = paint.getFontMetricsInt();
        int width = Math.max(1, (int) Math.ceil(paint.measureText(value)));
        int height = Math.max(1, fm.descent - fm.ascent);
        Bitmap bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
        bitmap.setDensity(metrics.densityDpi);
        new Canvas(bitmap).drawText(value, 0, -fm.ascent, paint);
        return bitmap;
    }

    /** Pone el texto pixel en un ImageView del widget (y lo deja legible para TalkBack). */
    static void set(RemoteViews views, Context context, int id, String text, float sp, int color) {
        views.setImageViewBitmap(id, bitmap(context, text, sp, color));
        views.setContentDescription(id, text);
    }
}
