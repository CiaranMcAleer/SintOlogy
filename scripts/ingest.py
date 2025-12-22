#!/usr/bin/env python3
"""Interactive ingestion tool driven by the ontology JSON."""

from __future__ import annotations

import argparse
import json
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional


def load_json(path: Path, default: Dict[str, Any]) -> Dict[str, Any]:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def save_json(path: Path, payload: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def prompt(text: str) -> str:
    return input(text).strip()


def select_option(title: str, options: List[str], allow_skip: bool = False) -> str:
    if not options:
        return ""
    print(f"\n{title}")
    for idx, option in enumerate(options, start=1):
        print(f"  {idx}. {option}")
    if allow_skip:
        print("  0. Skip")

    while True:
        choice = prompt("Select: ")
        if allow_skip and choice == "0":
            return ""
        if choice.isdigit():
            index = int(choice) - 1
            if 0 <= index < len(options):
                return options[index]
        print("Invalid selection. Try again.")


def get_class_names(ontology: Dict[str, Any]) -> List[str]:
    return [entry["name"] for entry in ontology.get("classes", [])]


def filter_properties(
    ontology: Dict[str, Any], class_name: str, kind: str
) -> List[Dict[str, Any]]:
    properties = []
    for prop in ontology.get("properties", []):
        if prop.get("kind") != kind:
            continue
        domains = prop.get("domain", [])
        if class_name in domains or "owl:Thing" in domains:
            properties.append(prop)
    return properties


def label_for_node(node: Dict[str, Any]) -> str:
    props = node.get("properties", {})
    for key in ("name", "fullName", "handle", "title"):
        if key in props and props[key]:
            return str(props[key])
    return node["id"][:8]


def list_nodes_by_class(graph: Dict[str, Any]) -> Dict[str, List[Dict[str, Any]]]:
    grouped: Dict[str, List[Dict[str, Any]]] = {}
    for node in graph.get("nodes", []):
        grouped.setdefault(node["class"], []).append(node)
    return grouped


def select_node(
    nodes: List[Dict[str, Any]], title: str, allow_skip: bool = False
) -> Optional[Dict[str, Any]]:
    if not nodes:
        print("No matching nodes found.")
        return None
    options = [f"{label_for_node(node)} ({node['class']}, {node['id'][:8]})" for node in nodes]
    selected = select_option(title, options, allow_skip=allow_skip)
    if not selected:
        return None
    index = options.index(selected)
    return nodes[index]


def create_entity(ontology: Dict[str, Any], graph: Dict[str, Any]) -> None:
    class_name = select_option("Choose a class", get_class_names(ontology))
    if not class_name:
        return

    data_props = filter_properties(ontology, class_name, "datatype")
    values: Dict[str, Any] = {}
    print("\nEnter values (leave blank to skip):")
    for prop in data_props:
        name = prop["name"]
        ranges = ", ".join(prop.get("range", [])) or "xsd:string"
        value = prompt(f"  {name} [{ranges}]: ")
        if value:
            values[name] = value

    node = {
        "id": uuid.uuid4().hex,
        "class": class_name,
        "properties": values,
    }
    graph.setdefault("nodes", []).append(node)
    print(f"\nCreated {class_name} {label_for_node(node)}")

    object_props = filter_properties(ontology, class_name, "object")
    if not object_props:
        return

    if prompt("Add relationships now? (y/N): ").lower() != "y":
        return

    add_relationships(ontology, graph, node)


def add_relationships(ontology: Dict[str, Any], graph: Dict[str, Any], source_node: Dict[str, Any]) -> None:
    object_props = filter_properties(ontology, source_node["class"], "object")
    if not object_props:
        print("No object properties available for this class.")
        return

    while True:
        prop_names = [prop["name"] for prop in object_props]
        prop_name = select_option("Select relationship type", prop_names, allow_skip=True)
        if not prop_name:
            break
        prop = next(p for p in object_props if p["name"] == prop_name)
        ranges = prop.get("range", [])
        candidates = [
            node
            for node in graph.get("nodes", [])
            if node["class"] in ranges
        ]
        target = select_node(candidates, "Select target", allow_skip=True)
        if not target:
            continue
        edge = {
            "id": uuid.uuid4().hex,
            "type": prop_name,
            "from": source_node["id"],
            "to": target["id"],
        }
        graph.setdefault("edges", []).append(edge)
        print(f"Linked {label_for_node(source_node)} -> {prop_name} -> {label_for_node(target)}")


def link_entities(ontology: Dict[str, Any], graph: Dict[str, Any]) -> None:
    nodes = graph.get("nodes", [])
    if not nodes:
        print("No entities yet. Create one first.")
        return
    source = select_node(nodes, "Select source entity")
    if not source:
        return
    add_relationships(ontology, graph, source)


def list_entities(graph: Dict[str, Any]) -> None:
    grouped = list_nodes_by_class(graph)
    if not grouped:
        print("No entities in the graph yet.")
        return
    print("\nEntities")
    for class_name in sorted(grouped.keys()):
        print(f"- {class_name} ({len(grouped[class_name])})")
        for node in grouped[class_name]:
            print(f"  - {label_for_node(node)} [{node['id'][:8]}]")


def main() -> None:
    parser = argparse.ArgumentParser(description="Ontology-driven data ingestion")
    parser.add_argument("--ontology", default="ontology/ontology.json", help="Ontology JSON path")
    parser.add_argument("--data", default="data/graph.json", help="Graph data path")
    parser.add_argument("--load", help="Load nodes/edges from a JSON file into the graph store")
    parser.add_argument(
        "--non-interactive",
        action="store_true",
        help="Exit after loading data (skip interactive prompts)",
    )
    args = parser.parse_args()

    ontology_path = Path(args.ontology)
    if not ontology_path.exists():
        raise SystemExit("Ontology JSON not found. Run scripts/generate_ontology.py first.")

    ontology = load_json(ontology_path, {})
    graph = load_json(Path(args.data), {"nodes": [], "edges": []})

    if args.load:
        incoming = load_json(Path(args.load), {"nodes": [], "edges": []})
        existing_node_ids = {node["id"] for node in graph.get("nodes", [])}
        existing_edge_ids = {edge["id"] for edge in graph.get("edges", [])}

        for node in incoming.get("nodes", []):
            if node["id"] not in existing_node_ids:
                graph.setdefault("nodes", []).append(node)
                existing_node_ids.add(node["id"])

        for edge in incoming.get("edges", []):
            if edge["id"] not in existing_edge_ids:
                graph.setdefault("edges", []).append(edge)
                existing_edge_ids.add(edge["id"])

        save_json(Path(args.data), graph)
        if args.non_interactive:
            return

    while True:
        print("\nIngestion Menu")
        print("  1. Create entity")
        print("  2. Link entities")
        print("  3. List entities")
        print("  4. Exit")
        choice = prompt("Select: ")
        if choice == "1":
            create_entity(ontology, graph)
            save_json(Path(args.data), graph)
        elif choice == "2":
            link_entities(ontology, graph)
            save_json(Path(args.data), graph)
        elif choice == "3":
            list_entities(graph)
        elif choice == "4":
            break
        else:
            print("Invalid choice.")


if __name__ == "__main__":
    main()
