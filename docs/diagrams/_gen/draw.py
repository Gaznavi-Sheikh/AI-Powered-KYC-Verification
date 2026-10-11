"""
Hand-rolled architecture/sequence diagram renderer using PIL only
(no Graphviz/mermaid-cli available in this environment).
Renders 5 diagrams referenced by the manual's Markdown source.
"""
import os
from PIL import Image, ImageDraw, ImageFont

FONT_DIR = "/usr/share/fonts/truetype/dejavu"
F_REG = os.path.join(FONT_DIR, "DejaVuSans.ttf")
F_BOLD = os.path.join(FONT_DIR, "DejaVuSans-Bold.ttf")
OUT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # docs/diagrams

SCALE = 2  # render at 2x then this stays crisp when scaled down in the PDF

def font(size, bold=False):
    return ImageFont.truetype(F_BOLD if bold else F_REG, size * SCALE)

INDIGO = (98, 91, 238)
INDIGO_SOFT = (234, 233, 255)
NAVY = (32, 36, 58)
MUTED = (115, 121, 144)
WHITE = (255, 255, 255)
BORDER = (216, 215, 239)
GREEN = (5, 150, 105)
GREEN_SOFT = (229, 247, 240)
AMBER = (180, 83, 9)
AMBER_SOFT = (253, 241, 223)
BG = (247, 247, 255)


def new_canvas(w, h):
    img = Image.new("RGB", (w * SCALE, h * SCALE), BG)
    return img, ImageDraw.Draw(img)


def rounded_box(d, xy, text=None, sub=None, fill=WHITE, outline=BORDER, text_color=NAVY,
                 sub_color=MUTED, radius=14, title_size=15, sub_size=11, bold=True):
    x0, y0, x1, y1 = [v * SCALE for v in xy]
    d.rounded_rectangle([x0, y0, x1, y1], radius=radius * SCALE, fill=fill, outline=outline, width=2 * SCALE)
    cy = (y0 + y1) / 2
    if text and sub:
        d.text(((x0 + x1) / 2, cy - 9 * SCALE), text, font=font(title_size, bold), fill=text_color, anchor="mm")
        d.text(((x0 + x1) / 2, cy + 11 * SCALE), sub, font=font(sub_size), fill=sub_color, anchor="mm")
    elif text:
        d.text(((x0 + x1) / 2, cy), text, font=font(title_size, bold), fill=text_color, anchor="mm")


