"""Generate assets/img/style-grid.svg — the "style motion generation" figure.

One neutral walk on the left is transferred into a 3x3 grid of results:
rows = character axis (z_char), columns = emotion axis (z_emo).
Poses come from the same walk-cycle math the hero canvas uses, so the
silhouettes are real projected skeletons rather than hand-drawn guesses.

Run:  python tools/gen_style_figure.py
"""

import math
import os

# ---------------------------------------------------------------- pose model

BONES = [
    ("pelvis", "spine"), ("spine", "chest"), ("chest", "neck"), ("neck", "head"),
    ("chest", "shoulderR"), ("shoulderR", "elbowR"), ("elbowR", "wristR"),
    ("chest", "shoulderL"), ("shoulderL", "elbowL"), ("elbowL", "wristL"),
    ("pelvis", "hipR"), ("hipR", "kneeR"), ("kneeR", "ankleR"), ("ankleR", "toeR"),
    ("pelvis", "hipL"), ("hipL", "kneeL"), ("kneeL", "ankleL"), ("ankleL", "toeL"),
]

L = dict(thigh=0.44, shank=0.44, foot=0.15, upper_arm=0.30, fore_arm=0.28)

BASE = dict(
    stride=0.62,      # thigh swing amplitude
    knee=0.85,        # knee bend gain
    crouch=0.0,       # pelvis drop
    lean=0.0,         # torso forward tilt (rad)
    bounce=0.03,      # vertical oscillation
    arm_swing=0.50,   # shoulder swing amplitude
    arm_raise=0.0,    # shoulder forward raise (rad)
    elbow=0.22,       # base elbow bend (forward flexion)
    stance=0.10,      # hip lateral offset
    head=0.0,         # head forward(+) / back(-)
    shrug=0.0,        # shoulder lift
)


def merge(*deltas):
    p = dict(BASE)
    for d in deltas:
        for k, v in d.items():
            p[k] = p[k] + v
    return p


def rot_sagittal(pt, pivot, ang):
    """Rotate a point about the pivot in the y-z (sagittal) plane."""
    dy, dz = pt[1] - pivot[1], pt[2] - pivot[2]
    c, s = math.cos(ang), math.sin(ang)
    return [pt[0], pivot[1] + dy * c - dz * s, pivot[2] + dy * s + dz * c]


def rot_y(pt, pivot, ang):
    """Rotate a point about the vertical axis through the pivot.
    Positive angle carries the +x side forward (+z)."""
    dx, dz = pt[0] - pivot[0], pt[2] - pivot[2]
    c, s = math.cos(ang), math.sin(ang)
    return [pivot[0] + dx * c - dz * s, pt[1], pivot[2] + dx * s + dz * c]


def pose(t, p):
    J = {}
    bob = p["bounce"] * math.sin(t * 2)
    sway = 0.02 * math.sin(t)
    py = 0.98 + bob - p["crouch"]

    J["pelvis"] = [sway, py, 0.0]
    J["spine"] = [sway * 0.6, py + 0.22, 0.01]
    J["chest"] = [sway * 0.3, py + 0.40, 0.02]
    J["neck"] = [0.0, py + 0.52 + p["shrug"], 0.01]
    J["head"] = [0.0, py + 0.66 + p["shrug"], 0.02 + p["head"]]

    def leg(side, ph):
        hip = [p["stance"] * side + sway, py - 0.06, 0.0]
        thigh_a = p["stride"] * math.sin(ph)
        knee_a = p["knee"] * max(0.0, math.sin(ph - 1.35)) + 0.08 + p["crouch"] * 1.6
        knee = [hip[0],
                hip[1] - L["thigh"] * math.cos(thigh_a),
                hip[2] + L["thigh"] * math.sin(thigh_a)]
        shank_a = thigh_a - knee_a
        ankle = [knee[0],
                 knee[1] - L["shank"] * math.cos(shank_a),
                 knee[2] + L["shank"] * math.sin(shank_a)]
        toe = [ankle[0], ankle[1] - 0.03, ankle[2] + L["foot"]]
        return hip, knee, ankle, toe

    for side, ph, tag in ((1, t, "R"), (-1, t + math.pi, "L")):
        hip, knee, ankle, toe = leg(side, ph)
        J["hip" + tag], J["knee" + tag] = hip, knee
        J["ankle" + tag], J["toe" + tag] = ankle, toe

    def arm(side, ph):
        sh = [0.21 * side + sway * 0.3, py + 0.38 + p["shrug"], 0.01]
        a = p["arm_swing"] * math.sin(ph) + p["arm_raise"]
        el = [sh[0] + 0.02 * side,
              sh[1] - L["upper_arm"] * math.cos(a),
              sh[2] + L["upper_arm"] * math.sin(a)]
        # the elbow flexes forward (unlike the knee, which flexes backward),
        # so the forearm angle is a + bend, never a - bend
        bend = p["elbow"] + 0.18 * max(0.0, math.sin(ph))
        wr = [el[0] + 0.01 * side,
              el[1] - L["fore_arm"] * math.cos(a + bend),
              el[2] + L["fore_arm"] * math.sin(a + bend)]
        return sh, el, wr

    for side, ph, tag in ((1, t + math.pi, "R"), (-1, t, "L")):
        sh, el, wr = arm(side, ph)
        J["shoulder" + tag], J["elbow" + tag], J["wrist" + tag] = sh, el, wr

    # contralateral torso twist: when the right leg swings forward the right
    # shoulder goes back, so upper and lower body read as one connected walk
    tw = 0.13 * math.sin(t)
    for k in ("hipR", "kneeR", "ankleR", "toeR", "hipL", "kneeL", "ankleL", "toeL"):
        J[k] = rot_y(J[k], J["pelvis"], tw)
    for k in ("shoulderR", "elbowR", "wristR", "shoulderL", "elbowL", "wristL"):
        J[k] = rot_y(J[k], J["chest"], -tw)

    if abs(p["lean"]) > 1e-6:
        pivot = J["pelvis"]
        upper = ["spine", "chest", "neck", "head",
                 "shoulderR", "elbowR", "wristR", "shoulderL", "elbowL", "wristL"]
        for k in upper:
            J[k] = rot_sagittal(J[k], pivot, p["lean"])
    return J


