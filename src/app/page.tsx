"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  Building2,
  Check,
  ChevronDown,
  CircleHelp,
  Mail,
  MapPin,
  Phone,
  Printer,
  RotateCcw,
  Search,
  Share2,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  areaUnits,
  emptyRuleDataset,
  feetPerMeter,
  sqftPerSqm,
  type CalculationResult,
  type RuleDataset,
} from "@/lib/rules";
import { nearestMrtStation } from "@/lib/mrt";
import { CalculationTrace, FarBreakdown, formatNumber } from "@/components/far-result";

const LocationMap = dynamic(() => import("@/components/location-map"), {
  ssr: false,
  loading: () => <div className="map-loading">Loading map...</div>,
});

const foundrio = {
  name: "Foundrio Design & Consultant",
  site: "https://foundrio-bd.com",
  phone: "01813-366009",
  tel: "tel:+8801813366009",
  email: "foundriodesign@foundrio-bd.com",
  address: "House-21, Road-17, Banani C/A, Dhaka-1213",
  facebook: "https://www.facebook.com/foundrio.bd",
};

type AreaUnit = (typeof areaUnits)[number]["value"];
type BlockFilter = "all" | "planned" | "spontaneous";
type FieldErrors = Record<string, string>;
type RulesState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; dataset: RuleDataset };
type ResultMeta = {
  reference: string | null;
  rulesetName: string;
  rulesetSha: string;
  engineVersion: string;
  calculatedAt: string;
};

// Land units Bangladeshi owners use first; the rest stay available.
const customerAreaUnits = (["katha", "decimal", "sqft", "sqm", "chatak", "bigha", "acre", "hectare"] as const).map(
  (value) => areaUnits.find((unit) => unit.value === value)!,
);

const areaLabel: Record<AreaUnit, string> = {
  sqft: "sq ft",
  katha: "katha",
  sqm: "sq m",
  decimal: "decimal",
  chatak: "chatak",
  bigha: "bigha",
  acre: "acre",
  hectare: "hectare",
};

// BNBC occupancy group letters used by the ruleset, in plain words.
const occupancyGroupNames: Record<string, string> = {
  A: "Homes & residential",
  B: "Education",
  C: "Institutional care",
  D: "Health care",
  E: "Offices & business",
  F: "Shops & restaurants",
  G: "Industrial",
  H: "Storage & warehouses",
  I: "Assembly & community",
  J: "Hazardous use",
  K: "Garages & parking",
};

function areaToSqft(value: string, unit: AreaUnit, dataset: RuleDataset): number | null {
  const parsed = Number(value);
  if (value === "" || !Number.isFinite(parsed) || parsed < 0) return null;
  if (unit === "sqft") return parsed;
  const factor = unit === "sqm" ? sqftPerSqm : dataset.areaUnitSqft?.[unit];
  return factor ? parsed * factor : null;
}

/** "5.0 katha" when the ruleset defines katha, otherwise square feet. */
function plotSize(sqft: number, dataset: RuleDataset) {
  const katha = dataset.areaUnitSqft?.katha;
  return katha ? `${formatNumber(sqft / katha, 1)} katha` : `${formatNumber(sqft, 0)} sq ft`;
}

async function fetchRuleDataset(): Promise<RuleDataset> {
  const response = await fetch("/api/rules");
  const body = (await response.json().catch(() => ({}))) as { dataset?: RuleDataset };
  if (!response.ok || !body.dataset) throw new Error("Planning data unavailable");
  return body.dataset;
}

