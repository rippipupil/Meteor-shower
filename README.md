# Meteor Shower

<img src="icon-192.png" alt="Icono de Meteor Shower: un meteorito en pixel art" width="96" height="96">

App meteorológica sencilla: pide tu ubicación (o busca una ciudad) y muestra el tiempo de hoy, de la semana y del mes con datos reales.

## Qué incluye

- **Hoy**: temperatura actual y sensación térmica, resumen con consejos (paraguas, protección solar, frío, viento), gráfico de las próximas 24 horas, humedad, viento, lluvia, índice UV, nubosidad, presión, visibilidad, amanecer y atardecer, y comparación con la media de los últimos 10 años.
- **Semana**: previsión de 7 días con máximas, mínimas, probabilidad de lluvia y detalles de cada día.
- **Mes**: los próximos 30 días en calendario y gráfico. Los 16 primeros son previsión real; como no existe previsión fiable día a día más allá, el resto muestra la media real de los últimos 10 años en esa zona, claramente marcada.
- Recuerda la ubicación, cambia entre °C y °F y se actualiza sola al volver a la app.

## Instalar en Android

[**Descargar Meteor Shower para Android (APK)**](https://github.com/rippipupil/meteor-shower/releases/latest/download/meteor-shower.apk)

En el móvil, descarga el archivo, ábrelo y confirma la instalación. Android puede pedir permiso para instalar aplicaciones descargadas desde el navegador. La primera vez que pulses «Usar mi ubicación», la app pedirá permiso para acceder a tu ubicación.

El APK se genera automáticamente con GitHub Actions cada vez que se actualiza la rama `main` y se publica en [Releases](https://github.com/rippipupil/meteor-shower/releases). Todos se firman con la misma clave (`debug.keystore`), así que cada versión nueva se instala encima de la anterior como una actualización.

## Abrirla en el navegador

Se publica automáticamente en GitHub Pages con cada cambio en `main` (en *Settings → Pages*, elige **GitHub Actions** como origen la primera vez) y queda en `https://rippipupil.github.io/meteor-shower/`. Desde el móvil se puede instalar como app con «Añadir a pantalla de inicio».

Para probarla en local basta con servir la carpeta, por ejemplo con `python3 -m http.server`, y abrir `http://localhost:8000`. La geolocalización del navegador solo funciona desde `https://` o `localhost`, no abriendo `index.html` directamente como archivo.

## Datos

Todas las fuentes son gratuitas y no necesitan clave:

- [Open-Meteo](https://open-meteo.com/) (CC BY 4.0): previsión a partir de los modelos de los servicios meteorológicos nacionales, y reanálisis ERA5 de Copernicus para los históricos.
- [BigDataCloud](https://www.bigdatacloud.com/): nombre de la localidad a partir de las coordenadas.
