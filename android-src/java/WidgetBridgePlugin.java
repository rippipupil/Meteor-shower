package com.rippipupil.meteorshower;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Puente entre la app web y el widget: la web llama a
 * Capacitor.Plugins.WidgetBridge.setPlace({ lat, lon, name, unit }) y el
 * widget pasa a mostrar el tiempo de ese lugar.
 */
@CapacitorPlugin(name = "WidgetBridge")
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
}
