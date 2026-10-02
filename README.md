# Mirada — Sistema Python de expresiones faciales

Aplicación web local con Flask, OpenCV y el paquete FER. FER utiliza una red neuronal convolucional preentrenada para estimar siete categorías de expresión. La cámara se abre en el navegador después de pulsar el botón; cada fotograma se envía al servidor Flask que corre en **tu propio equipo** para analizarlo. No se suben imágenes a un servicio remoto ni se guardan en disco.

> Las categorías describen patrones visuales estimados por un modelo. No determinan con certeza emociones, intenciones ni estados de salud.

## Requisitos

- Windows 10/11 y Python 3.10 u 3.11 de 64 bits.
- Conexión a internet durante la instalación inicial para descargar las dependencias. Después, el detector Haar y los pesos FER se cargan desde el paquete instalado.
- Cámara y navegador moderno.

## Inicio rápido en Windows

1. Extrae el ZIP completo a una carpeta.
2. Instala Python si aún no está instalado y marca la opción para añadir Python al `PATH`.
3. Haz doble clic en `run.bat`. La primera instalación puede tardar varios minutos porque TensorFlow descarga dependencias pesadas.
4. Cuando aparezca que Flask está ejecutándose, abre [http://127.0.0.1:5000](http://127.0.0.1:5000).
5. Pulsa **Iniciar cámara** y concede el permiso del navegador.

Si ya instalaste las dependencias, activa el entorno `.venv` y ejecuta `python app.py` para iniciar de nuevo.

## Inicio manual

En la carpeta del proyecto, abre PowerShell:

```powershell
py -3.11 -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
python app.py
```

## Archivos

- `app.py`: servidor Flask y endpoint `/api/predict`; decodifica imágenes con OpenCV y consulta FER.
- `templates/index.html`: interfaz web.
- `static/app.js`: permisos y captura de cámara, envío de fotogramas al backend y render de las predicciones.
- `requirements.txt`: dependencias Python fijadas.
- `run.bat`: instalación y lanzamiento en Windows.

El servidor escucha únicamente en `127.0.0.1` (tu equipo). Los fotogramas viajan por la conexión local entre el navegador y Flask y se descartan después de cada predicción.
