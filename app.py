"""Aplicación local de estimación de expresiones faciales con Login Facial y Supabase."""

from __future__ import annotations

import base64
import binascii
import os
import threading

import cv2
import numpy as np
from fer.fer import FER
from flask import Flask, jsonify, redirect, render_template, request, session, url_for
from werkzeug.security import check_password_hash, generate_password_hash
from supabase import create_client, Client

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 2 * 1024 * 1024
app.secret_key = "clave_secreta_super_segura_cambiar_en_produccion"

# ==========================================
# CONFIGURACIÓN DE SUPABASE (Corregida la URL)
# ==========================================
SUPABASE_URL = "https://xcmfthbsiqaiindwrmik.supabase.co"  
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhjbWZ0aGJzaXFhaWluZHdybWlrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA4NjY3NDMsImV4cCI6MjEwNjQ0Mjc0M30.Go_ec7L1rW_E1CvPBdJrWX6nxBnfIL5sCogzbLeThoY"
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

_detector: FER | None = None
_model_lock = threading.Lock()
_detector_lock = threading.Lock()


def get_detector() -> FER:
    global _detector
    if _detector is None:
        with _model_lock:
            if _detector is None:
                _detector = FER(mtcnn=False)
    return _detector


@app.get("/")
def login_page():
    """Muestra la página de login con reconocimiento facial."""
    if session.get("authenticated"):
        return redirect(url_for("main_app"))
    return render_template("login.html")


@app.get("/register")
def register_page():
    """Muestra la página de registro de nuevos usuarios."""
    if session.get("authenticated"):
        return redirect(url_for("main_app"))
    return render_template("register.html")


@app.post("/api/register")
def api_register():
    """Registra un nuevo usuario guardando credenciales y subiendo su foto a Supabase Storage."""
    email = request.form.get("email")
    password = request.form.get("password")
    face_image_data = request.files.get("face_image")

    if not email or not password or not face_image_data:
        return jsonify({"success": False, "message": "Faltan datos obligatorios."}), 400

    try:
        existing = supabase.table("users").select("email").eq("email", email).execute()
        if existing.data:
            return jsonify({"success": False, "message": "El correo ya está registrado."}), 400
    except Exception:
        app.logger.exception("Error consultando la base de datos de Supabase")
        return jsonify({"success": False, "message": "Error al verificar el usuario."}), 500

    temp_path = f"temp_{email.replace('@', '_').replace('.', '_')}.jpg"
    face_image_data.save(temp_path)

    try:
        with open(temp_path, "rb") as f:
            storage_path = f"{email}/reference.jpg"
            supabase.storage.from_("faces").upload(storage_path, f, file_options={"upsert": "true"})
        
        public_url = supabase.storage.from_("faces").get_public_url(storage_path)
    except Exception:
        app.logger.exception("Error subiendo la imagen a Supabase Storage")
        if os.path.exists(temp_path):
            os.remove(temp_path)
        return jsonify({"success": False, "message": "Error al almacenar la foto de referencia. Asegúrate de crear el bucket 'faces'."}), 500
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)

    password_hash = generate_password_hash(password)
    try:
        supabase.table("users").insert({
            "email": email,
            "password_hash": password_hash,
            "face_image_url": public_url
        }).execute()
    except Exception:
        app.logger.exception("Error guardando el usuario en Supabase DB")
        return jsonify({"success": False, "message": "Error al registrar el usuario en la base de datos. Asegúrate de crear la tabla 'users'."}), 500

    return jsonify({"success": True, "message": "Usuario registrado exitosamente."})


@app.get("/app")
def main_app():
    """Ruta protegida: Muestra el laboratorio de expresiones solo si hay sesión activa."""
    if not session.get("authenticated"):
        return redirect(url_for("login_page"))
    return render_template("index.html")


