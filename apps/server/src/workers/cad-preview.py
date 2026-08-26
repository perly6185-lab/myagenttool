#!/usr/bin/env python3
"""Fixed, read-only DXF inspection/render worker. Reads one JSON request on stdin."""

from __future__ import annotations

from collections import Counter
import json
import sys
import xml.etree.ElementTree as ET

import ezdxf
import PIL
from ezdxf import bbox, recover
from ezdxf.addons.drawing import Frontend, RenderContext, layout as page_layout, svg

MAX_ENTITIES = 100_000
MAX_LAYOUTS = 32
MAX_LAYERS = 512
MAX_TEXTS = 10_000
MAX_TEXT_LENGTH = 2_000
MAX_WARNINGS = 500
SVG_NS = "http://www.w3.org/2000/svg"
EXPECTED_EZDXF = "1.4.4"
EXPECTED_PILLOW = "12.3.0"
ALLOWED_TAGS = {"svg", "g", "defs", "style", "path", "rect", "line", "polyline", "polygon", "circle", "ellipse", "text", "tspan", "use", "clipPath"}
ALLOWED_ATTRS = {"id", "class", "d", "transform", "viewBox", "width", "height", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "points", "fill", "stroke", "stroke-width", "stroke-opacity", "fill-opacity", "clip-path", "preserveAspectRatio", "href"}


def fail(code: str, message: str) -> None:
    print(json.dumps({"ok": False, "error": code, "message": message}))
    raise SystemExit(0)


def clean_text(value: object) -> str:
    return str(value or "").replace("\x00", "").strip()[:MAX_TEXT_LENGTH]


def sanitize_svg(value: str) -> str:
    root = ET.fromstring(value)
    if root.tag != f"{{{SVG_NS}}}svg":
        fail("cad_svg_rejected", "Renderer did not produce an SVG root.")

    def scrub(parent: ET.Element) -> None:
        for child in list(parent):
            local = child.tag.rsplit("}", 1)[-1]
            if local not in ALLOWED_TAGS:
                parent.remove(child)
                continue
            scrub(child)
        for key in list(parent.attrib):
            local = key.rsplit("}", 1)[-1]
            value = parent.attrib[key]
            if local not in ALLOWED_ATTRS or local.lower().startswith("on"):
                del parent.attrib[key]
                continue
            if local == "href" and not value.startswith("#"):
                del parent.attrib[key]
                continue
            lowered = value.lower()
            if "javascript:" in lowered or "data:" in lowered or "http:" in lowered or "https:" in lowered or "url(" in lowered:
                del parent.attrib[key]
        if parent.tag.rsplit("}", 1)[-1] == "style":
            style = parent.text or ""
            lowered = style.lower()
            if "@import" in lowered or "url(" in lowered or "javascript:" in lowered:
                parent.text = ""

    scrub(root)
    ET.register_namespace("", SVG_NS)
    return ET.tostring(root, encoding="unicode")


def main() -> None:
    try:
        if sys.version_info[:2] != (3, 12) or ezdxf.__version__ != EXPECTED_EZDXF or PIL.__version__ != EXPECTED_PILLOW:
            fail("ezdxf_unavailable", "CAD preview runtime does not match the pinned version contract.")
        request = json.loads(sys.stdin.read())
        source = str(request["file"])
        action = request.get("action", "inspect")
        selected_layout = clean_text(request.get("layout", "Model")) or "Model"
        visible_layers = request.get("visibleLayers")
        if visible_layers is not None and not isinstance(visible_layers, list):
            fail("cad_invalid_request", "visibleLayers must be an array.")
        visible = {clean_text(item) for item in visible_layers or []}

        document, auditor = recover.readfile(source)
        layouts = [item.name for item in document.layouts]
        layers = [item.dxf.name for item in document.layers]
        if len(layouts) > MAX_LAYOUTS:
            fail("cad_layout_limit_exceeded", "Drawing contains too many layouts.")
        if len(layers) > MAX_LAYERS:
            fail("cad_layer_limit_exceeded", "Drawing contains too many layers.")

        entities = []
        for space in document.layouts:
            for entity in space:
                if len(entities) >= MAX_ENTITIES:
                    fail("cad_entity_limit_exceeded", "Drawing contains too many entities.")
                entities.append((space.name, entity))
        texts = []
        for layout_name, entity in entities:
            kind = entity.dxftype()
            text = ""
            if kind == "TEXT":
                text = clean_text(entity.dxf.text)
            elif kind == "MTEXT":
                text = clean_text(entity.plain_text())
            elif kind == "ATTRIB":
                text = clean_text(entity.dxf.text)
            if text and len(texts) < MAX_TEXTS:
                insert = entity.dxf.get("insert")
                texts.append({"text": text, "type": kind, "layer": clean_text(entity.dxf.layer), "layout": layout_name, "x": None if insert is None else float(insert.x), "y": None if insert is None else float(insert.y)})

        if selected_layout not in layouts:
            fail("cad_layout_not_found", "Requested layout does not exist.")
        target = document.modelspace() if selected_layout == "Model" else document.paperspace(selected_layout)
        extents = bbox.extents(target, fast=True)
        layout_extents = {}
        for space in document.layouts:
            bounds = bbox.extents(space, fast=True)
            layout_extents[space.name] = None if not bounds.has_data else {"min": list(bounds.extmin), "max": list(bounds.extmax)}
        response = {
            "ok": True,
            "version": document.dxfversion,
            "units": int(document.units),
            "extents": None if not extents.has_data else {"min": list(extents.extmin), "max": list(extents.extmax)},
            "layouts": layouts,
            "layers": layers,
            "layoutExtents": layout_extents,
            "entityCounts": dict(Counter(entity.dxftype() for _, entity in entities)),
            "texts": texts,
            "warnings": [clean_text(item) for item in auditor.errors[:MAX_WARNINGS]],
            "audit": {"errors": len(auditor.errors), "fixes": len(auditor.fixes)},
        }
        if action == "render":
            backend = svg.SVGBackend()
            frontend = Frontend(RenderContext(document), backend)
            frontend.draw_layout(target, filter_func=(lambda entity: visible_layers is None or entity.dxf.layer in visible))
            response["svg"] = sanitize_svg(backend.get_string(page_layout.Page(0, 0)))
        elif action != "inspect":
            fail("cad_invalid_request", "Unknown CAD preview action.")
        print(json.dumps(response))
    except (IOError, OSError):
        fail("cad_read_failed", "DXF file could not be read.")
    except ezdxf.DXFStructureError:
        fail("cad_corrupt_file", "DXF structure is invalid or corrupt.")
    except KeyError:
        fail("cad_layout_not_found", "Requested layout does not exist.")
    except Exception:
        fail("cad_processing_failed", "DXF processing failed.")


if __name__ == "__main__":
    main()
