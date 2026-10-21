import cytoscape, { type Core, type LayoutOptions, type StylesheetJson } from "cytoscape";
import { Maximize2, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { Severity } from "@sentinel/shared";
import { Button } from "@/components/ui/Button";
import { Tooltip } from "@/components/ui/Overlays";
import { describeGraph, toElements, type GraphData } from "./model";

const SEVERITIES: Severity[] = ["critical", "high", "medium", "low", "info"];

/** Reads a design token ("47 107 94") so the canvas follows the theme and accent instead of hard-coding colours. */
function token(name: string): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();
  return raw ? `rgb(${raw.split(/\s+/).join(",")})` : "rgb(128,128,128)";
}

const reducedMotion = () => typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function stylesheet(): StylesheetJson {
  const sev = Object.fromEntries(SEVERITIES.map((s) => [s, token(`sev-${s}`)])) as Record<Severity, string>;
  const sevStyles = SEVERITIES.flatMap((s) => [
    { selector: `node[severity = "${s}"]`, style: { "border-color": sev[s], "border-width": 4 } },
    { selector: `edge[severity = "${s}"]`, style: { "line-color": sev[s], "target-arrow-color": sev[s] } },
  ]);
  return [
    {
      selector: "node",
      style: {
        width: "data(size)",
        height: "data(size)",
        "background-color": token("surface-3"),
        "border-width": 1.5,
        "border-color": token("text-3"),
        label: "data(label)",
        color: token("text-1"),
        "font-family": "JetBrains Mono, ui-monospace, monospace",
        "font-size": 11,
        "text-valign": "bottom",
        "text-margin-y": 4,
        "text-background-color": token("surface-1"),
        "text-background-opacity": 0.9,
        "text-background-padding": "2px",
        "min-zoomed-font-size": 9,
      },
    },
    // External addresses are squares, so scope does not rely on colour either.
    { selector: 'node[scope = "external"]', style: { shape: "round-rectangle" } },
    // Shape plus a thick severity ring: alerts are never colour alone (the list view also spells them out).
    { selector: "node[?alerted]", style: { shape: "diamond", "background-color": token("surface-1") } },
    { selector: "node[?seed]", style: { "background-color": token("accent"), "border-color": token("accent-fg"), "border-width": 3 } },
    { selector: "node[?seed][?alerted]", style: { shape: "diamond" } },
    ...sevStyles,
    {
      selector: "edge",
      style: {
        width: "data(width)",
        "curve-style": "bezier",
        "line-color": token("text-3"),
        "line-opacity": 0.55,
        "target-arrow-shape": "triangle",
        "target-arrow-color": token("text-3"),
        "arrow-scale": 0.8,
        // Edges are not interactive; without this an arrowhead over a node swallowed the tap.
        events: "no",
      },
    },
    { selector: "edge[?alerted]", style: { "line-style": "dashed", "line-opacity": 0.9 } },
    { selector: "node:selected, node.hover", style: { "overlay-color": token("accent"), "overlay-opacity": 0.18, "overlay-padding": 6 } },
    { selector: "edge.hover", style: { "line-opacity": 1 } },
  ];
}

/** Largest zoom after fitting: two nodes would otherwise fill the whole canvas. */
const MAX_FIT_ZOOM = 1.25;
const MAX_ZOOM = 4;

function layoutFor(count: number, animate: boolean): LayoutOptions {
  // Concentric rings (seeds in the middle, busiest peers closest) are deterministic and linear in size,
  // which keeps 500 nodes responsive where a force-directed layout would take seconds.
  return {
    name: "concentric",
    animate: animate && count <= 300,
    animationDuration: 280,
    fit: true,
    padding: 24,
    avoidOverlap: true,
    minNodeSpacing: 40,
    concentric: (n: cytoscape.NodeSingular) => (n.data("seed") ? 1000 : n.degree(false)),
    levelWidth: () => 3,
  } as LayoutOptions;
}

function fit(cy: Core, animate: boolean) {
  // The layout fits the graph to the canvas but cannot exceed maxZoom; lowering it only while fitting keeps
  // two nodes from filling the canvas. (Setting the zoom afterwards left cytoscape's hit-testing with stale
  // positions, so taps landed on the background: found by the e2e run.)
  cy.maxZoom(MAX_FIT_ZOOM);
  const layout = cy.layout(layoutFor(cy.nodes().length, animate));
  layout.one("layoutstop", () => cy.maxZoom(MAX_ZOOM));
  layout.run();
}

export interface GraphCanvasProps {
  data: GraphData;
  onOpenNode: (ip: string) => void;
}