@app.post("/api/login")
def api_login():
    """Valida el correo, contraseña y compara el rostro de la webcam con la foto de Supabase Storage."""
    payload = request.get_json(silent=True) or {}
    email = payload.get("email", "").strip()
    password = payload.get("password", "")
    image_data = payload.get("image", "")

    if not email or not password:
        return jsonify({"success": False, "message": "Ingresa tu correo y contraseña."}), 400

    if not isinstance(image_data, str) or "," not in image_data:
        return jsonify({"success": False, "message": "No se recibió una imagen válida de la cámara."}), 400

    try:
        response = supabase.table("users").select("*").eq("email", email).execute()
        users = response.data
    except Exception:
        app.logger.exception("Error conectando con Supabase para el login")
        return jsonify({"success": False, "message": "Error interno al validar credenciales."}), 500

    if not users:
        return jsonify({"success": False, "message": "Usuario o contraseña incorrectos."}), 200

    user = users[0]

    if not check_password_hash(user["password_hash"], password):
        return jsonify({"success": False, "message": "Usuario o contraseña incorrectos."}), 200

    try:
        encoded = image_data.split(",", 1)[1]
        raw = base64.b64decode(encoded, validate=True)
        image_array = cv2.imdecode(np.frombuffer(raw, dtype=np.uint8), cv2.IMREAD_COLOR)
    except (ValueError, binascii.Error):
        return jsonify({"success": False, "message": "La imagen recibida no se pudo leer."}), 400

    if image_array is None or image_array.size == 0:
        return jsonify({"success": False, "message": "La imagen recibida no se pudo leer."}), 400

    try:
        with _detector_lock:
            faces = get_detector().detect_emotions(image_array)
    except Exception:
        app.logger.exception("Falló la inferencia del modelo FER en el login")
        return jsonify({"success": False, "message": "Error al procesar el rostro."}), 500

    if not faces:
        return jsonify({"success": False, "message": "No se detectó ningún rostro. Acércate a la cámara."}), 200

    face_image_url = user.get("face_image_url")
    if face_image_url:
        try:
            import urllib.request
            temp_ref_path = f"temp_ref_{email.replace('@', '_').replace('.', '_')}.jpg"
            urllib.request.urlretrieve(face_image_url, temp_ref_path)
            
            ref_img = cv2.imread(temp_ref_path)
            if os.path.exists(temp_ref_path):
                os.remove(temp_ref_path)

            if ref_img is not None:
                gray_login = cv2.cvtColor(image_array, cv2.COLOR_BGR2GRAY)
                gray_ref = cv2.cvtColor(ref_img, cv2.COLOR_BGR2GRAY)
                
                hist_login = cv2.calcHist([gray_login], [0], None, [64], [0, 256])
                hist_ref = cv2.calcHist([gray_ref], [0], None, [64], [0, 256])
                
                cv2.normalize(hist_login, hist_login, alpha=0, beta=1, norm_type=cv2.NORM_MINMAX)
                cv2.normalize(hist_ref, hist_ref, alpha=0, beta=1, norm_type=cv2.NORM_MINMAX)
                
                similarity = cv2.compareHist(hist_ref, hist_login, cv2.HISTCMP_CORREL)
                
                if similarity < 0.35:
                    return jsonify({"success": False, "message": "El rostro no coincide con el usuario autorizado."}), 200
        except Exception:
            app.logger.exception("Error descargando o comparando la imagen de referencia desde Supabase")

    session["authenticated"] = True
    session["user_email"] = email
    return jsonify({"success": True})


@app.get("/api/logout")
def logout():
    """Cierra la sesión del usuario."""
    session.clear()
    return redirect(url_for("login_page"))


@app.post("/api/predict")
def predict():
    """Ruta protegida del modelo de expresiones."""
    if not session.get("authenticated"):
        return jsonify({"error": "No autorizado"}), 401

    payload = request.get_json(silent=True) or {}
    image_data = payload.get("image", "")
    if not isinstance(image_data, str) or "," not in image_data:
        return jsonify({"error": "No se recibió una imagen válida."}), 400

    try:
        encoded = image_data.split(",", 1)[1]
        raw = base64.b64decode(encoded, validate=True)
        image_array = cv2.imdecode(np.frombuffer(raw, dtype=np.uint8), cv2.IMREAD_COLOR)
    except (ValueError, binascii.Error):
        return jsonify({"error": "La imagen recibida no se pudo leer."}), 400

    if image_array is None or image_array.size == 0:
        return jsonify({"error": "La imagen recibida no se pudo leer."}), 400

    height, width = image_array.shape[:2]
    max_side = 640
    scale = min(1.0, max_side / max(width, height))
    if scale < 1:
        image_array = cv2.resize(
            image_array, (round(width * scale), round(height * scale)), interpolation=cv2.INTER_AREA
        )

    try:
        with _detector_lock:
            faces = get_detector().detect_emotions(image_array)
    except Exception:
        app.logger.exception("Falló la inferencia del modelo FER")
        return jsonify({"error": "El modelo no pudo analizar este fotograma."}), 500

    if not faces:
        return jsonify({"faces": [], "width": image_array.shape[1], "height": image_array.shape[0]})

    id_face = max(faces, key=lambda item: item["box"][2] * item["box"][3])
    x, y, box_width, box_height = [int(value) for value in id_face["box"]]
    return jsonify(
        {
            "faces": [
                {
                    "box": [x, y, box_width, box_height],
                    "expressions": id_face["emotions"],
                }
            ],
            "width": image_array.shape[1],
            "height": image_array.shape[0],
        }
    )


@app.errorhandler(413)
def too_large(_error):
    return jsonify({"error": "El fotograma es demasiado grande."}), 413


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=False, threaded=True)