# ---------------------------------------------------------------- projection

# Negative yaw past -pi/2 puts the camera in front of the figure: the chest
# faces the viewer and the walk direction reads to the right. Viewing the back
# (0 < yaw < pi/2) makes the leg order ambiguous.
YAW, PITCH, DIST, FOV = -2.25, 0.10, 4.2, 250


def project(pt, ox, oy, scale):
    cy, sy = math.cos(YAW), math.sin(YAW)
    cp, sp = math.cos(PITCH), math.sin(PITCH)
    x = pt[0] * cy - pt[2] * sy
    z = pt[0] * sy + pt[2] * cy
    y = pt[1] * cp - z * sp
    z = pt[1] * sp + z * cp + DIST
    s = FOV / z * scale
    return ox + x * s, oy - y * s


def skeleton_svg(J, ox, oy, scale, color, width=2.0, joints=True):
    out = []
    P = {k: project(v, ox, oy, scale) for k, v in J.items()}
    d = []
    for a, b in BONES:
        d.append("M%.1f %.1fL%.1f %.1f" % (P[a][0], P[a][1], P[b][0], P[b][1]))
    out.append(
        '<path d="%s" fill="none" stroke="%s" stroke-width="%.1f" '
        'stroke-linecap="round"/>' % ("".join(d), color, width)
    )
    if joints:
        for k in ("kneeR", "kneeL", "elbowR", "elbowL", "pelvis", "chest"):
            out.append('<circle cx="%.1f" cy="%.1f" r="%.1f" fill="%s"/>'
                       % (P[k][0], P[k][1], width * 0.72, color))
    hx, hy = P["head"]
    out.append('<circle cx="%.1f" cy="%.1f" r="%.1f" fill="#0B0E14" stroke="%s" '
               'stroke-width="%.1f"/>' % (hx, hy, width * 2.5, color, width))
    return "".join(out)


# ---------------------------------------------------------------- style axes

CHARS = [
    # stiff legs, forearms held out horizontally, almost no bounce
    ("ROBOT", "ロボット", "#6C8CFF",
     dict(stride=-0.44, knee=-0.72, arm_swing=-0.42, arm_raise=0.28, elbow=0.95,
          stance=0.02, bounce=-0.03, shrug=0.05)),
    # deep crouch, forward lean, low guard
    ("NINJA", "忍者", "#2EE6C5",
     dict(crouch=0.20, lean=0.34, stance=0.07, arm_swing=-0.22, elbow=0.50,
          stride=-0.10)),
    # straight dragging legs, arms reaching forward, slumped head
    ("ZOMBIE", "ゾンビ", "#B08CFF",
     dict(stride=-0.30, knee=-0.66, arm_raise=1.24, elbow=-0.12, lean=0.14,
          head=0.12, arm_swing=-0.46, shrug=-0.02)),
]

EMOS = [
    ("NEUTRAL", "中立", {}),
    # bouncy, wide arm swing, head up
    ("HAPPY", "喜び", dict(bounce=0.05, arm_swing=0.46, arm_raise=0.06,
                          elbow=0.16, stride=0.22, head=-0.10, shrug=0.03)),
    # forward lean, fists drawn up, longer stride
    ("ANGRY", "怒り", dict(lean=0.26, elbow=0.50, arm_raise=0.26, arm_swing=0.10,
                          stride=0.18, stance=0.03, shrug=0.05, head=0.06)),
]

# a characteristic instant of the cycle per column, so silhouettes read clearly
T_BY_EMO = [2.05, 1.42, 2.50]

TX = "#E9ECF3"
TX2 = "#A7B0C2"
TX3 = "#8A93A6"
LINE = "#232B3A"

W, H = 950, 484
CELL_W, CELL_H = 176, 120
GRID_X, GRID_Y = 360, 104


