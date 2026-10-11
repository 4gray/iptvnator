#!/usr/bin/env python3
"""Minimal asar extractor: extracts a sub-directory of an Electron app.asar.

Usage: asar_extract.py <app.asar> <path-inside-asar> <out-dir>
"""
import json
import os
import struct
import sys


def main() -> int:
    asar_path, inner, out_dir = sys.argv[1], sys.argv[2].strip("/"), sys.argv[3]
    with open(asar_path, "rb") as fh:
        (pickle_len_field,) = struct.unpack("<I", fh.read(4))  # always 4
        (header_size,) = struct.unpack("<I", fh.read(4))
        pickle = fh.read(header_size)
        (json_len,) = struct.unpack("<I", pickle[4:8])
        header = json.loads(pickle[8 : 8 + json_len].decode("utf-8"))
        base = 8 + header_size

        node = header
        for part in inner.split("/"):
            node = node["files"][part]

        count = 0

        def walk(n, rel):
            nonlocal count
            for name, child in n["files"].items():
                path = os.path.join(rel, name)
                if "files" in child:
                    os.makedirs(os.path.join(out_dir, path), exist_ok=True)
                    walk(child, path)
                else:
                    if child.get("unpacked"):
                        continue
                    offset = int(child["offset"])
                    size = int(child["size"])
                    fh.seek(base + offset)
                    data = fh.read(size)
                    full = os.path.join(out_dir, path)
                    os.makedirs(os.path.dirname(full), exist_ok=True)
                    with open(full, "wb") as out:
                        out.write(data)
                    count += 1

        os.makedirs(out_dir, exist_ok=True)
        walk(node, "")
        print(f"extracted {count} files to {out_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
