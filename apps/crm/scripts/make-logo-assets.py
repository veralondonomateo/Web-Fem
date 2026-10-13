"""
Genera versiones con transparencia real del logotipo y del isotipo de Fem.

Los exportes de Figma vienen con el fondo blanco del frame «quemado» dentro de
la imagen, así que `brightness-0 invert` pintaba el rectángulo entero de blanco.
Aquí se recupera la cobertura de tinta de cada píxel (cuánto se aleja del blanco)
y se usa como canal alfa, conservando el antialias de los bordes.
"""
import struct, zlib, sys


def read_png(path):
    d = open(path, 'rb').read()
    w, h, bd, ct = struct.unpack('>IIBB', d[16:26])
    assert bd == 8 and ct in (2, 6), f'{path}: formato no soportado ({bd}/{ct})'
    bpp = 3 if ct == 2 else 4
    i, idat = 8, b''
    while i < len(d):
        ln = struct.unpack('>I', d[i:i + 4])[0]
        if d[i + 4:i + 8] == b'IDAT':
            idat += d[i + 8:i + 8 + ln]
        i += 12 + ln
    raw = zlib.decompress(idat)
    stride = w * bpp
    prev = bytearray(stride)
    rows, p = [], 0
    for _ in range(h):
        f = raw[p]; p += 1
        line = bytearray(raw[p:p + stride]); p += stride
        for x in range(stride):
            a = line[x - bpp] if x >= bpp else 0
            b = prev[x]
            c = prev[x - bpp] if x >= bpp else 0
            if f == 1:   line[x] = (line[x] + a) & 255
            elif f == 2: line[x] = (line[x] + b) & 255
            elif f == 3: line[x] = (line[x] + (a + b) // 2) & 255
            elif f == 4:
                pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[x] = (line[x] + pr) & 255
        prev = line
        rows.append(bytes(line))
    return w, h, bpp, rows


def write_png(path, w, h, rgba_rows):
    raw = b''.join(b'\x00' + bytes(r) for r in rgba_rows)

    def chunk(tag, data):
        return (struct.pack('>I', len(data)) + tag + data
                + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF))

    out = (b'\x89PNG\r\n\x1a\n'
           + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
           + chunk(b'IDAT', zlib.compress(raw, 9))
           + chunk(b'IEND', b''))
    open(path, 'wb').write(out)


def recolor(src, dst, rgb):
    """Reescribe `src` con el color `rgb` y el alfa tomado de la cobertura de tinta."""
    w, h, bpp, rows = read_png(src)

    # Nivel de tinta "sólida": el valor de cobertura más repetido entre los
    # píxeles con tinta. Se normaliza contra él (y no contra el máximo) porque
    # el máximo lo marcan cuatro píxeles del borde del ™ y dejaba el relleno
    # del trazo translúcido.
    hist = {}
    for r in rows:
        for x in range(0, len(r), bpp):
            cover = 255 - min(r[x], r[x + 1], r[x + 2])
            if cover > 8:
                hist[cover] = hist.get(cover, 0) + 1
    if not hist:
        sys.exit(f'{src}: la imagen es blanca entera')
    peak = max(hist, key=lambda k: hist[k])

    out = []
    for r in rows:
        line = bytearray(w * 4)
        for x in range(w):
            o = x * bpp
            cover = (255 - min(r[o], r[o + 1], r[o + 2])) / peak
            a = max(0, min(255, round(cover * 255)))
            line[x * 4:x * 4 + 4] = bytes((rgb[0], rgb[1], rgb[2], a))
        out.append(line)

    write_png(dst, w, h, out)
    print(f'{dst}  ({w}x{h}, alfa desde cobertura, pico={peak})')


if __name__ == '__main__':
    base = '/Users/mateoveralondono/Documents/Fem-CRM/apps/web/public'
    ROSA = (255, 157, 163)
    BLANCO = (255, 255, 255)
    recolor(f'{base}/fem-logo.png',  f'{base}/fem-logo-white.png', BLANCO)
    recolor(f'{base}/fem-logo.png',  f'{base}/fem-logo.png',       ROSA)
    recolor(f'{base}/fem-icon.png',  f'{base}/fem-icon.png',       ROSA)
