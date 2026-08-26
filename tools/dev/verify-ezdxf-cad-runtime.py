#!/usr/bin/env python3
"""Stage-0 probe for the pinned, minimal DXF inspection/rendering runtime."""

from __future__ import annotations

from collections import Counter
import json
from pathlib import Path
import sys
import tempfile
import xml.etree.ElementTree as ET

import ezdxf
import PIL
from ezdxf import recover
from ezdxf.addons.drawing import Frontend, RenderContext, layout, svg


EXPECTED_EZDXF_VERSION = "1.4.4"
EXPECTED_PILLOW_VERSION = "12.3.0"
MAX_PROBE_SVG_BYTES = 64 * 1024


def main() -> None:
    if sys.version_info[:2] != (3, 12):
        raise SystemExit(f"expected Python 3.12, found {sys.version.split()[0]}")
    if ezdxf.__version__ != EXPECTED_EZDXF_VERSION:
        raise SystemExit(
            f"expected ezdxf {EXPECTED_EZDXF_VERSION}, found {ezdxf.__version__}"
        )
    if PIL.__version__ != EXPECTED_PILLOW_VERSION:
        raise SystemExit(
            f"expected Pillow {EXPECTED_PILLOW_VERSION}, found {PIL.__version__}"
        )

    with tempfile.TemporaryDirectory(prefix="myagenttool-ezdxf-probe-") as root:
        source = Path(root) / "probe.dxf"
        document = ezdxf.new("R2018", setup=True)
        document.layers.add("ANNOTATION", color=2)
        model = document.modelspace()
        model.add_line((0, 0), (100, 50))
        model.add_text(
            "Pump P-101", dxfattribs={"layer": "ANNOTATION", "height": 5}
        ).set_placement((10, 10))
        sheet = document.layouts.new("Sheet-A1")
        sheet.add_text("Issued for review", dxfattribs={"height": 4}).set_placement(
            (5, 5)
        )
        document.saveas(source)

        loaded, auditor = recover.readfile(source)
        backend = svg.SVGBackend()
        Frontend(RenderContext(loaded), backend).draw_layout(loaded.modelspace())
        rendered = backend.get_string(layout.Page(0, 0))
        rendered_bytes = rendered.encode("utf-8")
        if len(rendered_bytes) > MAX_PROBE_SVG_BYTES:
            raise SystemExit("probe SVG exceeded its fixed output limit")

        root_element = ET.fromstring(rendered)
        entities = [entity for space in loaded.layouts for entity in space]
        href_values = [
            value
            for element in root_element.iter()
            for key, value in element.attrib.items()
            if key == "href" or key.endswith("}href")
        ]
        result = {
            "ezdxfVersion": ezdxf.__version__,
            "dxfVersion": loaded.dxfversion,
            "auditErrors": len(auditor.errors),
            "auditFixes": len(auditor.fixes),
            "layouts": [item.name for item in loaded.layouts],
            "layers": [item.dxf.name for item in loaded.layers],
            "entityCounts": dict(Counter(entity.dxftype() for entity in entities)),
            "text": [
                entity.dxf.text for entity in entities if entity.dxftype() == "TEXT"
            ],
            "svgBytes": len(rendered_bytes),
            "svgRoot": root_element.tag == "{http://www.w3.org/2000/svg}svg",
            "hasScript": any(
                element.tag.rsplit("}", 1)[-1].lower() == "script"
                for element in root_element.iter()
            ),
            "externalHrefs": [
                value
                for value in href_values
                if value.startswith(("http:", "https:", "//", "data:", "javascript:"))
            ],
        }
        print(json.dumps(result, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
