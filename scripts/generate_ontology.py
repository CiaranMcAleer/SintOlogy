#!/usr/bin/env python3
"""Generate an OWL2/RDF Turtle schema from the Mermaid ERD."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Dict, List, Tuple


TYPE_MAP = {
    "string": "xsd:string",
    "date": "xsd:date",
    "datetime": "xsd:dateTime",
}


def to_pascal(name: str) -> str:
    parts = re.split(r"[_\s-]+", name.strip())
    return "".join(p.capitalize() for p in parts if p)


def to_camel(name: str) -> str:
    pascal = to_pascal(name)
    return pascal[:1].lower() + pascal[1:] if pascal else pascal


def extract_mermaid_block(text: str) -> List[str]:
    in_block = False
    lines: List[str] = []
    for line in text.splitlines():
        if line.strip() == "```mermaid":
            in_block = True
            continue
        if in_block and line.strip() == "```":
            break
        if in_block:
            lines.append(line)
    return lines


def parse_erd(lines: List[str]) -> Tuple[Dict[str, List[Tuple[str, str]]], List[Tuple[str, str, str]]]:
    entities: Dict[str, List[Tuple[str, str]]] = {}
    relationships: List[Tuple[str, str, str]] = []

    current_entity = None
    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue

        entity_match = re.match(r"^([A-Z0-9_]+)\s*\{\s*$", stripped)
        if entity_match:
            current_entity = entity_match.group(1)
            entities[current_entity] = []
            continue

        if stripped == "}":
            current_entity = None
            continue

        if current_entity:
            field_match = re.match(r"^(\w+)\s+([A-Za-z0-9_]+)$", stripped)
            if field_match:
                field_type, field_name = field_match.groups()
                entities[current_entity].append((field_name, field_type))
            continue

        rel_match = re.match(r"^([A-Z0-9_]+)\s+[^A-Z0-9_]+\s+([A-Z0-9_]+)\s*:\s*([A-Za-z0-9_ -]+)$", stripped)
        if rel_match:
            left, right, label = rel_match.groups()
            relationships.append((left, right, label.strip()))

    return entities, relationships


def build_model(
    entities: Dict[str, List[Tuple[str, str]]],
    relationships: List[Tuple[str, str, str]],
) -> Dict[str, Dict]:
    classes = sorted(to_pascal(entity) for entity in entities.keys())
    data_props: Dict[str, Dict[str, set]] = {}
    obj_props: Dict[str, Dict[str, set]] = {}

    for entity, fields in entities.items():
        class_name = to_pascal(entity)
        for field_name, field_type in fields:
            if field_name.endswith("_id") or field_name.lower() == "id":
                continue
            prop_name = to_camel(field_name)
            xsd_type = TYPE_MAP.get(field_type.lower(), "xsd:string")
            entry = data_props.setdefault(prop_name, {"domains": set(), "ranges": set()})
            entry["domains"].add(class_name)
            entry["ranges"].add(xsd_type)

    for left, right, label in relationships:
        prop_name = f"{to_camel(label)}{to_pascal(right)}"
        entry = obj_props.setdefault(prop_name, {"domains": set(), "ranges": set()})
        entry["domains"].add(to_pascal(left))
        entry["ranges"].add(to_pascal(right))

    return {
        "classes": classes,
        "data_props": data_props,
        "object_props": obj_props,
    }


def build_ttl(model: Dict[str, Dict]) -> str:
    classes = model["classes"]
    data_props = model["data_props"]
    obj_props = model["object_props"]

    lines: List[str] = []
    lines.append("@prefix : <http://example.org/sintology#> .")
    lines.append("@prefix owl: <http://www.w3.org/2002/07/owl#> .")
    lines.append("@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .")
    lines.append("@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .")
    lines.append("@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .")
    lines.append("")
    lines.append(":Ontology a owl:Ontology .")
    lines.append("")

    for class_name in classes:
        lines.append(f":{class_name} a owl:Class ;")
        lines.append(f"  rdfs:label \"{class_name}\" .")
        lines.append("")

    for prop_name, meta in sorted(data_props.items()):
        domains = meta["domains"]
        ranges = meta["ranges"]
        domain_value = "owl:Thing" if len(domains) != 1 else f":{next(iter(domains))}"
        range_value = "xsd:string" if len(ranges) != 1 else next(iter(ranges))
        lines.append(f":{prop_name} a owl:DatatypeProperty ;")
        lines.append(f"  rdfs:domain {domain_value} ;")
        lines.append(f"  rdfs:range {range_value} .")
        lines.append("")

    for prop_name, meta in sorted(obj_props.items()):
        domains = meta["domains"]
        ranges = meta["ranges"]
        domain_value = "owl:Thing" if len(domains) != 1 else f":{next(iter(domains))}"
        range_value = "owl:Thing" if len(ranges) != 1 else f":{next(iter(ranges))}"
        lines.append(f":{prop_name} a owl:ObjectProperty ;")
        lines.append(f"  rdfs:domain {domain_value} ;")
        lines.append(f"  rdfs:range {range_value} .")
        lines.append("")

    return "\n".join(lines).rstrip() + "\n"


def build_json(model: Dict[str, Dict]) -> str:
    classes = [{"name": name, "label": name} for name in model["classes"]]
    data_props = []
    for name, meta in sorted(model["data_props"].items()):
        data_props.append(
            {
                "name": name,
                "domain": sorted(meta["domains"]),
                "range": sorted(meta["ranges"]),
                "kind": "datatype",
            }
        )

    obj_props = []
    for name, meta in sorted(model["object_props"].items()):
        obj_props.append(
            {
                "name": name,
                "domain": sorted(meta["domains"]),
                "range": sorted(meta["ranges"]),
                "kind": "object",
            }
        )

    payload = {
        "classes": classes,
        "properties": data_props + obj_props,
    }
    return json.dumps(payload, indent=2, sort_keys=True) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate OWL2/RDF Turtle from Mermaid ERD.")
    parser.add_argument("--erd", default="erd/erd.md", help="Path to ERD markdown")
    parser.add_argument("--out", default="ontology/sintology.ttl", help="Output Turtle path")
    parser.add_argument("--json", default="ontology/ontology.json", help="Output JSON schema path")
    args = parser.parse_args()

    erd_path = Path(args.erd)
    out_path = Path(args.out)
    json_path = Path(args.json)

    text = erd_path.read_text(encoding="utf-8")
    mermaid_lines = extract_mermaid_block(text)
    if not mermaid_lines:
        raise SystemExit("No Mermaid block found in ERD file.")

    entities, relationships = parse_erd(mermaid_lines)
    model = build_model(entities, relationships)
    ttl = build_ttl(model)
    json_payload = build_json(model)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(ttl, encoding="utf-8")
    json_path.parent.mkdir(parents=True, exist_ok=True)
    json_path.write_text(json_payload, encoding="utf-8")


if __name__ == "__main__":
    main()
