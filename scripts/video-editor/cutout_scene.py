#!/usr/bin/env python3
"""
Compone una escena especial recortando a Nacho del fondo real con MediaPipe Selfie Segmentation.
Tres modos: fondo blanco, lluvia de billetes, o "depth" (el fondo real sin tocar, con el subtítulo
dibujado detrás de la persona — ver más abajo). Pensado para tramos CORTOS (unos pocos segundos) del
video, no para el clip entero — por eso procesa un rango [start,end] en vez de todo el archivo.

Dependencias (no están en package.json porque esto corre con python3, no con Node):
  pip3 install mediapipe opencv-python-headless pillow numpy
Modelo y fuente ya incluidos en assets/ (selfie_segmenter.tflite, archivo-italic.ttf) — no hace
falta bajarlos de nuevo.

whitebg/moneyrain siguen sin engancharse al cron automático: salen de frases puntuales de UN guión
(25-11-2026, "Que no te tomen el pelo"), se corren a mano. El modo "depth" SÍ está enganchado al
pipeline automático (26-11-2026, ver lib/video-editor/depth-captions.ts y lib/agents/video-editor.ts)
— para ALGUNAS oraciones de CUALQUIER video, automático, no una frase puntual. `--captions` espera
una lista de GRUPOS por oración (no una lista plana de palabras):
`[{"start":S,"end":E,"words":[{"text":"...","start":s}]}]`, todo en segundos relativos al arranque
de la escena — así cada oración limpia la pantalla antes de que empiece la siguiente, en vez de ir
acumulando líneas hasta salirse del cuadro.

Uso:
  python3 cutout_scene.py --video <mp4> --start S --end E --mode whitebg|moneyrain|depth --out <mp4> \
      --model assets/selfie_segmenter.tflite [--captions <json-de-oraciones>]
"""
import argparse
import json
import math
import os
import random
import shutil
import subprocess
import sys
import tempfile

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision

FONT_PATH = os.path.join(os.path.dirname(__file__), "assets", "archivo-italic.ttf")
# Tipografía premium (refresco 26-11-2026) — pedido explícito: "la letra que usás para el detrás es
# horrible... buscá letras premium, sutiles, detalladas". Playfair Display itálica (variable, un solo
# eje "wght" 400-900, a diferencia de Archivo que tiene wght+wdth) reemplaza a Archivo en estas
# escenas. Es la MISMA familia que ahora usa ReelComposition.tsx para los subtítulos normales —
# consistencia entre el texto de frente y el de atrás.
FONT_PATH_PREMIUM = os.path.join(os.path.dirname(__file__), "assets", "PlayfairDisplay-Italic.ttf")


def run(cmd):
    p = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if p.returncode != 0:
        sys.stderr.write(p.stderr.decode("utf-8", "ignore")[-2000:])
        raise subprocess.CalledProcessError(p.returncode, cmd)


def ffprobe_fps(video):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=r_frame_rate",
         "-of", "default=noprint_wrappers=1:nokey=1", video],
        check=True, capture_output=True, text=True,
    ).stdout.strip()
    num, den = out.split("/")
    return float(num) / float(den)


def largest_component_touching_bottom(mask_u8):
    """Se queda solo con la región conectada que toca el borde inferior del cuadro — Nacho siempre
    sigue hasta el borde de abajo (está sentado, el cuadro lo corta a la altura del torso/manos), un
    objeto de fondo que el segmentador confunde (ej. el logo de Apple en la pared) nunca lo toca."""
    num, labels, stats, _ = cv2.connectedComponentsWithStats(mask_u8, connectivity=8)
    if num <= 1:
        return mask_u8
    h = mask_u8.shape[0]
    bottom_row = labels[h - 1, :]
    touching = set(bottom_row.tolist()) - {0}
    if not touching:
        # fallback: el componente más grande
        areas = stats[1:, cv2.CC_STAT_AREA]
        touching = {int(np.argmax(areas)) + 1}
    out = np.isin(labels, list(touching)).astype(np.uint8) * 255
    return out


