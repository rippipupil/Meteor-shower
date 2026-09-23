# Meteor Shower

<img src="icon-192.png" alt="Icono de Meteor Shower: un meteorito en pixel art" width="96" height="96">

App meteorológica sencilla con estilo pixel retro en violeta: pide tu ubicación (o busca una ciudad) y muestra el tiempo de hoy, de la semana y del mes con datos reales. Incluye un widget para la pantalla de inicio de Android.

## Qué incluye

- **Hoy**: temperatura actual y sensación térmica, resumen con consejos (paraguas, protección solar, frío, viento), gráfico de las próximas 24 horas, humedad, viento, lluvia, índice UV, nubosidad, presión, visibilidad, amanecer y atardecer, y comparación con la media de los últimos 10 años.
- **Semana**: previsión de 7 días con máximas, mínimas, probabilidad de lluvia y detalles de cada día.
- **Mes**: los próximos 30 días en calendario y gráfico. Los 16 primeros son previsión real; como no existe previsión fiable día a día más allá, el resto muestra la media real de los últimos 10 años en esa zona, claramente marcada.
- Recuerda la ubicación, cambia entre °C y °F y se actualiza sola al volver a la app.
- Estilo pixel retro inspirado en el reproductor [starseeked](https://github.com/rippipupil/Starseeked): pantallas LCD, iconos del tiempo en pixel art y burbujas subiendo por el fondo.

## Instalar en Android

[**Descargar Meteor Shower para Android (APK)**](https://github.com/rippipupil/meteor-shower/releases/latest/download/meteor-shower.apk)

En el móvil, descarga el archivo, ábrelo y confirma la instalación. Android puede pedir permiso para instalar aplicaciones descargadas desde el navegador. La primera vez que pulses «Usar mi ubicación», la app pedirá permiso para acceder a tu ubicación.

El APK se genera automáticamente con GitHub Actions cada vez que se actualiza la rama `main` y se publica en [Releases](https://github.com/rippipupil/meteor-shower/releases). Todos se firman con la misma clave (`debug.keystore`), así que cada versión nueva se instala encima de la anterior como una actualización.

### Widget de la pantalla de inicio

Con la app instalada, mantén pulsado un hueco de la pantalla de inicio, toca **Widgets** y arrastra **Meteor Shower**. El widget muestra:

- los grados actuales y la máxima y mínima del día,
- un icono en pixel art del cielo (soleado, nublado, lluvia, nieve, tormenta, niebla, de día o de noche),
- si va a llover hoy y a qué hora (por ejemplo «Lluvia hoy 17:00 · 60 %» o «Sin lluvia hoy»).

Usa la ubicación que elijas en la app y se actualiza solo cada 30 minutos, sin tener que abrirla. Al tocarlo se abre la app. Su código nativo está en `android-src/` y se añade al proyecto Android durante el build.

## Abrirla en el navegador

Se publica automáticamente en GitHub Pages con cada cambio en `main` (en *Settings → Pages*, elige **GitHub Actions** como origen la primera vez) y queda en `https://rippipupil.github.io/meteor-shower/`. Desde el móvil se puede instalar como app con «Añadir a pantalla de inicio».

Para probarla en local basta con servir la carpeta, por ejemplo con `python3 -m http.server`, y abrir `http://localhost:8000`. La geolocalización del navegador solo funciona desde `https://` o `localhost`, no abriendo `index.html` directamente como archivo.

## Datos

Todas las fuentes son gratuitas y no necesitan clave:

- [Open-Meteo](https://open-meteo.com/) (CC BY 4.0): previsión a partir de los modelos de los servicios meteorológicos nacionales, y reanálisis ERA5 de Copernicus para los históricos.
- [BigDataCloud](https://www.bigdatacloud.com/): nombre de la localidad a partir de las coordenadas.

## Fuentes tipográficas

[Pixelify Sans](https://github.com/eifetx/Pixelify-Sans), [VT323](https://fonts.google.com/specimen/VT323) y [DM Sans](https://github.com/googlefonts/dm-fonts), incluidas en `fonts/` bajo la licencia SIL Open Font License 1.1 (ver `fonts/LICENSES.txt`).