def arrow(d, p0, p1, label=None, color=MUTED, label_color=NAVY, dashed=False, label_size=10.5):
    x0, y0 = p0[0] * SCALE, p0[1] * SCALE
    x1, y1 = p1[0] * SCALE, p1[1] * SCALE
    if dashed:
        import math
        length = math.hypot(x1 - x0, y1 - y0)
        n = max(2, int(length // (10 * SCALE)))
        for i in range(n):
            if i % 2 == 0:
                t0, t1 = i / n, min(1, (i + 0.6) / n)
                d.line([x0 + (x1 - x0) * t0, y0 + (y1 - y0) * t0,
                        x0 + (x1 - x0) * t1, y0 + (y1 - y0) * t1], fill=color, width=2 * SCALE)
    else:
        d.line([x0, y0, x1, y1], fill=color, width=2 * SCALE)
    # arrow head
    import math
    ang = math.atan2(y1 - y0, x1 - x0)
    hl = 9 * SCALE
    for a in (ang + 2.6, ang - 2.6):
        d.line([x1, y1, x1 - hl * math.cos(a), y1 - hl * math.sin(a)], fill=color, width=2 * SCALE)
    if label:
        mx, my = (x0 + x1) / 2, (y0 + y1) / 2
        bbox = d.textbbox((0, 0), label, font=font(label_size))
        tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
        pad = 4 * SCALE
        d.rectangle([mx - tw / 2 - pad, my - th / 2 - pad, mx + tw / 2 + pad, my + th / 2 + pad], fill=BG)
        d.text((mx, my), label, font=font(label_size), fill=label_color, anchor="mm")


def multi_arrow(d, points, label=None, color=MUTED, label_color=NAVY, label_size=10.5, label_pos=None):
    for i in range(len(points) - 1):
        p0, p1 = points[i], points[i + 1]
        if i == len(points) - 2:
            arrow(d, p0, p1, color=color)
        else:
            x0, y0 = p0[0] * SCALE, p0[1] * SCALE
            x1, y1 = p1[0] * SCALE, p1[1] * SCALE
            d.line([x0, y0, x1, y1], fill=color, width=2 * SCALE)
    if label:
        mx, my = label_pos if label_pos else points[len(points) // 2]
        mx, my = mx * SCALE, my * SCALE
        bbox = d.textbbox((0, 0), label, font=font(label_size))
        tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
        pad = 4 * SCALE
        d.rectangle([mx - tw / 2 - pad, my - th / 2 - pad, mx + tw / 2 + pad, my + th / 2 + pad], fill=BG)
        d.text((mx, my), label, font=font(label_size), fill=label_color, anchor="mm")


def save(img, name):
    path = os.path.join(OUT_DIR, name)
    img = img.resize((img.width // SCALE, img.height // SCALE), Image.LANCZOS)
    img.save(path)
    print("wrote", path)


# ---------------------------------------------------------------- Figure 1
def logical_architecture():
    W, H = 920, 460
    img, d = new_canvas(W, H)
    browser = (30, 60, 200, 110)
    api = (360, 40, 560, 110)
    ml = (360, 160, 560, 230)
    db = (650, 40, 870, 110)
    groq = (650, 160, 870, 230)
    smtp = (650, 280, 870, 350)

    rounded_box(d, browser, "Browser", "React + Vite SPA")
    rounded_box(d, api, "Node.js / Express API", ":5000", fill=INDIGO_SOFT)
    rounded_box(d, ml, "Flask ML service", ":5001", fill=INDIGO_SOFT)
    rounded_box(d, db, "MongoDB Atlas", "(cloud)")
    rounded_box(d, groq, "Groq API", "(external LLM)")
    rounded_box(d, smtp, "SMTP (Gmail)", "OTP / reset email")

    arrow(d, (200, 75), (360, 75), "JWT Bearer + REST/JSON")
    arrow(d, (430, 110), (430, 160), "multipart file + prior-user hashes", label_size=9)
    arrow(d, (490, 160), (490, 110), "classification, OCR, risk, decision", color=(160, 160, 190), label_size=9)
    arrow(d, (560, 75), (650, 75), "Mongoose")
    arrow(d, (560, 195), (650, 195), "extraction prompt")
    arrow(d, (560, 95), (650, 300), "OTP / reset emails", label_size=9)
    save(img, "logical-architecture.png")


# ---------------------------------------------------------------- Figure 2
def auth_sequence():
    W, H = 960, 560
    img, d = new_canvas(W, H)
    cols = {"Browser": 90, "Backend": 330, "DB": 560, "SMTP": 790}
    for name, x in cols.items():
        rounded_box(d, (x - 70, 20, x + 70, 60), name, fill=INDIGO_SOFT, title_size=13)
        d.line([(x) * SCALE, 60 * SCALE, x * SCALE, 520 * SCALE], fill=BORDER, width=2 * SCALE)

    steps = [
        (90, 330, "1. POST /auth/login\n{email,password}", 100),
        (330, 560, "2. matchPassword() ok,\ntwoFactorEnabled=true", 150),
        (330, 560, "3. upsert LoginOtp (hashed)", 190),
        (330, 790, "4. send OTP email", 230),
        (330, 90, "5. {twoFactorRequired:true,\npending2faToken}", 270),
        (90, 330, "6. POST /auth/verify-login-otp\n{pending2faToken, otp}", 330),
        (330, 560, "7. compare hash, delete LoginOtp", 370),
        (330, 90, "8. {token, user} - real session", 410),
    ]
    for (x0, x1, label, y) in steps:
        arrow(d, (x0, y), (x1, y), label, label_size=9.5)
    save(img, "auth-sequence.png")


# ---------------------------------------------------------------- Figure 3
def ml_pipeline_sequence():
    W, H = 980, 560
    img, d = new_canvas(W, H)
    stages = [
        ("1. classifier.py", "classify()", "CNN -> doc type + confidence"),
        ("2. ocr.py", "extract_text()", "EasyOCR -> raw text"),
        ("3. extractor.py", "extract_fields()", "Groq LLM -> structured JSON"),
        ("4. graph.py", "analyze()", "NetworkX -> anomaly score"),
        ("5. decision.py", "decide()", "rules -> approved/suspicious/rejected"),
    ]
    y0 = 40
    box_h = 80
    gap = 25
    for i, (title, fn, desc) in enumerate(stages):
        y = y0 + i * (box_h + gap)
        fill = INDIGO_SOFT if i < 4 else GREEN_SOFT
        rounded_box(d, (60, y, 900, y + box_h), fill=fill)
        d.text((480 * SCALE, (y + 19) * SCALE), title, font=font(14, True), fill=NAVY, anchor="mm")
        d.text((480 * SCALE, (y + 42) * SCALE), fn, font=font(11, True),
               fill=INDIGO if i < 4 else GREEN, anchor="mm")
        d.text((480 * SCALE, (y + 62) * SCALE), desc, font=font(10), fill=MUTED, anchor="mm")
        if i < len(stages) - 1:
            arrow(d, (480, y + box_h), (480, y + box_h + gap))
    save(img, "ml-pipeline-sequence.png")


# ---------------------------------------------------------------- Figure 4
def data_persistence():
    W, H = 940, 420
    img, d = new_canvas(W, H)
    user = (40, 40, 300, 110)
    verif = (400, 40, 680, 110)
    emailv = (720, 40, 900, 100)
    loginotp = (720, 150, 900, 210)
    pwreset = (720, 260, 900, 320)

    rounded_box(d, user, "User", "name, email, role,\ntwoFactorEnabled", sub_size=9)
    rounded_box(d, verif, "Verification", "user ref, docType, status,\nextractedData, graphAnalysis, decision", sub_size=9)
    rounded_box(d, emailv, "EmailVerification", "TTL ~10min", fill=AMBER_SOFT, title_size=12, sub_size=9)
    rounded_box(d, loginotp, "LoginOtp", "TTL ~10min", fill=AMBER_SOFT, title_size=12, sub_size=9)
    rounded_box(d, pwreset, "PasswordReset", "TTL ~15min", fill=AMBER_SOFT, title_size=12, sub_size=9)

    arrow(d, (300, 75), (400, 75), "1-to-many\n(user field)".split("\n")[0])
    multi_arrow(d, [(170, 110), (170, 128), (690, 128), (690, 70), (720, 70)],
                "by email", label_size=9.5, label_pos=(320, 128))
    multi_arrow(d, [(170, 110), (170, 140), (700, 140), (700, 180), (720, 180)],
                "by userId", label_size=9.5, label_pos=(460, 140))
    multi_arrow(d, [(170, 110), (170, 152), (710, 152), (710, 290), (720, 290)],
                "by userId", label_size=9.5, label_pos=(600, 152))

    d.text((470 * SCALE, 370 * SCALE),
           "Durable: User, Verification   |   Short-lived (deleted on use or TTL-expired): EmailVerification, LoginOtp, PasswordReset",
           font=font(10), fill=MUTED, anchor="mm")
    save(img, "data-persistence.png")


# ---------------------------------------------------------------- Figure 5
def runtime_deployment():
    W, H = 940, 360
    img, d = new_canvas(W, H)
    rounded_box(d, (40, 40, 300, 320), None, None, fill=BG, outline=NAVY, radius=18)
    d.text((170 * SCALE, 55 * SCALE), "One developer's machine", font=font(12, True), fill=NAVY, anchor="mm")
    rounded_box(d, (60, 90, 280, 150), "Vite dev server", ":5173 / :8000", fill=INDIGO_SOFT, sub_size=9, title_size=12)
    rounded_box(d, (60, 170, 280, 230), "node server.js", ":5000", fill=INDIGO_SOFT, sub_size=9, title_size=12)
    rounded_box(d, (60, 250, 280, 310), "python app.py", ":5001", fill=INDIGO_SOFT, sub_size=9, title_size=12)

    rounded_box(d, (640, 40, 900, 110), "MongoDB Atlas", "(only real cloud dependency)", sub_size=9, title_size=12)
    rounded_box(d, (640, 150, 900, 220), "Groq API", "(external)", sub_size=9, title_size=12)
    rounded_box(d, (640, 260, 900, 320), "SMTP", "(external)", sub_size=9, title_size=12)

    arrow(d, (280, 200), (640, 75))
    arrow(d, (280, 280), (640, 185))
    arrow(d, (280, 280), (640, 290))

    d.text((470 * SCALE, 340 * SCALE),
           "No Docker, no PM2, no AWS, no CI, no reverse proxy anywhere in this repository (verified).",
           font=font(10, True), fill=AMBER, anchor="mm")
    save(img, "runtime-deployment.png")


if __name__ == "__main__":
    logical_architecture()
    auth_sequence()
    ml_pipeline_sequence()
    data_persistence()
    runtime_deployment()