/**
 * Cytoscape wrapper: pan and zoom with mouse, touch or keyboard; a tap on an address opens it.
 * Loaded lazily (cytoscape is ~450 kB) and never animates under prefers-reduced-motion.
 */
export default function GraphCanvas({ data, onOpenNode }: GraphCanvasProps) {
  const host = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const open = useRef(onOpenNode);
  open.current = onOpenNode;
  const [hovered, setHovered] = useState<string | null>(null);
  const elements = useMemo(() => toElements(data), [data]);
  const many = data.nodes.length > 200;

  useEffect(() => {
    if (!host.current) return;
    const cy = cytoscape({
      container: host.current,
      elements: [...elements.nodes, ...elements.edges],
      style: stylesheet(),
      minZoom: 0.05,
      maxZoom: MAX_ZOOM,
      wheelSensitivity: 0.25,
      boxSelectionEnabled: false,
      // Keeps pan and zoom smooth at 500 nodes: edges and labels are redrawn from a texture while moving.
      textureOnViewport: many,
      hideEdgesOnViewport: many,
      pixelRatio: many ? 1 : "auto",
    });
    cyRef.current = cy;
    fit(cy, false);
    if (import.meta.env.DEV) (host.current as HTMLDivElement & { __cy?: Core }).__cy = cy;
    cy.on("tap", "node", (e) => open.current(e.target.id()));
    cy.on("mouseover", "node", (e) => {
      e.target.addClass("hover");
      setHovered(e.target.id());
      if (host.current) host.current.style.cursor = "pointer";
    });
    cy.on("mouseout", "node", (e) => {
      e.target.removeClass("hover");
      setHovered(null);
      if (host.current) host.current.style.cursor = "";
    });
    // The theme and the accent are attributes on <html>: restyle instead of reloading the graph.
    const observer = new MutationObserver(() => cy.style(stylesheet()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-accent"] });
    return () => {
      observer.disconnect();
      cy.destroy();
      cyRef.current = null;
    };
  }, [elements, many]);

  const zoomBy = (factor: number) => {
    const cy = cyRef.current;
    if (!cy) return;
    const level = Math.min(cy.maxZoom(), Math.max(cy.minZoom(), cy.zoom() * factor));
    cy.zoom({ level, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } });
  };
  const reset = () => {
    const cy = cyRef.current;
    if (!cy) return;
    fit(cy, !reducedMotion());
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const cy = cyRef.current;
    if (!cy) return;
    const step = 60;
    const moves: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    const move = moves[e.key];
    if (move) cy.panBy({ x: move[0], y: move[1] });
    else if (e.key === "+" || e.key === "=") zoomBy(1.25);
    else if (e.key === "-") zoomBy(0.8);
    else if (e.key === "0") reset();
    else return;
    e.preventDefault();
  };
  const hoveredNode = hovered ? data.nodes.find((n) => n.id === hovered) : null;

  return (
    <div>
      <div className="relative overflow-hidden rounded-md border bg-surface-1">
        <div
          ref={host}
          role="group"
          tabIndex={0}
          aria-label={`${describeGraph(data)} Arrow keys pan, plus and minus zoom, zero resets. The list view has every address as a link.`}
          onKeyDown={onKey}
          className="h-[360px] w-full md:h-[460px]"
        />
        <div className="absolute right-2 top-2 flex flex-col gap-1">
          <Tooltip content="Zoom in">
            <Button size="sm" variant="secondary" aria-label="Zoom in" className="px-2" onClick={() => zoomBy(1.25)}>
              <ZoomIn aria-hidden className="h-4 w-4" />
            </Button>
          </Tooltip>
          <Tooltip content="Zoom out">
            <Button size="sm" variant="secondary" aria-label="Zoom out" className="px-2" onClick={() => zoomBy(0.8)}>
              <ZoomOut aria-hidden className="h-4 w-4" />
            </Button>
          </Tooltip>
          <Tooltip content="Reset layout">
            <Button size="sm" variant="secondary" aria-label="Reset layout" className="px-2" onClick={reset}>
              <Maximize2 aria-hidden className="h-4 w-4" />
            </Button>
          </Tooltip>
        </div>
      </div>
      <p className="mt-2 min-h-[20px] text-caption text-fg-2" aria-hidden>
        {hoveredNode
          ? `${hoveredNode.id} · ${hoveredNode.scope} · ${hoveredNode.flows} flows${hoveredNode.alerts ? ` · ${hoveredNode.alerts.count} alert(s), worst ${hoveredNode.alerts.maxSeverity}` : ""}. Click to open it.`
          : "Click an address to open it. Scroll or pinch to zoom, drag to pan."}
      </p>
    </div>
  );
}
