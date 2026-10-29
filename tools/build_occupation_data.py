"""Build exact normal-capture exclusions; never infer capture from movement."""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import re

from decode_res_grid import decode


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--res', type=Path, required=True)
    parser.add_argument('--definitions', type=Path, required=True)
    parser.add_argument('--embedded', type=Path, required=True)
    parser.add_argument('--data-version', default='2026-10-25')
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    raw = args.res.read_bytes()
    width, height, grid = decode(raw)
    if (width, height) != (2000, 3250):
        raise ValueError(f'Unexpected PK2 dimensions: {width} x {height}')
    definitions = json.loads(args.definitions.read_text(encoding='utf-8'))
    allowed = bytearray(256)
    known = {0}  # Resource zero is outside the usable map.
    for row in definitions:
        value = int(row['res_id'])
        if not 0 < value < 256 or value in known:
            raise ValueError(f'Invalid or duplicate resource ID: {value}')
        known.add(value)
        allowed[value] = bool(row['can_be_conquered'] and row['can_be_occupied'] and row['need_adjacent'] and not row['is_block'] and not row['on_water'])
    missing = set(grid) - known
    if missing:
        raise ValueError(f'Missing resource definitions: {sorted(missing)}')
    normal = bytearray(allowed[value] for value in grid)
    text = args.embedded.read_text(encoding='utf-8')
    metadata, _ = json.JSONDecoder().raw_decode(text[text.index('=') + 1:])
    land = base64.b64decode(metadata['passableLandB64'], validate=True)
    size = width * height
    if len(land) != (size + 7) // 8:
        raise ValueError('Unexpected movement bitmap size')
    for facility in metadata['cities'] + metadata['gates']:
        xmin, xmax, ymin, ymax = [int(facility[key]) for key in ('xmin', 'xmax', 'ymin', 'ymax')]
        if not 0 <= xmin <= xmax < width or not 0 <= ymin <= ymax < height:
            raise ValueError(f'Invalid facility bounds: {facility["id"]}')
        for y in range(ymin, ymax + 1):
            normal[y * width + xmin:y * width + xmax + 1] = bytes(xmax - xmin + 1)
    runs = []
    run_start = None
    for i, capture in enumerate(normal):
        movement = (land[i >> 3] >> (i & 7)) & 1
        if capture and not movement:
            raise ValueError(f'Capture terrain absent from movement bitmap at {i % width},{i // width}; use matching source versions')
        excluded = movement and not capture
        if excluded and run_start is None:
            run_start = i
        elif not excluded and run_start is not None:
            runs.extend((run_start, i - run_start))
            run_start = None
    if run_start is not None:
        runs.extend((run_start, size - run_start))
    if args.check:
        match = re.search(r'window\.PK2_EMBEDDED\.occupationExcludedRuns\s*=\s*(\[[^\n]*\]);', text)
        if not match or json.loads(match[1]) != runs:
            raise ValueError('Embedded occupation exclusions do not match the source data')
    else:
        text = re.sub(r'window\.PK2_EMBEDDED\.occupation(?:ExcludedRuns|DataVersion)\s*=\s*[^\n]*\n?', '', text)
        text = text.rstrip() + '\nwindow.PK2_EMBEDDED.occupationExcludedRuns=' + json.dumps(runs, separators=(',', ':')) + ';\n'
        text += 'window.PK2_EMBEDDED.occupationDataVersion=' + json.dumps(args.data_version) + ';\n'
        args.embedded.write_text(text, encoding='utf-8')
    print(json.dumps({'checked': args.check, 'capture_cells': sum(normal), 'excluded_cells': sum(runs[1::2]), 'runs': len(runs) // 2, 'res_sha256': hashlib.sha256(raw).hexdigest()}, ensure_ascii=False))


if __name__ == '__main__':
    main()