export default function Home() {
  const [rules, setRules] = useState<RulesState>({ status: "loading" });
  const [rulesAttempt, setRulesAttempt] = useState(0);
  const [formError, setFormError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [notice, setNotice] = useState("");
  const [areaValue, setAreaValue] = useState("");
  const [areaUnit, setAreaUnit] = useState<AreaUnit>("katha");
  const [existingRoadFt, setExistingRoadFt] = useState("");
  const [proposedRoadFt, setProposedRoadFt] = useState("");
  const [frontageFt, setFrontageFt] = useState("");
  const [roadWideningNotPossible, setRoadWideningNotPossible] = useState(false);
  const [surrenderedValue, setSurrenderedValue] = useState("");
  const [surrenderedUnit, setSurrenderedUnit] = useState<AreaUnit>("sqft");
  const [technicalOpen, setTechnicalOpen] = useState(false);
  const [blockId, setBlockId] = useState("");
  const [blockSearch, setBlockSearch] = useState("");
  const [blockFilter, setBlockFilter] = useState<BlockFilter>("all");
  const [zoneFilter, setZoneFilter] = useState("all");
  const [showMap, setShowMap] = useState(false);
  const [point, setPoint] = useState<[number, number] | null>(null);
  const [occupancyCode, setOccupancyCode] = useState("");
  const [result, setResult] = useState<CalculationResult | null>(null);
  const [meta, setMeta] = useState<ResultMeta | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);
  const errorSummaryRef = useRef<HTMLDivElement>(null);
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);

  const dataset = rules.status === "ready" ? rules.dataset : emptyRuleDataset;
  const isLoadingRules = rules.status === "loading";

  const selectedBlock = useMemo(
    () => dataset.blocks.find((block) => block.id === blockId),
    [blockId, dataset.blocks],
  );
  const zones = useMemo(
    () => Array.from(new Set(dataset.blocks.flatMap((block) => (block.zone ? [block.zone] : [])))).sort(),
    [dataset.blocks],
  );
  const filteredBlocks = useMemo(() => {
    const query = blockSearch.trim().toLocaleLowerCase();
    return dataset.blocks.filter((block) => {
      const matchesQuery =
        !query ||
        `${block.id} ${block.label} ${block.englishName ?? ""} ${block.keywords ?? ""} ${block.zone ?? ""}`
          .toLocaleLowerCase()
          .includes(query);
      const matchesZone = zoneFilter === "all" || block.zone === zoneFilter;
      const typeCode = block.typeCode?.toLowerCase();
      const matchesKind =
        blockFilter === "all" ||
        (blockFilter === "planned" && typeCode === "p") ||
        (blockFilter === "spontaneous" && typeCode === "s");
      return matchesQuery && matchesZone && matchesKind;
    });
  }, [blockFilter, blockSearch, dataset.blocks, zoneFilter]);
  const occupancyGroups = useMemo(() => {
    const groups = new Map<string, RuleDataset["occupancies"]>();
    for (const occupancy of dataset.occupancies) {
      const name = occupancyGroupNames[occupancy.group ?? ""] ?? "Other uses";
      groups.set(name, [...(groups.get(name) ?? []), occupancy]);
    }
    return [...groups.entries()];
  }, [dataset.occupancies]);

  const areaPreviewSqft = areaToSqft(areaValue, areaUnit, dataset);
  const surrenderedPreviewSqft = areaToSqft(surrenderedValue, surrenderedUnit, dataset);
  const existingRoadWidthNumber = Number(existingRoadFt);
  const proposedRoadWidthNumber = Number(proposedRoadFt);
  const narrowRoadOutsideOldDhaka = Boolean(
    dataset.roadWidening &&
      selectedBlock !== undefined &&
      selectedBlock.typeCode !== "O" &&
      existingRoadWidthNumber > 0 &&
      existingRoadWidthNumber < dataset.roadWidening.minRoadWidthFt,
  );
  const mandatoryWideningRequired = Boolean(
    dataset.roadWidening &&
      existingRoadWidthNumber >= dataset.roadWidening.minRoadWidthFt &&
      existingRoadWidthNumber < dataset.roadWidening.maxRoadWidthFt,
  );
  const proposedRoadRequired =
    dataset.roadFarCombination === "proposed" ||
    narrowRoadOutsideOldDhaka ||
    (mandatoryWideningRequired && !roadWideningNotPossible);
  const surrenderedLandRequired = Boolean(
    dataset.roadWidening?.requireSurrenderOnWidening && proposedRoadWidthNumber > existingRoadWidthNumber,
  );
  // The technical step must stay open whenever the rules need something from it.
  const technicalRequired = proposedRoadRequired || surrenderedLandRequired || mandatoryWideningRequired;
  const selectedOccupancy = dataset.occupancies.find((item) => item.code === occupancyCode);
  const coreDetailsComplete = [
    Boolean(blockId),
    Boolean(areaPreviewSqft && areaPreviewSqft > 0 && existingRoadWidthNumber > 0),
    Boolean(selectedOccupancy),
  ].filter(Boolean).length;

  // Share links (?b=&a=&u=&r=...) restore the main inputs once the ruleset is loaded.
  function restoreFromLink(loaded: RuleDataset) {
    const q = new URLSearchParams(window.location.search);
    const unit = (value: string | null) => areaUnits.find((item) => item.value === value)?.value;
    if (q.get("b") && loaded.blocks.some((block) => block.id === q.get("b"))) setBlockId(q.get("b")!);
    if (q.get("a")) setAreaValue(q.get("a")!);
    if (unit(q.get("u"))) setAreaUnit(unit(q.get("u"))!);
    if (q.get("r")) setExistingRoadFt(q.get("r")!);
    if (q.get("p")) setProposedRoadFt(q.get("p")!);
    if (q.get("s")) setSurrenderedValue(q.get("s")!);
    if (unit(q.get("su"))) setSurrenderedUnit(unit(q.get("su"))!);
    if (q.get("f")) setFrontageFt(q.get("f")!);
    if (q.get("w") === "1") setRoadWideningNotPossible(true);
    if (["p", "s", "f", "w"].some((key) => q.get(key))) setTechnicalOpen(true);
    const code = q.get("o");
    if (code && loaded.occupancies.some((item) => item.code === code)) setOccupancyCode(code);
  }

  useEffect(() => {
    let active = true;
    fetchRuleDataset()
      .then((loaded) => {
        if (!active) return;
        setRules({ status: "ready", dataset: loaded });
        restoreFromLink(loaded);
      })
      .catch(() => {
        if (active) setRules({ status: "error" });
      });
    return () => {
      active = false;
    };
  }, [rulesAttempt]);

  useEffect(() => {
    if (!result) return;
    document.title = `${plotSize(result.plotAreaSqft, dataset)} in ${result.blockLabel}: ${formatNumber(result.floorAreaSqft, 0)} sq ft buildable | Foundrio FAR Calculator`;
  }, [result, dataset]);

  function retryRules() {
    setRules({ status: "loading" });
    setRulesAttempt((attempt) => attempt + 1);
  }

  function clearResult() {
    setResult(null);
    setMeta(null);
  }

  function shareQuery() {
    const q = new URLSearchParams({ b: blockId, a: areaValue, u: areaUnit, r: existingRoadFt });
    if (proposedRoadFt) q.set("p", proposedRoadFt);
    if (Number(surrenderedValue) > 0) {
      q.set("s", surrenderedValue);
      q.set("su", surrenderedUnit);
    }
    if (frontageFt) q.set("f", frontageFt);
    if (roadWideningNotPossible) q.set("w", "1");
    if (occupancyCode) q.set("o", occupancyCode);
    return q.toString();
  }

  function shareResult() {
    const url = window.location.href;
    const text = result
      ? `My ${plotSize(result.plotAreaSqft, dataset)} plot in ${result.blockLabel} can have about ${formatNumber(result.floorAreaSqft, 0)} sq ft of floor area (FAR ${formatNumber(result.appliedFar)}). Check yours free with the Foundrio FAR Calculator:`
      : "Check how much you can build on your plot with the Foundrio FAR Calculator:";
    if (typeof navigator.share === "function") {
      // A rejection here just means the user closed the share sheet.
      navigator.share({ title: "Foundrio FAR Calculator", text, url }).catch(() => undefined);
      return;
    }
    navigator.clipboard
      .writeText(`${text} ${url}`)
      .then(() => setNotice("Link copied. It reopens this plot's details; press Calculate to see the result."))
      .catch(() => setFormError("Could not copy the link. Copy it from the address bar instead."));
  }

  function selectBlock(id: string) {
    setBlockId(id);
    setRoadWideningNotPossible(false);
    clearResult();
  }

  async function calculate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");
    setFieldErrors({});
    setNotice("");
    clearResult();

    const fail = (field: string, message: string) => {
      setFieldErrors({ [field]: message });
      setFormError(message);
      if (["proposed-road-feet", "surrendered-area", "plot-frontage-feet"].includes(field)) setTechnicalOpen(true);
      window.setTimeout(() => errorSummaryRef.current?.focus(), 0);
    };
    const widening = dataset.roadWidening;

    if (!blockId) return fail("block", "Choose the DAP block or area where your plot is.");
    if (!areaValue || !(Number(areaValue) > 0)) return fail("plot-area", "Enter your plot size.");
    if (areaPreviewSqft === null) return fail("plot-area", `Plot size in ${areaLabel[areaUnit]} cannot be converted with the current planning data. Choose another unit.`);
    if (!(existingRoadWidthNumber > 0)) return fail("existing-road-feet", "Enter the width of the road in front of your plot.");
    if (!selectedOccupancy) return fail("occupancy", "Choose what the building will be used for.");
    if (proposedRoadRequired && !(proposedRoadWidthNumber > 0)) {
      return fail("proposed-road-feet", "This road is narrow, so the DAP needs the proposed (widened) road width.");
    }
    if (mandatoryWideningRequired && !roadWideningNotPossible && widening && proposedRoadWidthNumber < widening.targetRoadWidthFt) {
      return fail("proposed-road-feet", `This road must be widened to at least ${formatNumber(widening.targetRoadWidthFt, 2)} ft.`);
    }
    if (narrowRoadOutsideOldDhaka && widening && proposedRoadWidthNumber < widening.targetRoadWidthFt) {
      return fail(
        "proposed-road-feet",
        `Roads narrower than 2.5 m are only allowed in Old Dhaka. Enter a proposed road width of at least ${formatNumber(widening.targetRoadWidthFt, 2)} ft.`,
      );
    }
    if (proposedRoadWidthNumber > 0 && proposedRoadWidthNumber < existingRoadWidthNumber) {
      return fail("proposed-road-feet", "The proposed road width cannot be narrower than the existing road.");
    }
    if (surrenderedValue && surrenderedPreviewSqft === null) {
      return fail("surrendered-area", `Surrendered land in ${areaLabel[surrenderedUnit]} cannot be converted. Choose another unit.`);
    }
    if (surrenderedLandRequired && !(surrenderedPreviewSqft && surrenderedPreviewSqft > 0)) {
      return fail("surrendered-area", "Enter the land you will give up for the road widening; floor area is based on the remaining plot.");
    }

    setIsCalculating(true);
    try {
      const response = await fetch("/api/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          blockId,
          plotArea: Number(areaValue),
          plotAreaUnit: areaUnit,
          existingRoadWidthFt: existingRoadWidthNumber,
          proposedRoadWidthFt: proposedRoadWidthNumber > 0 ? proposedRoadWidthNumber : null,
          roadWideningNotPossible,
          surrenderedArea: Number(surrenderedValue || 0),
          surrenderedAreaUnit: surrenderedUnit,
          occupancyCode,
          plotFrontageFt: Number(frontageFt) > 0 ? Number(frontageFt) : null,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as Partial<ResultMeta> & {
        result?: CalculationResult;
        error?: string;
      };
      if (!response.ok || !body.result) {
        // 422 messages explain a rule (safe to show); anything else gets a plain message.
        throw new Error(
          response.status === 422 && body.error
            ? body.error
            : "We could not calculate this right now. Check your details and try again.",
        );
      }
      setResult(body.result);
      setMeta({
        reference: body.reference ?? null,
        rulesetName: body.rulesetName ?? dataset.name,
        rulesetSha: body.rulesetSha ?? "",
        engineVersion: body.engineVersion ?? "",
        calculatedAt: body.calculatedAt ?? new Date().toISOString(),
      });
      window.history.replaceState(null, "", `?${shareQuery()}`);
      window.setTimeout(() => {
        document.getElementById("results")?.scrollIntoView({
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
          block: "start",
        });
        if (window.matchMedia("(max-width: 768px)").matches) resultHeadingRef.current?.focus();
      }, 60);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "We could not calculate this right now.");
      window.setTimeout(() => errorSummaryRef.current?.focus(), 0);
    } finally {
      setIsCalculating(false);
    }
  }

  function setRoadWidthFromMeters(value: string, setter: (next: string) => void) {
    const parsed = Number(value);
    setter(value === "" || !Number.isFinite(parsed) ? "" : String(Number((parsed * feetPerMeter).toFixed(3))));
    clearResult();
  }

  const blockType = (block: RuleDataset["blocks"][number]) =>
    block.typeCode?.toLowerCase() === "p" ? "planned" : block.typeCode?.toLowerCase() === "s" ? "spontaneous" : "other";
  const unitFactor = areaUnit !== "sqft" && areaUnit !== "sqm" ? dataset.areaUnitSqft?.[areaUnit] : undefined;
  const building = result?.buildingSummary ?? null;

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="skip-link" href="#calculator">Skip to calculator</a>
        <Link className="brand" href="/" aria-label="Foundrio FAR Calculator home">
          <Image className="brand-mark" src="/brand/foundrio-mark.png" alt="" width={40} height={40} loading="eager" />
          <span>
            <strong>FOUNDRIO</strong>
            <small>FAR Calculator</small>
          </span>
        </Link>
        <nav className="top-nav" aria-label="Main navigation">
          <a href="#calculator">Calculator</a>
          <a href="#results">Your result</a>
          <a href={`${foundrio.site}/services/`}>Services</a>
          <a href={`${foundrio.site}/projects/`}>Projects</a>
        </nav>
        <a className="button-call" href={foundrio.tel} aria-label={`Call Foundrio ${foundrio.phone}`}>
          <Phone size={16} aria-hidden="true" />
          <span>Call <span className="call-number">{foundrio.phone}</span></span>
        </a>
      </header>

      <main id="main">
        <section className="hero-strip">
          <div>
            <div className="eyebrow"><span /> Free tool by Foundrio · RAJUK DAP 2022–2035</div>
            <h1>Discover what you can <em>build</em> on your land.</h1>
            <p>
              Tell us where your plot is, how big it is and the road in front of it. We estimate the
              floor area you can build under Dhaka&apos;s DAP and Building Rules 2025. It takes about a minute.
            </p>
            <ul className="trust-line" aria-label="About Foundrio">
              <li><b>250+</b> projects delivered</li>
              <li><b>10+</b> years in practice</li>
              <li>Architecture · Structure · Interiors · MEP</li>
            </ul>
          </div>
          <div className="hero-note">
            <ShieldCheck size={17} aria-hidden="true" />
            <span>An indicative estimate, not RAJUK approval. Foundrio&apos;s architects can review it for your plot.</span>
          </div>
        </section>

        <div className="calculator-layout">
          <form className="input-column" id="calculator" onSubmit={calculate} noValidate>
            <div className="progress-card">
              <div className="progress-copy">
                <span className="progress-step">THREE QUICK STEPS</span>
                <strong>Your plot</strong>
                <small>Location, plot size and road width, then the building use.</small>
              </div>
              <div className="progress-track" aria-hidden="true">
                <span style={{ transform: `scaleX(${result ? 1 : coreDetailsComplete / 3})` }} />
              </div>
              <span className={`progress-state ${result ? "done" : ""}`}>
                {result ? "Estimate ready" : `${coreDetailsComplete} of 3 done`}
              </span>
            </div>

            <section className="panel input-panel" aria-labelledby="step-1-title">
              <div className="step-heading">
                <span className="step-number">01</span>
                <div><h2 id="step-1-title">Location &amp; plot</h2><p>Where is the plot, and how big is it?</p></div>
              </div>

              <label className="field-label" htmlFor="block-search">Area or DAP block</label>
              <div className="search-field">
                <Search size={16} aria-hidden="true" />
                <input
                  id="block-search"
                  placeholder="Search an area, e.g. Mirpur, Bashundhara"
                  value={blockSearch}
                  onChange={(event) => setBlockSearch(event.target.value)}
                  disabled={rules.status !== "ready"}
                />
                {blockSearch && (
                  <button aria-label="Clear search" onClick={() => setBlockSearch("")} type="button">×</button>
                )}
              </div>
              <div className="block-tools">
                <div className="filter-pills" role="group" aria-label="Block type">
                  {([
                    ["all", "All"],
                    ["planned", "Planned"],
                    ["spontaneous", "Spontaneous"],
                  ] as const).map(([id, label]) => (
                    <button
                      aria-pressed={blockFilter === id}
                      className={blockFilter === id ? "selected" : ""}
                      key={id}
                      onClick={() => setBlockFilter(id)}
                      type="button"
                    >{label}</button>
                  ))}
                </div>
                <label className="compact-select">
                  <span className="visually-hidden">Filter by zone</span>
                  <select aria-label="Filter by zone" value={zoneFilter} onChange={(event) => setZoneFilter(event.target.value)}>
                    <option value="all">All zones</option>
                    {zones.map((zone) => <option key={zone} value={zone}>{zone}</option>)}
                  </select>
                  <ChevronDown size={14} aria-hidden="true" />
                </label>
              </div>
              <div className="block-list" id="block" aria-busy={isLoadingRules}>
                {rules.status === "loading" ? (
                  Array.from({ length: 5 }, (_, index) => <div className="skeleton-row" key={index} aria-hidden="true" />)
                ) : rules.status === "error" ? (
                  <div className="load-error" role="alert">
                    <strong>We couldn&apos;t load the planning data.</strong>
                    <span>Check your connection and try again.</span>
                    <button className="button-secondary" onClick={retryRules} type="button">
                      <RotateCcw size={15} aria-hidden="true" /> Retry
                    </button>
                  </div>
                ) : filteredBlocks.length ? (
                  filteredBlocks.map((block) => (
                    <button
                      aria-pressed={blockId === block.id}
                      className={`block-option ${blockId === block.id ? "active" : ""}`}
                      disabled={block.buildable === false || block.areaFar <= 0}
                      key={block.id}
                      onClick={() => selectBlock(block.id)}
                      type="button"
                    >
                      <span className="block-copy">
                        <span className="block-title">
                          <strong>{block.id}</strong>
                          <span>{block.label}</span>
                          {block.typeCode && <i className={`type-tag type-${blockType(block)}`}>{block.typeCode}</i>}
                        </span>
                        <small>
                          {block.buildable === false
                            ? "Reserved or restricted: no building allowed"
                            : [block.englishName, block.zone].filter(Boolean).join(" · ") || "DAP block"}
                        </small>
                      </span>
                      <span className="block-value">
                        <small>Area FAR</small>
                        <b>{formatNumber(block.areaFar)}</b>
                      </span>
                      {blockId === block.id && <Check className="block-selected" size={17} aria-hidden="true" />}
                    </button>
                  ))
                ) : (
                  <div className="empty-list">
                    {dataset.blocks.length ? "No areas match that search. Try another name or clear the filters." : "No DAP blocks are in the planning data."}
                  </div>
                )}
              </div>
              {rules.status === "ready" && dataset.blocks.length > 0 && (
                <small className="list-hint">
                  {filteredBlocks.length} of {dataset.blocks.length} blocks. Not sure which block? Open the map.
                </small>
              )}
              <details className="map-details" open={showMap} onToggle={(event) => setShowMap(event.currentTarget.open)}>
                <summary><MapPin size={15} aria-hidden="true" /> Find my plot on the map <ChevronDown size={14} aria-hidden="true" /></summary>
                <div className="map-wrap">
                  {showMap && rules.status === "ready" && (
                    <LocationMap
                      dataset={dataset}
                      selectedBlockId={blockId}
                      point={point}
                      onSelectBlock={selectBlock}
                      onSelectPoint={setPoint}
                    />
                  )}
                </div>
                {point && (
                  <p className="coordinate-row">
                    Selected point: {point[0].toFixed(5)}, {point[1].toFixed(5)}
                    <button onClick={() => setPoint(null)} type="button">Clear</button>
                  </p>
                )}
                {point && (() => {
                  const nearest = nearestMrtStation(point[0], point[1]);
                  return (
                    <p className="field-hint">
                      Nearest MRT-6 station: {nearest.station.name}{"opens" in nearest.station ? ` (opens ${nearest.station.opens})` : ""}, about {formatNumber(nearest.meters, 0)} m away.
                    </p>
                  );
                })()}
                <p className="field-hint">
                  Tap the block your plot is in. Boundaries are a guide only; confirm the block on the RAJUK DAP map.
                </p>
              </details>

              <div className="land-area-header">
                <label htmlFor="plot-area">Plot size</label>
                <span aria-live="polite">
                  {areaPreviewSqft !== null && areaPreviewSqft > 0
                    ? `≈ ${formatNumber(areaPreviewSqft, 0)} sq ft · ${formatNumber(areaPreviewSqft / sqftPerSqm, 0)} m²`
                    : areaValue && areaPreviewSqft === null
                      ? "This unit can't be converted"
                      : ""}
                </span>
              </div>
              <div className="area-control">
                <input
                  id="plot-area"
                  aria-describedby={`hint-plot-area${fieldErrors["plot-area"] ? " error-plot-area" : ""}`}
                  aria-invalid={Boolean(fieldErrors["plot-area"])}
                  inputMode="decimal"
                  min="0"
                  placeholder="e.g. 5"
                  type="number"
                  value={areaValue}
                  onChange={(event) => {
                    setAreaValue(event.target.value);
                    clearResult();
                  }}
                />
                <label className="area-unit-select">
                  <span className="visually-hidden">Plot size unit</span>
                  <select
                    aria-label="Plot size unit"
                    value={areaUnit}
                    onChange={(event) => {
                      setAreaUnit(event.target.value as AreaUnit);
                      clearResult();
                    }}
                  >
                    {customerAreaUnits.map((unit) => (
                      <option key={unit.value} value={unit.value}>{unit.label}</option>
                    ))}
                  </select>
                  <ChevronDown size={15} aria-hidden="true" />
                </label>
              </div>
              <p className="field-hint" id="hint-plot-area">
                {unitFactor
                  ? `Converted at 1 ${areaLabel[areaUnit]} = ${formatNumber(unitFactor, unitFactor % 1 ? 1 : 0)} sq ft, the standard in the planning data.`
                  : "Use the area from your deed or survey."}
              </p>

              <RoadWidthField
                id="existing-road"
                label="Width of the road in front of your plot"
                hint="Measure edge to edge (boundary to boundary), not just the paved part. If the plot touches several roads, use the widest one."
                invalid={Boolean(fieldErrors["existing-road-feet"])}
                valueFt={existingRoadFt}
                onFeetChange={(value) => {
                  setExistingRoadFt(value);
                  setRoadWideningNotPossible(false);
                  clearResult();
                }}
                onMetersChange={(value) =>
                  setRoadWidthFromMeters(value, (next) => {
                    setExistingRoadFt(next);
                    setRoadWideningNotPossible(false);
                  })
                }
              />
              <details className="field-help">
                <summary><CircleHelp size={14} aria-hidden="true" /> How do I measure the road?</summary>
                <RoadDiagram />
              </details>
            </section>

            <section className="panel input-panel" aria-labelledby="step-2-title">
              <div className="step-heading">
                <span className="step-number">02</span>
                <div><h2 id="step-2-title">Building use</h2><p>What will the building be used for? This changes the FAR.</p></div>
                <Building2 className="heading-icon" size={19} aria-hidden="true" />
              </div>
              <div className="field">
                <label htmlFor="occupancy">Building use</label>
                <div className="select-shell">
                  <select
                    id="occupancy"
                    aria-invalid={Boolean(fieldErrors.occupancy)}
                    disabled={rules.status !== "ready"}
                    value={occupancyCode}
                    onChange={(event) => {
                      setOccupancyCode(event.target.value);
                      clearResult();
                    }}
                  >
                    <option value="">{isLoadingRules ? "Loading building uses…" : "Choose a building use"}</option>
                    {occupancyGroups.map(([group, items]) => (
                      <optgroup key={group} label={group}>
                        {items.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}
                      </optgroup>
                    ))}
                  </select>
                  <ChevronDown size={15} aria-hidden="true" />
                </div>
                <p className="field-hint">
                  {selectedOccupancy
                    ? selectedOccupancy.farTreatment === "road-only"
                      ? "For non-residential use, FAR depends on the road width only (DAP Rule 47(4))."
                      : "For homes, FAR depends on both your area and your road width."
                    : "Most family homes and apartment buildings are “Flat & apartment”."}
                </p>
              </div>
            </section>

            <details
              className="panel input-panel optional-step technical-step"
              open={technicalOpen || technicalRequired}
              onToggle={(event) => setTechnicalOpen(event.currentTarget.open)}
            >
              <summary className="step-heading">
                <span className="step-number" aria-hidden="true">03</span>
                <h2>
                  I have more technical plot information{" "}
                  <span className="optional-tag">{technicalRequired ? "Needed for this road" : "Optional"}</span>
                </h2>
                <ChevronDown className="heading-icon" size={19} aria-hidden="true" />
              </summary>
              <p className="step-intro">
                {technicalRequired
                  ? "Your road is narrower than the DAP minimum, so we need the planned widening."
                  : "Skip this if you're not sure. These details make the estimate more precise."}
              </p>
              {mandatoryWideningRequired && dataset.roadWidening && (
                <p className="inline-notice">
                  The DAP requires this road to widen to at least {formatNumber(dataset.roadWidening.targetRoadWidthFt, 2)} ft
                  ({formatNumber(dataset.roadWidening.targetRoadWidthFt / feetPerMeter, 1)} m). Enter the proposed width and the land you give up for it.
                </p>
              )}
              {narrowRoadOutsideOldDhaka && dataset.roadWidening && (
                <p className="inline-notice">
                  Roads narrower than 2.5 m are only allowed in Old Dhaka. Enter a proposed width of at least {formatNumber(dataset.roadWidening.targetRoadWidthFt, 2)} ft.
                </p>
              )}
              <div className="dimension-grid">
                <RoadWidthField
                  id="proposed-road"
                  label="Proposed (widened) road width"
                  hint="Only if the DAP or RAJUK plans to widen this road. Check the DAP map or your land documents."
                  invalid={Boolean(fieldErrors["proposed-road-feet"])}
                  valueFt={proposedRoadFt}
                  onFeetChange={(value) => { setProposedRoadFt(value); clearResult(); }}
                  onMetersChange={(value) => setRoadWidthFromMeters(value, setProposedRoadFt)}
                  optional={!proposedRoadRequired}
                />
                <RoadWidthField
                  id="plot-frontage"
                  label="Plot frontage (side facing the road)"
                  hint="Used to estimate setbacks and floor size. Without it we assume a square plot."
                  valueFt={frontageFt}
                  onFeetChange={(value) => { setFrontageFt(value); clearResult(); }}
                  onMetersChange={(value) => setRoadWidthFromMeters(value, setFrontageFt)}
                  optional
                />
              </div>
              {mandatoryWideningRequired && (
                <label className="toggle-line road-exception-toggle">
                  <input
                    checked={roadWideningNotPossible}
                    onChange={(event) => {
                      const notPossible = event.target.checked;
                      setRoadWideningNotPossible(notPossible);
                      if (notPossible) {
                        setProposedRoadFt("");
                        setSurrenderedValue("");
                      }
                      clearResult();
                    }}
                    type="checkbox"
                  />
                  <span className="custom-check"><Check size={12} aria-hidden="true" /></span>
                  <span><strong>The road cannot be widened</strong><small>Uses the existing width (Rule 47(7) exception). RAJUK must confirm this applies.</small></span>
                </label>
              )}
              <div className="surrender-row">
                <div>
                  <label htmlFor="surrendered-area">Land given up for road widening{surrenderedLandRequired ? "" : " (optional)"}</label>
                  <small id="hint-surrendered-area">You get extra floor area for land given to the road (DAP Article 3.6.4.2).</small>
                </div>
                <div className="surrender-control">
                  <input
                    id="surrendered-area"
                    aria-describedby={`hint-surrendered-area${fieldErrors["surrendered-area"] ? " error-surrendered-area" : ""}`}
                    aria-invalid={Boolean(fieldErrors["surrendered-area"])}
                    inputMode="decimal"
                    min="0"
                    placeholder="e.g. 150"
                    type="number"
                    value={surrenderedValue}
                    onChange={(event) => {
                      setSurrenderedValue(event.target.value);
                      clearResult();
                    }}
                  />
                  <select
                    aria-label="Surrendered land unit"
                    value={surrenderedUnit}
                    onChange={(event) => { setSurrenderedUnit(event.target.value as AreaUnit); clearResult(); }}
                  >
                    {customerAreaUnits.map((unit) => (
                      <option key={unit.value} value={unit.value}>{areaLabel[unit.value]}</option>
                    ))}
                  </select>
                </div>
                {surrenderedPreviewSqft !== null && surrenderedPreviewSqft > 0 && surrenderedUnit !== "sqft" && (
                  <small className="surrender-equivalent">{formatNumber(surrenderedPreviewSqft, 0)} sq ft</small>
                )}
              </div>
            </details>

            {(formError || notice) && (
              <div
                ref={errorSummaryRef}
                className={`alert ${formError ? "alert-error" : "alert-success"}`}
                role={formError ? "alert" : "status"}
                tabIndex={formError ? -1 : undefined}
              >
                {Object.entries(fieldErrors).length > 0 ? (
                  <ul className="error-summary">
                    {Object.entries(fieldErrors).map(([field, message]) => (
                      <li key={field}>
                        {/* The link doubles as the field's aria-describedby target, so the message is read once. */}
                        <a href={`#${field}`} id={`error-${field}`}>{message}</a>
                      </li>
                    ))}
                  </ul>
                ) : (
                  formError || notice
                )}
              </div>
            )}
            <button className="button-primary calculate-button" disabled={isCalculating || rules.status !== "ready"} type="submit">
              {isCalculating ? "Calculating..." : "Calculate what I can build"}
              <ArrowRight size={17} aria-hidden="true" />
            </button>
            {rules.status !== "ready" && (
              <p className="calculate-hint">
                {isLoadingRules ? "Loading the planning data…" : "The planning data didn't load. Use Retry in step 1."}
              </p>
            )}
          </form>

          <aside className="result-column" id="results">
            <p className="visually-hidden" role="status">
              {result ? `Estimated buildable floor area: about ${formatNumber(result.floorAreaSqft, 0)} square feet.` : ""}
            </p>
            <section className={`result-card ${result ? "has-result" : ""}`} aria-labelledby="results-heading">
              <div className="result-topline">
                <span><BadgeCheck size={15} aria-hidden="true" /> Your estimate</span>
                <span className="result-chip">
                  {meta?.reference ? `Ref ${meta.reference}` : result ? result.blockLabel : "Ready when you are"}
                </span>
              </div>
              {/* Keyed so each new result remounts and replays the reveal. */}
              <div key={result ? `${result.blockLabel}-${result.appliedFar}-${result.floorAreaSqft}` : "empty"} className={result ? "reveal" : undefined}>
                <h2 ref={resultHeadingRef} id="results-heading" tabIndex={-1}>
                  {result ? "Estimated total buildable floor area" : "Your plot's building potential appears here."}
                </h2>
                {result ? (
                  <div className="far-display">
                    <strong>{formatNumber(result.floorAreaSqft, 0)} <small className="far-display-unit">sq ft</small></strong>
                    <small>≈ {formatNumber(result.floorAreaSqft / sqftPerSqm, 0)} m² of floor area in total</small>
                  </div>
                ) : (
                  <p className="result-description">Complete the three steps, then tap Calculate.</p>
                )}
                {result && (
                  <div className="result-lines">
                    <div><span>Applicable FAR</span><b>{formatNumber(result.appliedFar)}</b></div>
                    <div>
                      <span>{result.netPlotAreaSqft !== result.plotAreaSqft ? "Plot area used (after road land)" : "Plot area used"}</span>
                      <b>{plotSize(result.netPlotAreaSqft, dataset)} · {formatNumber(result.netPlotAreaSqft, 0)} sq ft</b>
                    </div>
                    {building ? (
                      <>
                        <div><span>Building height</span><b>G+{building.upperFloors} ({building.storeys} storeys)</b></div>
                        <div><span>Apartments</span><b>about {building.totalUnits} of ~{formatNumber(building.unitSizeSqft, 0)} sq ft</b></div>
                        <div><span>Car parking needed</span><b>{building.carsRequired}{building.bikesRequired > 0 ? ` + ${building.bikesRequired} bikes` : ""}</b></div>
                      </>
                    ) : (
                      <p className="result-note">
                        Storeys, apartments and parking are estimated for flats &amp; apartments only. Foundrio can work them out for this building use.
                      </p>
                    )}
                  </div>
                )}
              </div>
              {result && (
                <>
                  <button className="button-report" onClick={() => window.print()} type="button">
                    <Printer size={15} aria-hidden="true" /> Download report (PDF)
                  </button>
                  <button className="button-report" onClick={shareResult} type="button">
                    <Share2 size={15} aria-hidden="true" /> Share calculation
                  </button>
                  <div className="result-disclaimer">
                    <CircleHelp size={14} aria-hidden="true" />
                    <span>Indicative planning estimate only. It is not RAJUK approval, a building permit or a guaranteed entitlement.</span>
                  </div>
                </>
              )}
            </section>

            <ReviewCard key={meta?.reference ?? (result ? "result" : "empty")} result={result} reference={meta?.reference ?? null} plot={result ? plotSize(result.plotAreaSqft, dataset) : ""} />

            {result && (
              <section className="panel detail-results" aria-labelledby="breakdown-title">
                <div className="results-heading">
                  <div><span>HOW THE FAR WAS WORKED OUT</span><h2 id="breakdown-title">FAR breakdown</h2></div>
                  <span className="result-dataset">{meta?.rulesetName ?? dataset.name}</span>
                </div>
                <FarBreakdown result={result} />
                {(result.siteCoverage || result.roadWideningExceptionUsed) && (
                  <>
                    <h3 className="detail-subheading">Development restrictions</h3>
                    <div className="source-list rule-notes">
                      {result.siteCoverage && (
                        <span>
                          Building footprint up to {formatNumber(result.siteCoverage.maxGroundCoveragePercent, 1)}% of the plot
                          (≈ {formatNumber(result.siteCoverage.groundCoverageSqft, 0)} sq ft).
                        </span>
                      )}
                      {result.siteCoverage && (
                        <span>Keep at least {formatNumber(result.siteCoverage.mandatoryOpenSpacePercent, 1)}% of the plot as open space.</span>
                      )}
                      {result.roadWideningExceptionUsed && (
                        <span>The road-widening exception (Rule 47(7)) was used; RAJUK must confirm it applies.</span>
                      )}
                    </div>
                  </>
                )}
                <details className="rule-details">
                  <summary><span>How was this calculated?</span><ChevronDown size={15} aria-hidden="true" /></summary>
                  <CalculationTrace trace={result.trace} />
                  <h4 className="trace-unverified-title">Not checked by this calculator</h4>
                  <div className="source-list rule-notes">
                    <span>That your plot is really in the block you chose; the map is a guide, not a parcel record.</span>
                    <span>Road widths and plot size, which you measured.</span>
                    <span>Incentives that need authority approval (green building, TOD, TDR and others) are not included.</span>
                    <span>Fire, height-zone, heritage and other site-specific restrictions.</span>
                  </div>
                </details>
                <details className="rule-details">
                  <summary><span>Rules used</span><ChevronDown size={15} aria-hidden="true" /></summary>
                  <div className="source-list">
                    {result.sources.length
                      ? result.sources.map((source) => <span key={source}>{source}</span>)
                      : <span>No source reference is listed for this ruleset.</span>}
                    {meta && (
                      <span>
                        Calculated {new Date(meta.calculatedAt).toLocaleString("en-GB")} · ruleset {meta.rulesetSha.slice(0, 10)} · engine {meta.engineVersion}
                      </span>
                    )}
                  </div>
                </details>
              </section>
            )}
          </aside>
        </div>

        <div className="mobile-action-bar">
          <div>
            <strong>{result ? `${formatNumber(result.floorAreaSqft, 0)} sq ft buildable` : `${coreDetailsComplete} of 3 done`}</strong>
            {result && <span>FAR {formatNumber(result.appliedFar)}{building ? ` · G+${building.upperFloors}` : ""}</span>}
          </div>
          {result ? (
            <span className="mobile-actions">
              <a className="button-icon" href={foundrio.tel} aria-label={`Call Foundrio ${foundrio.phone}`}>
                <Phone size={18} aria-hidden="true" />
              </a>
              <a className="button-primary" href="#results">See result</a>
            </span>
          ) : (
            <button className="button-primary" disabled={isCalculating || rules.status !== "ready"} form="calculator" type="submit">
              {isCalculating ? "Calculating..." : "Calculate"}
            </button>
          )}
        </div>
      </main>

      {result && meta && (
        <section className="print-report" aria-hidden="true">
          <div className="print-brand">
            <Image src="/brand/foundrio-mark.png" alt="" width={28} height={28} />
            Foundrio Design &amp; Consultant · FAR Calculator
          </div>
          <h1>Plot building potential: {result.blockLabel}</h1>
          <p>
            {meta.reference ? `Reference ${meta.reference} · ` : ""}Calculated {new Date(meta.calculatedAt).toLocaleString("en-GB")} · Indicative estimate, not an approval
          </p>
          <p className="print-summary">
            Estimated total buildable floor area: {formatNumber(result.floorAreaSqft, 0)} sq ft
            (≈ {formatNumber(result.floorAreaSqft / sqftPerSqm, 0)} m²) at FAR {formatNumber(result.appliedFar)}.
          </p>
          <h2>Plot details</h2>
          <table>
            <tbody>
              <tr><th>DAP block</th><td>{result.blockLabel}</td></tr>
              {result.zone && <tr><th>Planning zone</th><td>{result.zone}</td></tr>}
              <tr><th>Building use</th><td>{result.occupancyLabels.join(", ")}</td></tr>
              <tr><th>Plot area</th><td>{plotSize(result.plotAreaSqft, dataset)} ({formatNumber(result.plotAreaSqft, 0)} sq ft)</td></tr>
              {result.surrenderedAreaSqft > 0 && <tr><th>Land given to the road</th><td>{formatNumber(result.surrenderedAreaSqft, 0)} sq ft</td></tr>}
              <tr><th>Road width</th><td>{formatNumber(result.existingRoadWidthFt)} ft{result.proposedRoadWidthFt ? `, proposed ${formatNumber(result.proposedRoadWidthFt)} ft` : ""}</td></tr>
              {building && <tr><th>Building estimate</th><td>G+{building.upperFloors}, about {building.totalUnits} apartments, {building.carsRequired} car parking</td></tr>}
            </tbody>
          </table>
          <h2>FAR breakdown</h2>
          <FarBreakdown result={result} />
          <h2>How it was calculated</h2>
          <CalculationTrace trace={result.trace} />
          <h2>Rules used</h2>
          <ul>
            <li>{meta.rulesetName} (ruleset {meta.rulesetSha.slice(0, 10)}, calculation engine {meta.engineVersion})</li>
            {result.sources.map((source) => <li key={source}>{source}</li>)}
          </ul>
          <p className="print-disclaimer">
            This is an indicative planning estimate based on a transcription of DAP 2022–2035 and the Dhaka Metropolitan
            Building Construction Rules 2025. It is not an official RAJUK determination, a building permit or a guaranteed
            development entitlement. Plot location, dimensions and road widths were entered by the user and are not verified.
          </p>
          <p className="print-contact">
            Next step: have this reviewed and designed by {foundrio.name}. Call {foundrio.phone} ·
            {" "}{foundrio.email} · foundrio-bd.com · {foundrio.address}
          </p>
        </section>
      )}

      <footer className="footer">
        <div className="footer-brand">
          <Image src="/brand/foundrio-mark.png" alt="" width={40} height={40} />
          <div>
            <strong>{foundrio.name}</strong>
            <span>Architecture, structure, interiors, MEP and construction. 250+ projects, 10+ years.</span>
          </div>
        </div>
        <ul className="footer-contact">
          <li><a href={foundrio.tel}><Phone size={15} aria-hidden="true" /> {foundrio.phone}</a></li>
          <li><a href={`mailto:${foundrio.email}`}><Mail size={15} aria-hidden="true" /> {foundrio.email}</a></li>
          <li><MapPin size={15} aria-hidden="true" /> {foundrio.address}</li>
        </ul>
        <nav className="footer-links" aria-label="Foundrio">
          <a href={foundrio.site}>foundrio-bd.com</a>
          <a href={`${foundrio.site}/services/`}>Services</a>
          <a href={`${foundrio.site}/projects/`}>Projects</a>
          <a href={`${foundrio.site}/contact/`}>Contact</a>
          <a href={foundrio.facebook}>Facebook</a>
        </nav>
        <p className="footer-note">
          <ShieldCheck size={14} aria-hidden="true" />
          Estimates follow DAP 2022–2035 and the Dhaka Building Construction Rules 2025.
          They are not RAJUK approval, a permit or legal advice.
        </p>
      </footer>
    </div>
  );
}

