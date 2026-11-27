"""Compose the paired official simulator captures into the annotated showcase."""
import json
import subprocess
import sys
import wave
from functools import lru_cache
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

WIDTH, HEIGHT, FPS = 1920, 1080, 24
RATE = 48000
GREEN, AMBER, BLUE = "#9df7ad", "#ffca8f", "#93d9ff"
WHITE, MUTED = "#f1f8f3", "#abc2b5"
FONTS = Path("/usr/share/fonts/truetype/dejavu")
SCENES = [
    ("hyperliquid", 7, "POCKETPULSE G2", "Markets at a glance", "Live market radar", GREEN,
     "When markets move, pulling out a phone can take your eyes off the trade."),
    ("hyperliquid", 7, "TRACK 02  /  CRYPTO & DEFI", "Live funding and top of book", "Swipe: Browse signals", GREEN,
     "Hyperliquid provides funding and the best bid and ask for perpetual futures."),
    ("polymarket", 7, "TRACK 02  /  CRYPTO & DEFI", "Follow the odds", "Swipe: Next signal", GREEN,
     "Swipe to Polymarket for the live order book and twenty-four-hour odds change."),
    ("wide-review", 7, "SAFETY GUARDRAILS", "Review a wide market", "Tap: Review $25 order", AMBER,
     "The first tap opens a twenty-five dollar paper order for review."),
    ("blocked", 8, "SAFETY GUARDRAILS", "Reject excessive slippage", "Tap: Confirm · Blocked", AMBER,
     "On confirmation, the server refreshes the quote. Slippage exceeds fifty basis points. No fill is written."),
    ("liquid", 6, "TRACK 02  /  CRYPTO & DEFI", "Return to a liquid book", "Tap back · Swipe to Hyperliquid", GREEN,
     "Return to radar and choose a liquid Hyperliquid perpetual."),
    ("paper-review", 7, "TRACK 02  /  CRYPTO & DEFI", "Confirm a bounded paper order", "Tap: Review $25 order", GREEN,
     "Review a fresh twenty-five dollar order. Confirm it with a second tap."),
    ("receipt", 10, "TRACK 01  /  MESSAGING & NEWS", "One fill. One Telegram memo.", "Tap: Confirm paper fill", BLUE,
     "SQLite commits the fill and memo data. Receipt one appears on both screens. Telegram is in local preview mode."),
]


@lru_cache
def font(size, style="regular"):
    name = {"regular": "DejaVuSans", "bold": "DejaVuSans-Bold", "mono": "DejaVuSansMono-Bold"}[style]
    return ImageFont.truetype(str(FONTS / (name + ".ttf")), size)


def label(draw, at, text, color=MUTED):
    draw.text(at, text, font=font(19, "mono"), fill=color)


def wrap(draw, text, face, max_width):
    lines = [""]
    for word in text.split():
        candidate = (lines[-1] + " " + word).strip()
        if lines[-1] and draw.textlength(candidate, font=face) > max_width:
            lines.append(word)
        else:
            lines[-1] = candidate
    return "\n".join(lines)


def outline(draw, bounds, fill, edge, radius=22):
    draw.rounded_rectangle(bounds, radius, fill, edge, width=2)


