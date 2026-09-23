"""Añade el código nativo propio al proyecto Android que genera Capacitor.

`npx cap add android` crea la carpeta android/ desde cero en cada build, así
que el widget, el puente con la web y los permisos viven en android-src/ y
este script los copia dentro. Se puede ejecutar varias veces sin duplicar nada.
"""
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
"""
if 'ACCESS_COARSE_LOCATION' not in manifest:
    manifest = manifest.replace('</manifest>', PERMISSIONS + '</manifest>', 1)
if 'WeatherWidgetProvider' not in manifest:
    if '</application>' not in manifest:
        sys.exit('No se encontró </application> en el manifiesto')
    manifest = re.sub(r'\n([ \t]*)</application>', lambda m: '\n' + RECEIVER + m.group(1) + '</application>', manifest, count=1)
manifest_path.write_text(manifest, encoding='utf-8')
print('Widget y permisos añadidos a', APP)