def clean_mask(raw_mask01, prev_alpha):
    """raw_mask01: array (H,W) uint8 con 0/1 (1 = persona, categoría 0 del modelo). Devuelve un alpha
    0..255 suavizado espacial y temporalmente."""
    mask = (raw_mask01 * 255).astype(np.uint8)
    mask = largest_component_touching_bottom(mask)
    kernel = np.ones((7, 7), np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
    alpha = cv2.GaussianBlur(mask, (9, 9), 0).astype(np.float32)
    if prev_alpha is not None:
        alpha = 0.6 * alpha + 0.4 * prev_alpha
    return alpha


def make_whitebg(w, h):
    """Fondo crema suave, no blanco clínico — pedido explícito: 'que no sea un error de recorte'."""
    bg = np.zeros((h, w, 3), dtype=np.float32)
    cy, cx = h * 0.38, w * 0.5
    yy, xx = np.mgrid[0:h, 0:w]
    dist = np.sqrt(((xx - cx) / w) ** 2 + ((yy - cy) / h) ** 2)
    dist = dist / dist.max()
    inner = np.array([246, 243, 236])  # crema cálido
    outer = np.array([228, 221, 204])
    for c in range(3):
        bg[:, :, c] = inner[c] + (outer[c] - inner[c]) * dist
    return bg.astype(np.uint8)


_BILLS = None


def _init_bills(w, h, n=26, seed=7):
    global _BILLS
    rnd = random.Random(seed)
    _BILLS = []
    for _ in range(n):
        _BILLS.append({
            "x": rnd.uniform(0, w),
            "y": rnd.uniform(-h, h),
            "speed": rnd.uniform(220, 420),
            "drift": rnd.uniform(-40, 40),
            "rot": rnd.uniform(0, 360),
            "rot_speed": rnd.uniform(-60, 60),
            "scale": rnd.uniform(0.55, 1.15),
            "sway_phase": rnd.uniform(0, math.tau),
        })


def make_moneyrain(w, h, t_sec):
    """Fondo oscuro verdoso con billetes cayendo, generado 100% en código (sin stock) — posición
    determinística a partir de t_sec, para que el mismo frame dé siempre el mismo resultado."""
    if _BILLS is None:
        _init_bills(w, h)
    bg = np.zeros((h, w, 3), dtype=np.uint8)
    bg[:, :] = (14, 20, 16)
    yy, xx = np.mgrid[0:h, 0:w]
    vign = 1 - 0.5 * (((xx - w / 2) / (w / 2)) ** 2 + ((yy - h / 2) / (h / 2)) ** 2)
    vign = np.clip(vign, 0.35, 1.0)
    for c in range(3):
        bg[:, :, c] = (bg[:, :, c] * vign).astype(np.uint8)

    img = Image.fromarray(bg)
    draw = ImageDraw.Draw(img, "RGBA")
    bill_w, bill_h = int(0.16 * w), int(0.075 * w)
    for b in _BILLS:
        y = (b["y"] + b["speed"] * t_sec) % (h + bill_h * 2) - bill_h
        x = b["x"] + b["drift"] * math.sin(t_sec * 0.6 + b["sway_phase"])
        rot = b["rot"] + b["rot_speed"] * t_sec
        depth = b["scale"]
        bw, bh = int(bill_w * depth), int(bill_h * depth)
        bill = Image.new("RGBA", (bw, bh), (0, 0, 0, 0))
        bd = ImageDraw.Draw(bill)
        alpha = int(150 + 90 * depth)
        bd.rounded_rectangle([0, 0, bw - 1, bh - 1], radius=int(bh * 0.14), fill=(54, 120, 70, alpha), outline=(214, 196, 120, alpha), width=max(1, int(bh * 0.04)))
        bd.ellipse([bw * 0.36, bh * 0.22, bw * 0.64, bh * 0.78], outline=(214, 196, 120, alpha), width=max(1, int(bh * 0.05)))
        bill = bill.rotate(rot, expand=True, resample=Image.BICUBIC)
        img.alpha_composite(bill.convert("RGBA"), (int(x - bill.width / 2), int(y - bill.height / 2))) if img.mode == "RGBA" else img.paste(bill, (int(x - bill.width / 2), int(y - bill.height / 2)), bill)
    return np.array(img.convert("RGB"))


def wrap_text(draw, text, font, max_width):
    words = text.split()
    lines, cur = [], ""
    for w in words:
        test = (cur + " " + w).strip()
        if draw.textlength(test, font=font) <= max_width or not cur:
            cur = test
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def draw_caption(pil_img, phrases, t_sec, color, w, position="upper", stroke=None, scale=0.062,
                  font_path=FONT_PATH, weight=620, person_top=None):
    """phrases: lista de {start, end, words:[{text,start}]} (todo relativo al arranque de la escena,
    en segundos) — UNA oración a la vez, igual regla que el resto del video (ver
    docs/VIDEO-EDITOR-WHITEPAPER.md sección 3: "una oración a la vez, no un párrafo cargándose de a
    poco"). Sin esto, una escena de varios segundos con dos oraciones seguidas podía acumular tantas
    líneas que la última (justo la palabra más importante, "imposible") se salía del cuadro por abajo
    — visto en vivo el 25-11-2026 en la escena de fondo blanco.
    position="upper": centrado arriba, pensado para quedar DETRÁS de la cabeza (escena fondo blanco).
    position="bottom": pegado abajo, como el resto de los subtítulos del video (escena lluvia de
    billetes) — con stroke (contorno) si se pasa, para que lea sobre un fondo oscuro con movimiento.
    scale: proporción del ancho del cuadro que ocupa el tamaño de letra — más grande para el modo
    "depth" (1-2 palabras sueltas, ver depth-captions.ts) que para whitebg/moneyrain (oraciones
    completas, necesitan entrar en varias líneas).
    font_path/weight: variable font + eje de peso — Archivo tiene wght+wdth (dos valores), Playfair
    Display solo wght (un valor); por eso `weight` se pasa tal cual a set_variation_by_axes según
    cuántos ejes tenga la fuente que se esté usando (ver más abajo).
    person_top: fila (en píxeles, 0 = arriba del cuadro) donde arranca la persona EN ESTE FRAME
    puntual (ver _run_scene) — si se pasa, el texto nunca baja más de `person_top` menos un margen,
    aunque la posición "ideal" (0.33 del alto) caiga más abajo. Pedido explícito tras ver en vivo un
    "NO" cortado a la mitad por el pelo: la altura fija no sabía que en ESE frame Nacho estaba más
    inclinado hacia cámara, con el pelo más arriba de lo habitual."""
    phrase = next((p for p in phrases if p["start"] <= t_sec < p["end"]), None)
    if phrase is None:
        return pil_img
    visible = [wd["text"] for wd in phrase["words"] if wd["start"] <= t_sec]
    if not visible:
        return pil_img
    draw = ImageDraw.Draw(pil_img)
    size = int(w * scale)
    font = ImageFont.truetype(font_path, size)
    try:
        # Archivo (whitebg/moneyrain, oraciones completas) trae wght+wdth: [peso, ancho]. Playfair
        # Display (depth, ver FONT_PATH_PREMIUM) trae solo wght: un valor. Probar con 2 primero y
        # caer a 1 es más simple que inspeccionar el archivo cada vez.
        font.set_variation_by_axes([weight, 100])
    except Exception:
        try:
            font.set_variation_by_axes([weight])
        except Exception:
            pass
    text = " ".join(visible)
    max_width = w * 0.82
    lines = wrap_text(draw, text, font, max_width)
    line_h = int(size * 1.22)
    total_h = line_h * len(lines)
    if position == "bottom":
        y = int(pil_img.height * 0.82) - total_h // 2
    else:
        # 0.33, no 0.40: con una oración larga (3-4 líneas) la última línea -justo la palabra más
        # importante- quedaba casi todo detrás de la cabeza, no solo un poco (visto en vivo
        # 25-11-2026 con "imposible": casi no se le veía ni una letra). Un poco de solape con la
        # cabeza sigue dando el efecto "atrás mío" buscado, pero sin tapar la palabra entera.
        y = int(pil_img.height * 0.33) - total_h // 2
        if person_top is not None:
            margin = int(pil_img.height * 0.02)
            y = min(y, person_top - margin - total_h)
            y = max(y, int(pil_img.height * 0.06))  # nunca tan arriba que se salga del cuadro
    for line in lines:
        lw = draw.textlength(line, font=font)
        x = (w - lw) / 2
        if stroke:
            draw.text((x, y), line, font=font, fill=color, stroke_width=stroke[1], stroke_fill=stroke[0])
        else:
            draw.text((x, y), line, font=font, fill=color)
        y += line_h
    return pil_img


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True)
    ap.add_argument("--start", type=float, required=True)
    ap.add_argument("--end", type=float, required=True)
    ap.add_argument("--mode", choices=["whitebg", "moneyrain", "depth"], required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--model", required=True)
    ap.add_argument("--captions", default=None, help="JSON: [{text,start}] start relativo a --start")
    args = ap.parse_args()

    fps = ffprobe_fps(args.video)
    tmpdir = tempfile.mkdtemp(prefix="cutout-")
    try:
        _run_scene(args, fps, tmpdir)
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


def _run_scene(args, fps, tmpdir):
    frames_in = os.path.join(tmpdir, "in")
    frames_out = os.path.join(tmpdir, "out")
    os.makedirs(frames_in, exist_ok=True)
    os.makedirs(frames_out, exist_ok=True)

    duration = args.end - args.start
    run(["ffmpeg", "-y", "-ss", f"{args.start:.3f}", "-i", args.video, "-t", f"{duration:.3f}",
         "-fps_mode", "passthrough", os.path.join(frames_in, "f_%05d.png")])
    audio_path = os.path.join(tmpdir, "audio.aac")
    run(["ffmpeg", "-y", "-ss", f"{args.start:.3f}", "-i", args.video, "-t", f"{duration:.3f}",
         "-vn", "-c:a", "aac", "-b:a", "192k", audio_path])

    base_options = mp_python.BaseOptions(model_asset_path=args.model)
    options = vision.ImageSegmenterOptions(base_options=base_options, output_category_mask=True)
    segmenter = vision.ImageSegmenter.create_from_options(options)

    frame_files = sorted(os.listdir(frames_in))
    w = h = None
    prev_alpha = None
    captions = json.loads(args.captions) if args.captions else None

    for i, fname in enumerate(frame_files):
        t_sec = i / fps
        src_path = os.path.join(frames_in, fname)
        img_bgr = cv2.imread(src_path)
        if w is None:
            h, w = img_bgr.shape[:2]
        img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)

        mp_img = mp.Image.create_from_file(src_path)
        result = segmenter.segment(mp_img)
        raw_mask = result.category_mask.numpy_view().squeeze(-1)  # 0 = persona (ver test empírico)
        person01 = (raw_mask == 0).astype(np.uint8)
        alpha = clean_mask(person01, prev_alpha)
        prev_alpha = alpha
        alpha3 = (alpha / 255.0)[:, :, None]

        if args.mode == "whitebg":
            bg = make_whitebg(w, h)
            bg_pil = Image.fromarray(bg)
            if captions:
                bg_pil = draw_caption(bg_pil, captions, t_sec, (46, 40, 30), w, position="upper")
            bg = np.array(bg_pil)
            comp = (img_rgb.astype(np.float32) * alpha3 + bg.astype(np.float32) * (1 - alpha3)).astype(np.uint8)
        elif args.mode == "depth":
            # Pedido explícito de Nacho (26-11-2026): el efecto "subtítulo detrás tuyo" SIN tocar ni
            # reemplazar el fondo real — a diferencia de whitebg/moneyrain (que pintan un fondo nuevo
            # entero), acá el "fondo" sobre el que se dibuja el texto es el frame real tal cual salió
            # de cámara. El texto queda atrás solo porque la persona (recortada con alpha) se
            # superpone encima en la misma composición — el fondo del video no cambia en nada.
            bg_pil = Image.fromarray(img_rgb)
            if captions:
                # Dónde arranca la persona EN ESTE FRAME puntual (fila más alta con alpha fuerte) —
                # ver person_top en draw_caption: sin esto el texto a una altura fija podía quedar
                # cortado a la mitad por el pelo en una toma donde Nacho está más inclinado/cerca de
                # cámara que de costumbre (visto en vivo el 26-11-2026, un "NO" partido al medio).
                rows_with_person = np.where(alpha.max(axis=1) > 160)[0]
                person_top = int(rows_with_person[0]) if len(rows_with_person) else None
                # scale más grande que el default (0.062): acá entran 1 o 2 palabras sueltas (la idea
                # principal de la oración, ver depth-captions.ts), no una oración completa — pedido
                # explícito de Nacho: "bien grandes", no texto chico amontonado. Tipografía premium
                # (Playfair Display, ver FONT_PATH_PREMIUM) en vez de Archivo — pedido explícito.
                bg_pil = draw_caption(
                    bg_pil, captions, t_sec, (255, 255, 255), w, position="upper",
                    stroke=((0, 0, 0), max(2, int(w * 0.008))), scale=0.11,
                    font_path=FONT_PATH_PREMIUM, weight=750, person_top=person_top,
                )
            bg = np.array(bg_pil)
            comp = (img_rgb.astype(np.float32) * alpha3 + bg.astype(np.float32) * (1 - alpha3)).astype(np.uint8)
        else:
            bg = make_moneyrain(w, h, t_sec)
            comp = (img_rgb.astype(np.float32) * alpha3 + bg.astype(np.float32) * (1 - alpha3)).astype(np.uint8)
            if captions:
                # Blanco + contorno negro grueso, igual estilo que el resto del video — en texto
                # ENCIMA de todo (persona incluida), como los subtítulos normales, no detrás.
                comp_pil = Image.fromarray(comp)
                comp_pil = draw_caption(comp_pil, captions, t_sec, (255, 255, 255), w, position="bottom", stroke=((0, 0, 0), max(2, int(w * 0.006))))
                comp = np.array(comp_pil)
        Image.fromarray(comp).save(os.path.join(frames_out, fname))

    # -color_primaries/-color_trc/-colorspace bt709: SIN esto el clip sale sin ninguna etiqueta de
    # color ("unknown"), y como el video original de un iPhone SÍ viene etiquetado bt709, Remotion
    # (OffthreadVideo/ffmpeg) interpreta mal este clip sin etiqueta al insertarlo en el render final —
    # se ve con un tinte verdoso/enfermizo ("pantalla verde", pedido explícito de Nacho el 26-11-2026
    # tras ver el primer render real). bt709 es el estándar de los iPhone, así que etiquetar con eso
    # es correcto para cualquier clip que suba Nacho, no una suposición al voleo.
    run(["ffmpeg", "-y", "-framerate", f"{fps}", "-i", os.path.join(frames_out, "f_%05d.png"),
         "-i", audio_path, "-c:v", "libx264", "-crf", "16", "-preset", "slow", "-c:a", "copy",
         "-pix_fmt", "yuv420p", "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709",
         args.out])
    print(f"OK -> {args.out}")


if __name__ == "__main__":
    main()