function ReviewCard({ result, reference, plot }: { result: CalculationResult | null; reference: string | null; plot: string }) {
  const [form, setForm] = useState({ name: "", phone: "", email: "", message: "", website: "" });
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState("");

  const mail = result
    ? `mailto:${foundrio.email}?subject=${encodeURIComponent(`FAR review${reference ? ` ${reference}` : ""}: ${result.blockLabel}`)}&body=${encodeURIComponent(
        `Hello Foundrio,\n\nPlease review this plot.\n\n${reference ? `Reference: ${reference}\n` : ""}Plot: ${plot}, ${result.blockLabel}\nFAR: ${formatNumber(result.appliedFar)}\nFloor area: ${formatNumber(result.floorAreaSqft, 0)} sq ft\n\nName:\nPhone:`,
      )}`
    : `mailto:${foundrio.email}?subject=${encodeURIComponent("Plot consultation")}`;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setStatus("sending");
    try {
      const response = await fetch("/api/enquiries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assessmentId: reference, ...form }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "We could not send your request. Please call us instead.");
      setStatus("sent");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "We could not send your request.");
      setStatus("idle");
    }
  }

  const update = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  if (!result) {
    return (
      <section className="promo-card" aria-labelledby="promo-title">
        <Image className="promo-mark" src="/brand/foundrio-mark.png" alt="" width={36} height={36} />
        <h2 id="promo-title">Planning a building in <em>Dhaka?</em></h2>
        <p>Foundrio Design &amp; Consultant has delivered 250+ projects in 10+ years, from architecture and structural design to interiors, MEP and construction.</p>
        <a className="promo-link" href={`${foundrio.site}/projects/`}>See our projects <ArrowRight size={15} aria-hidden="true" /></a>
      </section>
    );
  }

  return (
    <section className="promo-card reveal reveal-late" aria-labelledby="promo-title">
      <Image className="promo-mark" src="/brand/foundrio-mark.png" alt="" width={36} height={36} />
      <h2 id="promo-title">Get your plot feasibility reviewed by <em>Foundrio</em></h2>
      {status === "sent" ? (
        <p className="review-success" role="status">
          <Check size={16} aria-hidden="true" /> Thank you. An architect will call you within one working day
          {reference ? <> about reference <strong>{reference}</strong></> : null}.
        </p>
      ) : (
        <>
          <p>
            An architect checks this estimate against your actual site: location, road, incentives you may qualify for
            and the most efficient building the rules allow. You don&apos;t need an account.
          </p>
          {reference ? (
            <form className="review-form" onSubmit={submit} noValidate>
              <div className="field">
                <label htmlFor="review-name">Your name</label>
                <input id="review-name" autoComplete="name" required value={form.name} onChange={update("name")} />
              </div>
              <div className="field">
                <label htmlFor="review-phone">Phone</label>
                <input id="review-phone" autoComplete="tel" inputMode="tel" placeholder="01XXXXXXXXX" required type="tel" value={form.phone} onChange={update("phone")} />
              </div>
              <div className="field">
                <label htmlFor="review-email">Email <span className="field-optional">(optional)</span></label>
                <input id="review-email" autoComplete="email" type="email" value={form.email} onChange={update("email")} />
              </div>
              <div className="field">
                <label htmlFor="review-message">Anything we should know? <span className="field-optional">(optional)</span></label>
                <textarea id="review-message" rows={3} maxLength={1000} value={form.message} onChange={update("message")} />
              </div>
              {/* Honeypot for bots: hidden from people and assistive technology. */}
              <div className="visually-hidden" aria-hidden="true">
                <label htmlFor="review-website">Website</label>
                <input id="review-website" autoComplete="off" tabIndex={-1} value={form.website} onChange={update("website")} />
              </div>
              {error && <p className="alert alert-error" role="alert">{error}</p>}
              <button className="button-primary" disabled={status === "sending"} type="submit">
                {status === "sending" ? "Sending..." : "Request architect review"} <ArrowRight size={16} aria-hidden="true" />
              </button>
            </form>
          ) : (
            <p className="inline-notice">Online requests aren&apos;t available right now. Please call or email us.</p>
          )}
        </>
      )}
      <div className="promo-actions">
        <a className="button-secondary" href={foundrio.tel}><Phone size={16} aria-hidden="true" /> Call {foundrio.phone}</a>
        <a className="button-secondary" href={mail}><Mail size={16} aria-hidden="true" /> Email this result</a>
      </div>
    </section>
  );
}

