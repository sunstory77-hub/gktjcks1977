#!/usr/bin/env python3
"""앱 아이콘(.ico/.png) 생성 — 글꼴 없이 도형만 사용한다. by BAPI"""
import sys
from PIL import Image, ImageDraw

def lerp(a, b, t): return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))

def draw(size=512):
    S = size
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((0, 0, S - 1, S - 1), radius=int(S * 0.275), fill=(20, 30, 64, 255))
    # 페이지(라벤더→민트 그라데이션)
    page = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    px = page.load()
    x0, y0, x1, y1 = int(S * .25), int(S * .175), int(S * .75), int(S * .825)
    for y in range(y0, y1):
        for x in range(x0, x1):
            t = ((x - x0) / (x1 - x0) + (y - y0) / (y1 - y0)) / 2
            px[x, y] = lerp((182, 166, 255), (123, 232, 200), t) + (255,)
    mask = Image.new('L', (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle((x0, y0, x1, y1), radius=int(S * .1), fill=255)
    im.paste(page, (0, 0), mask)
    d = ImageDraw.Draw(im)
    navy = (20, 30, 64, 255); navy2 = (20, 30, 64, 140)
    d.rounded_rectangle((int(S * .35), int(S * .30), int(S * .65), int(S * .375)), radius=int(S * .035), fill=navy)
    d.rounded_rectangle((int(S * .35), int(S * .45), int(S * .65), int(S * .51)), radius=int(S * .03), fill=navy2)
    d.rounded_rectangle((int(S * .35), int(S * .575), int(S * .55), int(S * .635)), radius=int(S * .03), fill=navy2)
    return im

if __name__ == '__main__':
    out = sys.argv[1]
    big = draw(512)
    big.save(out + '/app.png')
    big.save(out + '/app.ico', sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    print('icon ok')
