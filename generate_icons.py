"""Render code-native app artwork, not an AI-generated image."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parent
for size in (192, 512, 180):
    image = Image.new('RGB', (512, 512), '#0e0e12')
    draw = ImageDraw.Draw(image)
    for y in (155, 270):
        draw.line((110, y, 402, y), fill='#30303e', width=20)
    for x in (175, 337):
        draw.line((x, 100, x, 390), fill='#30303e', width=20)
    draw.ellipse((160, 105, 352, 297), fill='#f0a500')
    draw.polygon(((160, 211), (256, 344), (352, 211)), fill='#f0a500')
    draw.ellipse((221, 165, 291, 235), fill='#0e0e12')
    draw.rounded_rectangle((140, 335, 372, 415), radius=20, fill='#f4f7ff')
    font = ImageFont.truetype('C:/Windows/Fonts/arialbd.ttf', 60)
    draw.text((256, 375), '3000', anchor='mm', font=font, fill='#0e0e12')
    image.resize((size, size), Image.Resampling.LANCZOS).save(root / f'icon-{size}.png')