function RoadWidthField({
  id,
  label,
  hint,
  valueFt,
  onFeetChange,
  onMetersChange,
  optional = false,
  invalid = false,
}: {
  id: string;
  label: string;
  hint: string;
  valueFt: string;
  onFeetChange: (value: string) => void;
  onMetersChange: (value: string) => void;
  optional?: boolean;
  invalid?: boolean;
}) {
  const meters = valueFt && Number.isFinite(Number(valueFt)) ? String(Number((Number(valueFt) / feetPerMeter).toFixed(2))) : "";
  const describedBy = `hint-${id}${invalid ? ` error-${id}-feet` : ""}`;
  return (
    <fieldset className="road-field">
      <legend>{label}{optional && <span> (optional)</span>}</legend>
      <div className="road-pair">
        <label>
          <span>Feet</span>
          <input
            id={`${id}-feet`}
            aria-describedby={describedBy}
            aria-invalid={invalid}
            inputMode="decimal"
            min="0"
            onChange={(event) => onFeetChange(event.target.value)}
            placeholder={optional ? "Not entered" : "e.g. 20"}
            type="number"
            value={valueFt}
          />
        </label>
        <label>
          <span>Metres</span>
          <input
            aria-describedby={describedBy}
            aria-invalid={invalid}
            aria-label={`${label} in metres`}
            inputMode="decimal"
            min="0"
            onChange={(event) => onMetersChange(event.target.value)}
            placeholder={optional ? "" : "e.g. 6"}
            type="number"
            value={meters}
          />
        </label>
      </div>
      <p className="field-hint" id={`hint-${id}`}>{hint}</p>
    </fieldset>
  );
}

