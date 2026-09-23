# Meteor Shower

<img src="icon-192.png" alt="Icono de Meteor Shower: un meteorito en pixel art" width="96" height="96">

App meteorológica sencilla con estilo pixel retro en violeta: pide tu ubicación (o busca una ciudad) y muestra el tiempo de hoy, de la semana y del mes con datos reales. Incluye un widget para la pantalla de inicio de Android.

## Qué incluye

- **Hoy**: temperatura actual y sensación térmica, resumen con consejos (paraguas, protección solar, frío, viento), gráfico de las próximas 24 horas, humedad, viento, lluvia, índice UV, nubosidad, presión, visibilidad, amanecer y atardecer, y comparación con la media de los últimos 10 años.
- **Semana**: previsión de 7 días con máximas, mínimas, probabilidad de lluvia y detalles de cada día.
- **Mes**: los próximos 30 días en calendario y gráfico. Los 16 primeros son previsión real; como no existe previsión fiable día a día más allá, el resto muestra la media real de los últimos 10 años en esa zona, claramente marcada.
- **Radar**: la lluvia de las últimas 2 horas sobre el mapa, animada cada 10 minutos, con tu lugar marcado y zoom (radar de [RainViewer](https://www.rainviewer.com/), mapa de © OpenStreetMap y © CARTO).
- Recuerda la ubicación, cambia entre °C y °F y se actualiza sola al volver a la app.
- Estilo pixel retro en violeta oscuro inspirado en el reproductor [starseeked](https://github.com/rippipupil/Starseeked): paneles y botones con marcos pixel art (`frames/`), pantallas LCD, iconos del tiempo en pixel art (`icons/`) y burbujas subiendo por el fondo.

## Instalar en Android

[**Descargar Meteor Shower para Android (APK)**](https://github.com/rippipupil/meteor-shower/releases/latest/download/meteor-shower.apk)

En el móvil, descarga el archivo, ábrelo y confirma la instalación. Android puede pedir permiso para instalar aplicaciones descargadas desde el navegador. La primera vez que pulses «Usar mi ubicación», la app pedirá permiso para acceder a tu ubicación.

El APK se genera automáticamente con GitHub Actions cada vez que se actualiza la rama `main` y se publica en [Releases](https://github.com/rippipupil/meteor-shower/releases). Es una versión *release* (no de depuración) firmada siempre con la misma clave y con un número de versión que sube en cada build, así que cada APK nuevo se instala encima del anterior como una actualización.

Como la app no viene de Google Play, Play Protect puede mostrar un aviso al instalarla («app desconocida» o «analizar app»). Pulsa **Más detalles → Instalar de todos modos** o **Analizar app** y después instala.

### Firma del APK

La clave de firma **no está en el repositorio**: con ella cualquiera podría firmar una actualización falsa de la app. El build la lee de dos secretos del repositorio (*Settings → Secrets and variables → Actions → New repository secret*):

- `RELEASE_KEYSTORE_BASE64`: el archivo de la clave (`.keystore`) codificado en base64.
- `RELEASE_KEYSTORE_PASSWORD`: su contraseña (el alias de la clave es `meteorshower`).

Si faltan, el build se detiene con un aviso y no publica nada. Guarda una copia de la clave en un sitio seguro: si se pierde, las versiones nuevas tendrían que firmarse con otra clave y habría que desinstalar la app una vez para instalarlas.

### Widget de la pantalla de inicio

Con la app instalada, mantén pulsado un hueco de la pantalla de inicio, toca **Widgets** y arrastra **Meteor Shower**. El widget muestra:

- los grados actuales y la máxima y mínima del día,
- un icono en pixel art del cielo (soleado, nublado, lluvia, nieve, tormenta, niebla, de día o de noche),
- si va a llover hoy y a qué hora, en azul con un paraguas pixel (por ejemplo «Lluvia hoy 17:00 · 60 %»). Si no va a llover, esa línea no aparece.

Usa la ubicación que elijas en la app y se actualiza solo cada 30 minutos, sin tener que abrirla (también tras reiniciar el móvil). Abajo a la derecha muestra la hora de la última actualización: tocando **↻** se actualiza al momento. Al tocar el resto del widget se abre la app.

Si Android está ahorrando batería con la app, en la tarjeta **Avisos** aparece un botón **Permitir** para dejar que el widget y los avisos se actualicen en segundo plano. En algunos móviles (Xiaomi, Huawei, Samsung…) conviene además activar el *inicio automático* o quitar la app de «apps en suspensión». Su código nativo está en `android-src/` y se añade al proyecto Android durante el build.

### Avisos

En la tarjeta **Avisos** de la pestaña Hoy (solo en la app de Android) se pueden activar:

- **Resumen de la mañana**: una notificación diaria, a la hora que elijas, con el tiempo del día y si va a llover.
- **Si va a llover en 1 hora**: la app comprueba la previsión cada ~30 minutos y avisa si la próxima franja horaria trae lluvia (probabilidad ≥ 60 % o ≥ 0,5 mm). Como mucho un aviso cada 3 horas y nunca entre las 23:00 y las 07:00.

Ambos usan el lugar principal (★), el mismo que el widget. Android puede retrasarlos unos minutos para ahorrar batería. El código está en `android-src/java/NotifyReceiver.java`.

## Abrirla en el navegador

Se publica automáticamente en GitHub Pages con cada cambio en `main` (en *Settings → Pages*, elige **GitHub Actions** como origen la primera vez) y queda en `https://rippipupil.github.io/meteor-shower/`. Desde el móvil se puede instalar como app con «Añadir a pantalla de inicio».

Para probarla en local basta con servir la carpeta, por ejemplo con `python3 -m http.server`, y abrir `http://localhost:8000`. La geolocalización del navegador solo funciona desde `https://` o `localhost`, no abriendo `index.html` directamente como archivo.

## Datos

Todas las fuentes son gratuitas y no necesitan clave:

- [Open-Meteo](https://open-meteo.com/) (CC BY 4.0): previsión a partir de los modelos de los servicios meteorológicos nacionales, y reanálisis ERA5 de Copernicus para los históricos.
- [BigDataCloud](https://www.bigdatacloud.com/): nombre de la localidad a partir de las coordenadas.

## Fuentes tipográficas

[Pixelify Sans](https://github.com/eifetx/Pixelify-Sans), [VT323](https://fonts.google.com/specimen/VT323) y [DM Sans](https://github.com/googlefonts/dm-fonts), incluidas en `fonts/` bajo la licencia SIL Open Font License 1.1 (ver `fonts/LICENSES.txt`).