def artwork(work, scene):
    capture, _, chapter, title, gesture, accent, caption = scene
    canvas = Image.new("RGB", (WIDTH, HEIGHT), "#111e18")
    draw = ImageDraw.Draw(canvas)
    for y in range(HEIGHT):
        draw.line((0, y, WIDTH, y), fill=(max(10, 19 - y // 105), max(17, 34 - y // 58), max(14, 27 - y // 72)))
    draw.line((62, 195, 1858, 195), fill="#34493d", width=2)
    label(draw, (65, 41), chapter, accent)
    draw.text((62, 76), title, font=font(64, "bold"), fill=WHITE)
    draw.text((1854, 60), "PocketPulse G2", font=font(28, "bold"), fill=WHITE, anchor="ra")
    draw.text((1854, 99), "Even G2 market radar", font=font(21), fill=MUTED, anchor="ra")

    label(draw, (66, 225), "G2  /  NATIVE 576 × 288")
    label(draw, (1102, 225), "COMPANION  /  SIMULATOR WEBVIEW")
    outline(draw, (62, 265, 1058, 874), "#131e18", "#32473d")
    outline(draw, (1100, 265, 1858, 874), "#131e18", "#32473d")

    # The native screenshot preserves its alpha and uses nearest-neighbor sampling.
    glasses = Image.open(work / (capture + ".glasses.png")).convert("RGBA")
    if glasses.size != (576, 288):
        raise ValueError(f"Unexpected glasses dimensions {glasses.size}")
    glasses = glasses.resize((864, 432), Image.Resampling.NEAREST)
    outline(draw, (104, 290, 1016, 765), "#0b130e", "#405a4a", 34)
    outline(draw, (119, 306, 1001, 750), "#020704", "#344e3b", 20)
    canvas.paste(glasses, (128, 312), glasses)
    for x, dx in [(135, 22), (985, -22)]:
        for y, dy in [(320, 22), (735, -22)]:
            draw.line((x, y + dy, x, y, x + dx, y), fill=accent, width=2)

    gesture_text = "[" + gesture + "]"
    gesture_width = int(draw.textlength(gesture_text, font=font(24, "mono"))) + 38
    outline(draw, (104, 796, 104 + gesture_width, 844), "#1b2d23", accent, 12)
    draw.text((123, 807), gesture_text, font=font(24, "mono"), fill=accent)

    web = Image.open(work / (capture + ".webview.png")).convert("RGB")
    if web.size != (600, 800):
        raise ValueError(f"Unexpected WebView dimensions {web.size}")
    # The official capture has blank space below the app. Keep the complete
    # content and let it fill the panel at its original 600px width.
    web = web.crop((0, 0, 600, 586))
    outline(draw, (1171, 274, 1787, 865), "#101613", "#45594f", 13)
    canvas.paste(web, (1179, 277))

    draw.rectangle((0, 913, WIDTH, HEIGHT), fill="#0a120e")
    draw.line((0, 913, WIDTH, 913), fill=accent, width=2)
    label(draw, (65, 940), "NARRATION", accent)
    face = font(34, "bold")
    subtitles = wrap(draw, caption, face, 1510)
    draw.multiline_text((65, 980), subtitles, font=face, fill=WHITE, spacing=5)
    if capture == "receipt":
        draw.text((1856, 953), "BEST TELEGRAM INTEGRATION", font=font(17, "mono"), fill=BLUE, anchor="ra")
    return canvas


def chapter_transition(previous, current, progress, receipt):
    smooth = progress ** 2 * (3 - 2 * progress)
    frame = Image.blend(previous, current, smooth)
    if receipt:
        # Reveal the real SQLite panel and nested Telegram preview from top to bottom.
        left, top, right, bottom = (1179, 583, 1779, 863)
        frame.paste((16, 22, 19), (left, top, right, bottom))
        reveal = (left, top, right, top + round((bottom - top) * smooth))
        frame.paste(current.crop(reveal), reveal[:2])
    return frame


def render(work):
    evidence = json.loads((work / "showcase.json").read_text())
    if set(evidence["stages"]) != {scene[0] for scene in SCENES}:
        raise ValueError("Missing simulator capture stages")
    output = Path("artifacts")
    cache = work / "composition"
    cache.mkdir(exist_ok=True)
    parts = []
    manifest = []
    previous = None
    transition = 6
    for index, scene in enumerate(SCENES):
        current = artwork(work, scene)
        still = cache / f"scene-{index}.png"
        current.save(still)
        fade_frames = 11 if scene[0] == "receipt" else transition
        if previous is not None:
            for frame in range(fade_frames):
                progress = (frame + 1) / (fade_frames + 1)
                filename = cache / f"scene-{index}-mix-{frame}.png"
                chapter_transition(previous, current, progress, scene[0] == "receipt").save(filename)
                manifest.append((filename, 1 / FPS))
        seconds = scene[1] - (fade_frames / FPS if previous is not None else 0)
        manifest.append((still, seconds))
        previous = current

        speech = cache / f"narration-{index}.txt"
        # Spoken forms keep the subtitles' spelling and pacing clear.
        speech.write_text(scene[-1].replace("SQLite", "S Q Lite").replace("Polymarket", "Poly Market"))
        raw = subprocess.check_output([
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-f", "lavfi",
            "-i", f"flite=textfile={speech}:voice=slt", "-af", "atempo=1.06",
            "-ac", "1", "-ar", str(RATE), "-f", "s16le", "-",
        ])
        lead = int(RATE * .45) * 2
        total = scene[1] * RATE * 2
        if lead + len(raw) > total:
            raise ValueError(f"Narration exceeds chapter {index + 1}")
        parts.append(bytes(lead) + raw + bytes(total - lead - len(raw)))

    wav = cache / "narration.wav"
    with wave.open(str(wav), "wb") as audio:
        audio.setparams((1, 2, RATE, 0, "NONE", "not compressed"))
        audio.writeframes(b"".join(parts))

    timeline = cache / "timeline.txt"
    with timeline.open("w") as listing:
        for image, duration in manifest:
            listing.write(f"file {image.name}\noption framerate {FPS}\nduration {duration:.9f}\n")
        listing.write(f"file {manifest[-1][0].name}\noption framerate {FPS}\n")

    path = cache / "pocketpulse-showcase-1080p.mp4"
    duration = sum(scene[1] for scene in SCENES)
    subprocess.run([
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(timeline),
        "-i", str(wav), "-t", str(duration), "-vf", f"fps={FPS}", "-c:v", "libx264", "-threads", "4",
        "-crf", "16", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-af", "loudnorm=I=-16:TP=-1.5:LRA=7",
        "-movflags", "+faststart", str(path),
    ], check=True)

    grid = Image.new("RGB", (1280, 1440))
    elapsed = 0
    for index, scene in enumerate(SCENES):
        frame = subprocess.check_output([
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-ss", str(elapsed + 2), "-i", str(path),
            "-vf", "scale=640:360", "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-threads", "1", "-",
        ])
        grid.paste(Image.frombytes("RGB", (640, 360), frame), (index % 2 * 640, index // 2 * 360))
        elapsed += scene[1]
    grid.save(".local/showcase-grid.png")
    path.replace(output / path.name)
    (output / "showcase-evidence.json").write_text(json.dumps(evidence, indent=2, ensure_ascii=False) + "\n")
    print(f"Composed {duration}s showcase and inspected timeline grid at .local/showcase-grid.png")


if __name__ == "__main__":
    render(Path(sys.argv[1]))