def main():
    s = []
    s.append('<svg viewBox="0 0 %d %d" xmlns="http://www.w3.org/2000/svg" '
             'role="img" aria-label="単調な歩行モーションを、キャラクター性の軸と感情の軸の'
             '組み合わせで9通りのスタイルに変換した図">' % (W, H))
    s.append('<title>スタイルモーション生成の概要</title>')

    # ---- input panel
    s.append('<rect x="10" y="104" width="214" height="356" rx="14" '
             'fill="rgba(255,255,255,.025)" stroke="%s" stroke-width="1.4"/>' % LINE)
    s.append('<text x="117" y="136" text-anchor="middle" font-family="monospace" '
             'font-size="13" letter-spacing="1.6" fill="%s">INPUT</text>' % TX3)
    s.append('<text x="117" y="162" text-anchor="middle" font-family="sans-serif" '
             'font-size="17" font-weight="700" fill="%s">単調な歩行</text>' % TX)
    neutral = merge()
    s.append(skeleton_svg(pose(2.05, neutral), 117, 388, 1.34, "#98A2B6", 2.8))
    s.append('<text x="117" y="436" text-anchor="middle" font-family="sans-serif" '
             'font-size="13.5" fill="%s">スタイル指定なし</text>' % TX2)

    # ---- arrow
    s.append('<defs><marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" '
             'markerWidth="6" markerHeight="6" orient="auto-start-reverse">'
             '<path d="M0 0 L10 5 L0 10 Z" fill="#2EE6C5"/></marker></defs>')
    s.append('<line x1="234" y1="284" x2="296" y2="284" stroke="#2EE6C5" '
             'stroke-width="2.2" marker-end="url(#ar)"/>')
    s.append('<text x="262" y="270" text-anchor="middle" font-family="sans-serif" '
             'font-size="12.5" font-weight="700" fill="#2EE6C5">生成</text>')

    # ---- grid frame
    gw, gh = CELL_W * 3, CELL_H * 3
    s.append('<rect x="%d" y="%d" width="%d" height="%d" rx="14" '
             'fill="rgba(46,230,197,.03)" stroke="%s" stroke-width="1.4"/>'
             % (GRID_X - 8, GRID_Y - 6, gw + 16, gh + 12, LINE))

    # column headers (emotion axis)
    s.append('<text x="%d" y="36" font-family="sans-serif" font-size="13.5" '
             'font-weight="700" fill="#6C8CFF">z_emo → 感情の軸</text>'
             % (GRID_X - 8))
    for i, (en, jp, _) in enumerate(EMOS):
        cx = GRID_X + CELL_W * i + CELL_W / 2
        s.append('<text x="%.0f" y="72" text-anchor="middle" font-family="sans-serif" '
                 'font-size="16" font-weight="700" fill="%s">%s</text>' % (cx, TX, jp))
        s.append('<text x="%.0f" y="90" text-anchor="middle" font-family="monospace" '
                 'font-size="11" letter-spacing="1.2" fill="%s">%s</text>'
                 % (cx, TX3, en))

    # row headers (character axis)
    s.append('<text x="%d" y="60" text-anchor="end" font-family="sans-serif" '
             'font-size="13.5" font-weight="700" fill="#2EE6C5">'
             'z_char ↓ キャラクターの軸</text>' % (GRID_X - 20))
    for r, (cn, cjp, color, cd) in enumerate(CHARS):
        cy = GRID_Y + CELL_H * r + CELL_H / 2
        s.append('<text x="%d" y="%.0f" text-anchor="end" font-family="sans-serif" '
                 'font-size="16" font-weight="700" fill="%s">%s</text>'
                 % (GRID_X - 20, cy - 2, color, cjp))
        s.append('<text x="%d" y="%.0f" text-anchor="end" font-family="monospace" '
                 'font-size="11" letter-spacing="1.2" fill="%s">%s</text>'
                 % (GRID_X - 20, cy + 16, TX3, cn))

        for c, (en, ejp, ed) in enumerate(EMOS):
            ox = GRID_X + CELL_W * c + CELL_W / 2
            oy = GRID_Y + CELL_H * r + CELL_H - 12
            if c or r:
                s.append('<line x1="%d" y1="%d" x2="%d" y2="%d" stroke="%s" '
                         'stroke-width="1"/>'
                         % (GRID_X, GRID_Y + CELL_H * r, GRID_X + gw,
                            GRID_Y + CELL_H * r, LINE))
            s.append(skeleton_svg(pose(T_BY_EMO[c], merge(cd, ed)),
                                  ox, oy, 0.84, color, 2.5))

    for c in (1, 2):
        s.append('<line x1="%d" y1="%d" x2="%d" y2="%d" stroke="%s" stroke-width="1"/>'
                 % (GRID_X + CELL_W * c, GRID_Y, GRID_X + CELL_W * c,
                    GRID_Y + gh, LINE))

    s.append('</svg>')

    out = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                       "assets", "img", "style-grid.svg")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        f.write("\n".join(s))
    print("wrote", out)


if __name__ == "__main__":
    main()
