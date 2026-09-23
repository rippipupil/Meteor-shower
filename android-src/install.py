"""Añade el código nativo propio al proyecto Android que genera Capacitor.

`npx cap add android` crea la carpeta android/ desde cero en cada build, así
que el widget, el puente con la web y los permisos viven en android-src/ y
este script los copia dentro. Se puede ejecutar varias veces sin duplicar nada.
"""
import os
import pathlib
import re
import shutil
import sys

ROOT = pathlib.Path(__file__).resolve().parent
APP = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else 'android') / 'app' / 'src' / 'main'
PACKAGE_DIR = APP / 'java' / 'com' / 'rippipupil' / 'meteorshower'

# 1. Código Java (MainActivity sustituye a la que genera Capacitor)
PACKAGE_DIR.mkdir(parents=True, exist_ok=True)
for source in (ROOT / 'java').glob('*.java'):
    shutil.copy(source, PACKAGE_DIR / source.name)

# 2. Recursos: layouts, iconos, fuente y metadatos del widget
for source in (ROOT / 'res').rglob('*'):
    if source.is_file():
        target = APP / 'res' / source.relative_to(ROOT / 'res')
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(source, target)

# 3. Manifiesto: permisos de ubicación y registro del widget
manifest_path = APP / 'AndroidManifest.xml'
manifest = manifest_path.read_text(encoding='utf-8')

PERMISSIONS = """    <uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
    <uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />
    <uses-permission android:name="android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS" />
    <!-- Reloj del widget: redibujar la hora cada minuto -->
    <uses-permission android:name="android.permission.USE_EXACT_ALARM" />
    <uses-permission android:name="android.permission.SCHEDULE_EXACT_ALARM" android:maxSdkVersion="32" />
    <uses-feature android:name="android.hardware.location" android:required="false" />
"""
RECEIVER = """        <receiver
            android:name=".WeatherWidgetProvider"
            android:exported="false"
            android:label="@string/widget_label">
            <intent-filter>
                <action android:name="android.appwidget.action.APPWIDGET_UPDATE" />
            </intent-filter>
            <meta-data
                android:name="android.appwidget.provider"
                android:resource="@xml/weather_widget_info" />
        </receiver>
        <receiver
            android:name=".ClockWidgetProvider"
            android:exported="false"
            android:label="@string/clock_widget_label">
            <intent-filter>
                <action android:name="android.appwidget.action.APPWIDGET_UPDATE" />
                <action android:name="android.intent.action.TIME_SET" />
                <action android:name="android.intent.action.TIMEZONE_CHANGED" />
            </intent-filter>
            <meta-data
                android:name="android.appwidget.provider"
                android:resource="@xml/clock_widget_info" />
        </receiver>
        <receiver
            android:name=".WeekWidgetProvider"
            android:exported="false"
            android:label="@string/week_widget_label">
            <intent-filter>
                <action android:name="android.appwidget.action.APPWIDGET_UPDATE" />
            </intent-filter>
            <meta-data
                android:name="android.appwidget.provider"
                android:resource="@xml/week_widget_info" />
        </receiver>
        <receiver
            android:name=".NotifyReceiver"
            android:exported="false">
            <intent-filter>
                <action android:name="android.intent.action.BOOT_COMPLETED" />
                <action android:name="android.intent.action.MY_PACKAGE_REPLACED" />
            </intent-filter>
        </receiver>
"""
if 'ACCESS_COARSE_LOCATION' not in manifest:
    manifest = manifest.replace('</manifest>', PERMISSIONS + '</manifest>', 1)
if 'WeatherWidgetProvider' not in manifest:
    if '</application>' not in manifest:
        sys.exit('No se encontró </application> en el manifiesto')
    manifest = re.sub(r'\n([ \t]*)</application>', lambda m: '\n' + RECEIVER + m.group(1) + '</application>', manifest, count=1)
manifest_path.write_text(manifest, encoding='utf-8')

# 4. Versión: cada build tiene un número mayor que el anterior, para que
#    Android trate cada APK nuevo como una actualización de la app instalada.
version_code = int(os.environ.get('VERSION_CODE', '1'))
gradle_path = APP.parent.parent / 'build.gradle'
gradle = gradle_path.read_text(encoding='utf-8')
gradle = re.sub(r'versionCode \d+', f'versionCode {version_code}', gradle, count=1)
gradle = re.sub(r'versionName "[^"]*"', f'versionName "1.{version_code}"', gradle, count=1)
gradle_path.write_text(gradle, encoding='utf-8')
print('Widget y permisos añadidos a', APP, '· versión', f'1.{version_code}', f'({version_code})')
