"""Decode PK2's sparse-column resource raster (Python 3, no dependencies)."""
import struct


def decode(data):
    if len(data) < 6:
        raise ValueError('Truncated resource header')
    width, height = struct.unpack_from('>HH', data, 2)
    header_end = 6 + width * 3
    if not width or not height or header_end > len(data):
        raise ValueError('Invalid resource dimensions')
    offsets = [int.from_bytes(data[6 + x * 3:9 + x * 3], 'big') - 1 for x in range(width)]
    if offsets[0] != header_end:
        raise ValueError('Unexpected first resource column offset')
    grid = bytearray(width * height)
    for x, start in enumerate(offsets):
        finish = offsets[x + 1] if x + 1 < width else len(data)
        if not header_end <= start < finish <= len(data):
            raise ValueError(f'Invalid column offsets: {x}')
        count = struct.unpack_from('>H', data, start)[0]
        cursor = start + 2 + count * 5
        if cursor > finish:
            raise ValueError(f'Truncated column intervals: {x}')
        y = 0
        for n in range(count):
            low, high, value = struct.unpack_from('>HHB', data, start + 2 + n * 5)
            if not y <= low <= high < height:
                raise ValueError(f'Invalid resource interval in column {x}')
            gap = low - y
            if cursor + gap > finish:
                raise ValueError(f'Truncated literals in column {x}')
            grid[y * width + x:low * width + x:width] = data[cursor:cursor + gap]
            cursor += gap
            grid[low * width + x:(high + 1) * width + x:width] = bytes([value]) * (high - low + 1)
            y = high + 1
        gap = height - y
        if cursor + gap != finish:
            raise ValueError(f'Resource column {x} does not end at its declared offset')
        grid[y * width + x:height * width + x:width] = data[cursor:cursor + gap]
    return width, height, grid