function RoadDiagram() {
  return (
    <figure className="road-diagram">
      <svg viewBox="0 0 280 130" role="img" aria-labelledby="road-diagram-title">
        <title id="road-diagram-title">Road width is measured from the boundary on your side to the boundary on the opposite side.</title>
        <rect x="20" y="8" width="150" height="56" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <text x="95" y="41" textAnchor="middle" fontSize="12" fill="currentColor">Your plot</text>
        <line x1="0" y1="72" x2="280" y2="72" stroke="currentColor" strokeWidth="1.5" />
        <line x1="0" y1="118" x2="280" y2="118" stroke="currentColor" strokeWidth="1.5" />
        <rect x="0" y="80" width="280" height="30" fill="currentColor" opacity="0.12" />
        <text x="95" y="99" textAnchor="middle" fontSize="11" fill="currentColor">paved part</text>
        <line x1="230" y1="76" x2="230" y2="114" stroke="var(--primary)" strokeWidth="2" markerStart="url(#arrow)" markerEnd="url(#arrow)" />
        <text x="222" y="99" textAnchor="end" fontSize="11" fontWeight="600" fill="var(--primary)">road width</text>
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" fill="var(--primary)" />
          </marker>
        </defs>
      </svg>
      <figcaption>Measure between the two boundary lines (walls or plot edges), including drains and footpaths, not just the paved part.</figcaption>
    </figure>
  );
}
