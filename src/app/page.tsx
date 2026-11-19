"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import {
  ArrowDownToLine,
  ArrowRight,
  BadgeCheck,
  Building2,
  Check,
  ChevronDown,
  CircleHelp,
  Database,
  ExternalLink,
  FileUp,
  Layers3,
  MapPin,
  Printer,
  Search,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  areaUnits,
  emptyRuleDataset,
  feetPerMeter,
  sqftPerSqm,
  type CalculationResult,
  type ReportSection,
  type RuleDataset,
} from "@/lib/rules";

const LocationMap = dynamic(() => import("@/components/location-map"), {
  ssr: false,
  loading: () => <div className="map-loading">Loading map...</div>,
});

type ApiError = {
  error?: string;
  issues?: Array<{ path: string; message: string }>;
};

type OccupancyShare = { code: string; sharePercent: number };
type ResultTab = "far" | "design" | "parking";
type BlockFilter = "all" | "planned" | "spontaneous";
type FieldErrors = Record<string, string>;

const resultSections: Record<ResultTab, ReportSection[]> = {
  far: ["far", "groundCoverage", "setbacks"],
  design: ["layout"],
  parking: ["parking", "stairsElevator"],
};

const resultSectionLabels: Record<ReportSection, string> = {
  far: "FAR assessment",
  groundCoverage: "Ground coverage & open space",
  setbacks: "Setbacks & clearances",
  layout: "Building layout",
  parking: "Parking",
  stairsElevator: "Stairs & lifts",
};

const areaLabel: Record<string, string> = {
  sqft: "sq ft",
  katha: "katha",
  sqm: "sq m",
  decimal: "decimal",
  chatak: "chatak",
  bigha: "bigha",
  acre: "acre",
  hectare: "hectare",
};

function formatNumber(value: number, digits = 2) {
  return new Intl.NumberFormat("en-BD", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value);
}

function areaToSqft(
  value: string,
  unit: (typeof areaUnits)[number]["value"],
  dataset: RuleDataset,
): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  if (unit === "sqft") return parsed;
  const factor =
    unit === "sqm" ? sqftPerSqm : dataset.areaUnitSqft?.[unit];
  return factor ? parsed * factor : null;
}

function amountWithUnit(value: number | null, unit?: string, precision = 2) {
  if (value === null) return "Not applicable";
  const formatted = formatNumber(value, precision);
  return unit ? `${formatted} ${unit}` : formatted;
}

function resultErrorMessage(body: ApiError) {
  const detail = body.issues?.length
    ? ` ${body.issues
        .slice(0, 3)
        .map((issue) => `${issue.path || "file"}: ${issue.message}`)
        .join("; ")}`
    : "";
  return `${body.error ?? "The request could not be completed."}${detail}`;
}

export default function Home() {
  const [dataset, setDataset] = useState<RuleDataset>(emptyRuleDataset);
  const [isLoadingRules, setIsLoadingRules] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [formError, setFormError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [notice, setNotice] = useState("");
  const [areaValue, setAreaValue] = useState("");
  const [areaUnit, setAreaUnit] =
    useState<(typeof areaUnits)[number]["value"]>("sqft");
  const [existingRoadFt, setExistingRoadFt] = useState("");
  const [proposedRoadFt, setProposedRoadFt] = useState("");
  const [roadWideningNotPossible, setRoadWideningNotPossible] = useState(false);
  const [surrenderedValue, setSurrenderedValue] = useState("0");
  const [surrenderedUnit, setSurrenderedUnit] =
    useState<(typeof areaUnits)[number]["value"]>("sqft");
  const [blockId, setBlockId] = useState("");
  const [blockSearch, setBlockSearch] = useState("");
  const [blockFilter, setBlockFilter] = useState<BlockFilter>("all");
  const [zoneFilter, setZoneFilter] = useState("all");
  const [showMap, setShowMap] = useState(false);
  const [point, setPoint] = useState<[number, number] | null>(null);
  const [occupancyMode, setOccupancyMode] = useState<"single" | "mixed">("single");
  const [occupancyShares, setOccupancyShares] = useState<OccupancyShare[]>([]);
  const [zoneOverride, setZoneOverride] = useState("");
  const [incentiveIds, setIncentiveIds] = useState<string[]>([]);
  const [designValues, setDesignValues] = useState<Record<string, number>>({});
  const [hardLocks, setHardLocks] = useState<string[]>([]);
  const [manualFarEnabled, setManualFarEnabled] = useState(false);
  const [manualFar, setManualFar] = useState("");
  const [result, setResult] = useState<CalculationResult | null>(null);
  const [resultTab, setResultTab] = useState<ResultTab>("far");
  const [isCalculating, setIsCalculating] = useState(false);
  const [importToken, setImportToken] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const errorSummaryRef = useRef<HTMLDivElement>(null);
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);

  const selectedBlock = useMemo(
    () => dataset.blocks.find((block) => block.id === blockId),
    [blockId, dataset.blocks],
  );
  const zones = useMemo(
    () =>
      Array.from(
        new Set(
          dataset.blocks.flatMap((block) => [
            ...(block.zone ? [block.zone] : []),
            ...Object.keys(block.areaFarByZone ?? {}),
          ]),
        ),
      ).sort(),
    [dataset.blocks],
  );
  const filteredBlocks = useMemo(() => {
    const query = blockSearch.trim().toLocaleLowerCase();
    return dataset.blocks.filter((block) => {
      const matchesQuery =
        !query ||
        `${block.id} ${block.label} ${block.zone ?? ""}`
          .toLocaleLowerCase()
          .includes(query);
      const matchesZone =
        zoneFilter === "all" ||
        block.zone === zoneFilter ||
        block.areaFarByZone?.[zoneFilter] !== undefined;
      const typeCode = block.typeCode?.toLowerCase();
      const matchesKind =
        blockFilter === "all" ||
        (blockFilter === "planned" && typeCode === "p") ||
        (blockFilter === "spontaneous" && typeCode === "s");
      return matchesQuery && matchesZone && matchesKind;
    });
  }, [blockFilter, blockSearch, dataset.blocks, zoneFilter]);
  const areaPreviewSqft = areaToSqft(areaValue, areaUnit, dataset);
  const surrenderedPreviewSqft = areaToSqft(
    surrenderedValue,
    surrenderedUnit,
    dataset,
  );
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
    dataset.roadWidening?.requireSurrenderOnWidening &&
      proposedRoadWidthNumber > existingRoadWidthNumber,
  );
  const hasCalculationData =
    dataset.calculationMode !== null &&
    dataset.blocks.length > 0 &&
    dataset.roadFar.length > 0 &&
    dataset.occupancies.length > 0;
  const occupancySharesTotal = occupancyShares.reduce(
    (total, item) => total + item.sharePercent,
    0,
  );
  const coreDetailsComplete = [
    Boolean(blockId),
    Boolean(
      areaPreviewSqft &&
        areaPreviewSqft > 0 &&
        Number(existingRoadFt) > 0 &&
        (!proposedRoadRequired || proposedRoadWidthNumber > 0) &&
        (!surrenderedLandRequired ||
          (surrenderedPreviewSqft !== null && surrenderedPreviewSqft > 0)),
    ),
    Boolean(
      occupancyShares.length > 0 &&
        occupancyShares.every((item) => item.code && item.sharePercent > 0) &&
        Math.abs(occupancySharesTotal - 100) <= 0.01 &&
        (occupancyMode !== "mixed" || dataset.mixedOccupancyCapMethod),
    ),
  ].filter(Boolean).length;
  const occupancyCodes = occupancyShares.map((item) => item.code);
  const selectedUsesAreAllNonResidential =
    occupancyCodes.length > 0 &&
    occupancyCodes.every(
      (code) =>
        dataset.occupancies.find((occupancy) => occupancy.code === code)
          ?.farTreatment === "road-only",
    );
  const automaticIncentives = dataset.incentives.filter(
    (item) => item.automatic,
  );
  const selectableIncentives = dataset.incentives.filter(
    (item) => !item.automatic,
  );
  const farBonusInputIds = new Set(
    dataset.incentives.flatMap((item) =>
      item.calculation?.mode === "input" ? [item.calculation.inputId] : [],
    ),
  );
  const designInputs = dataset.designInputs.filter(
    (item) => !farBonusInputIds.has(item.id),
  );
  const incentiveInputs = designInputs.filter(
    (item) => item.section === "incentives",
  );
  const layoutInputs = designInputs.filter(
    (item) => item.section === "layout",
  );
  const parkingInputs = designInputs.filter(
    (item) => item.section === "parking",
  );

  useEffect(() => {
    let active = true;
    fetch("/api/rules")
      .then(async (response) => {
        const body = (await response.json()) as
          | { dataset: RuleDataset }
          | ApiError;
        if (!response.ok || !("dataset" in body)) {
          throw new Error(
            "error" in body
              ? body.error
              : "Could not load the active rule dataset.",
          );
        }
        if (active) setDataset(body.dataset);
      })
      .catch((error: unknown) => {
        if (active) {
          setLoadError(
            error instanceof Error
              ? error.message
              : "Could not connect to the rule database.",
          );
        }
      })
      .finally(() => {
        if (active) setIsLoadingRules(false);
      });
    return () => {
      active = false;
    };
  }, []);

  function setOccupancySelection(code: string) {
    setOccupancyShares(code ? [{ code, sharePercent: 100 }] : []);
    setResult(null);
  }

  function changeOccupancyMode(mode: "single" | "mixed") {
    setOccupancyMode(mode);
    if (mode === "single" && occupancyShares.length > 1) {
      setOccupancyShares([
        { code: occupancyShares[0].code, sharePercent: 100 },
      ]);
    } else if (mode === "single") {
      setOccupancyShares(
        occupancyShares[0]
          ? [{ code: occupancyShares[0].code, sharePercent: 100 }]
          : [],
      );
    } else if (occupancyShares.length === 1) {
      setOccupancyShares([
        { ...occupancyShares[0], sharePercent: 50 },
        { code: "", sharePercent: 50 },
      ]);
    } else if (occupancyShares.length === 0) {
      setOccupancyShares([
        { code: "", sharePercent: 50 },
        { code: "", sharePercent: 50 },
      ]);
    }
    setResult(null);
  }

  function updateOccupancy(index: number, code: string) {
    setOccupancyShares((current) =>
      current.map((item, currentIndex) =>
        currentIndex === index
          ? {
              ...item,
              code,
            }
          : item,
      ),
    );
    setResult(null);
  }

  function changeOccupancyShare(index: number, value: string) {
    const parsed = Number(value);
    if (value !== "" && !Number.isFinite(parsed)) return;
    setOccupancyShares((current) =>
      current.map((item, currentIndex) =>
        currentIndex === index
          ? { ...item, sharePercent: value === "" ? 0 : parsed }
          : item,
      ),
    );
    setResult(null);
  }

  function addOccupancy() {
    if (occupancyShares.length >= dataset.occupancies.length) return;
    setOccupancyShares((current) => {
      if (!current.length) return [{ code: "", sharePercent: 100 }];
      const newShare = current[0].sharePercent / 2;
      return [
        { ...current[0], sharePercent: current[0].sharePercent - newShare },
        ...current.slice(1),
        { code: "", sharePercent: newShare },
      ];
    });
    setResult(null);
  }

  function removeOccupancy(index: number) {
    setOccupancyShares((current) => {
      const removedShare = current[index]?.sharePercent ?? 0;
      const next = current.filter((_item, currentIndex) => currentIndex !== index);
      if (next.length) {
        next[0] = {
          ...next[0],
          sharePercent:
            next[0].sharePercent + (next.length === 1 ? 100 - next[0].sharePercent : removedShare),
        };
      }
      return next;
    });
    setResult(null);
  }

  function updateDesignValue(id: string, value: string) {
    const parsed = Number(value);
    setDesignValues((current) => {
      const next = { ...current };
      if (value === "" || !Number.isFinite(parsed)) {
        delete next[id];
      } else {
        next[id] = parsed;
      }
      return next;
    });
    setResult(null);
  }

  function toggleIncentive(id: string) {
    setIncentiveIds((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
    setResult(null);
  }

  async function calculate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");
    setFieldErrors({});
    setNotice("");
    setResult(null);

    const fail = (field: string, message: string) => {
      setFieldErrors({ [field]: message });
      setFormError(message);
      window.setTimeout(() => errorSummaryRef.current?.focus(), 0);
    };

    if (!blockId) {
      fail("block", "Select a DAP block for this assessment.");
      return;
    }
    if (!areaValue || !Number.isFinite(Number(areaValue)) || Number(areaValue) <= 0) {
      fail("plot-area", "Enter a plot area greater than zero.");
      return;
    }
    if (!existingRoadFt || Number(existingRoadFt) <= 0) {
      fail("existing-road-feet", "Enter the existing road width.");
      return;
    }
    if (proposedRoadRequired && proposedRoadWidthNumber <= 0) {
      fail("proposed-road-feet", "Enter the proposed road width required by the DAP.");
      return;
    }
    if (
      mandatoryWideningRequired &&
      !roadWideningNotPossible &&
      dataset.roadWidening &&
      proposedRoadWidthNumber < dataset.roadWidening.targetRoadWidthFt
    ) {
      fail(
        "proposed-road-feet",
        `This road must be widened to at least ${formatNumber(dataset.roadWidening.targetRoadWidthFt, 2)} ft.`,
      );
      return;
    }
    if (
      narrowRoadOutsideOldDhaka &&
      dataset.roadWidening &&
      proposedRoadWidthNumber < dataset.roadWidening.targetRoadWidthFt
    ) {
      fail(
        "proposed-road-feet",
        `Roads narrower than 2.5 m are only allowed for Old Dhaka blocks. Enter a proposed road width of at least ${formatNumber(dataset.roadWidening.targetRoadWidthFt, 2)} ft.`,
      );
      return;
    }
    if (
      proposedRoadWidthNumber > 0 &&
      proposedRoadWidthNumber < existingRoadWidthNumber
    ) {
      fail("proposed-road-feet", "The proposed road width cannot be narrower than the existing road.");
      return;
    }
    if (
      surrenderedLandRequired &&
      (surrenderedPreviewSqft === null || surrenderedPreviewSqft <= 0)
    ) {
      fail(
        "surrendered-area",
        "Enter the land area surrendered for road widening; floor area is based on the net plot.",
      );
      return;
    }
    if (
      areaUnit !== "sqft" &&
      areaUnit !== "sqm" &&
      !dataset.areaUnitSqft?.[areaUnit]
    ) {
      fail("plot-area", `The active dataset needs a square-foot conversion for ${areaUnit}.`);
      return;
    }
    if (
      surrenderedUnit !== "sqft" &&
      surrenderedUnit !== "sqm" &&
      Number(surrenderedValue) > 0 &&
      !dataset.areaUnitSqft?.[surrenderedUnit]
    ) {
      fail(
        "surrendered-area",
        `The active dataset needs a square-foot conversion for ${surrenderedUnit}.`,
      );
      return;
    }
    if (
      occupancyMode === "mixed" &&
      !dataset.mixedOccupancyCapMethod
    ) {
      fail(
        "occupancy",
        "Mixed occupancy is not enabled until its FAR cap method is present in the rule data.",
      );
      return;
    }
    if (
      dataset.plotAreaBasis === "net-after-surrender" &&
      Number(surrenderedValue || 0) > 0 &&
      surrenderedPreviewSqft === null
    ) {
      fail("surrendered-area", "Select an area unit supported by the active ruleset for surrendered land.");
      return;
    }
    if (
      occupancyShares.some((item) => !item.code) ||
      occupancyShares.some((item) => item.sharePercent <= 0) ||
      Math.abs(
        occupancyShares.reduce((total, item) => total + item.sharePercent, 0) -
          100,
      ) > 0.01
    ) {
      fail("occupancy", "Choose each occupancy and make the occupancy shares total 100%.");
      return;
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
          existingRoadWidthFt: Number(existingRoadFt),
          proposedRoadWidthFt: proposedRoadFt ? Number(proposedRoadFt) : null,
          roadWideningNotPossible,
          surrenderedArea: Number(surrenderedValue || 0),
          surrenderedAreaUnit: surrenderedUnit,
          occupancyMode,
          occupancyShares,
          zoneOverride: zoneOverride || null,
          incentiveIds,
          manualFarEnabled,
          manualFar: manualFarEnabled && manualFar ? Number(manualFar) : null,
          designValues: Object.fromEntries(
            dataset.designInputs.flatMap((item) => {
              const value = designValues[item.id] ?? item.defaultValue;
              return value === undefined ? [] : [[item.id, value]];
            }),
          ),
          lockedInputs: hardLocks,
        }),
      });
      const body = (await response.json()) as
        | { result: CalculationResult }
        | ApiError;
      if (!response.ok || !("result" in body)) {
        throw new Error(resultErrorMessage(body as ApiError));
      }
      setResult(body.result);
      setResultTab("far");
      window.setTimeout(
        () => {
          document.getElementById("results")?.scrollIntoView({
            behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
            block: "start",
          });
          if (window.matchMedia("(max-width: 760px)").matches) {
            resultHeadingRef.current?.focus();
          }
        },
        60,
      );
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : "The calculation service is unavailable.",
      );
    } finally {
      setIsCalculating(false);
    }
  }

  async function importDataset(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setFormError("");
    setNotice("");
    setIsImporting(true);
    try {
      if (file.size > 8 * 1024 * 1024) {
        throw new Error("The import file must be 8 MB or smaller.");
      }
      const response = await fetch("/api/rules/import", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(importToken ? { "x-data-import-token": importToken } : {}),
        },
        body: await file.text(),
      });
      const body = (await response.json()) as
        | { dataset: RuleDataset }
        | ApiError;
      if (!response.ok || !("dataset" in body)) {
        throw new Error(resultErrorMessage(body as ApiError));
      }
      setDataset(body.dataset);
      setBlockId("");
      setZoneOverride("");
      setRoadWideningNotPossible(false);
      setOccupancyShares([]);
      setIncentiveIds([]);
      setDesignValues({});
      setResult(null);
      setNotice(`Loaded "${body.dataset.name}" into the active rule database.`);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "The import failed.");
    } finally {
      setIsImporting(false);
      event.target.value = "";
    }
  }

  function setRoadWidthFromMeters(
    value: string,
    setter: (next: string) => void,
  ) {
    const parsed = Number(value);
    setter(
      value === "" || !Number.isFinite(parsed)
        ? ""
        : formatNumber(parsed * feetPerMeter, 3),
    );
    setResult(null);
  }

  function printReport() {
    if (result) window.print();
  }

  function toggleHardLock(id: string) {
    setHardLocks((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
    setResult(null);
  }

  const blockType = (block: RuleDataset["blocks"][number]) =>
    block.typeCode?.toLowerCase() === "p"
      ? "planned"
      : block.typeCode?.toLowerCase() === "s"
        ? "spontaneous"
        : "other";

  const siteCoverageReportFields: CalculationResult["reportFields"]["groundCoverage"] =
    result?.siteCoverage
      ? [
          ...(result.siteCoverage.minGroundCoveragePercent === null
            ? []
            : [
                {
                  id: "site-coverage-minimum",
                  label: "Minimum ground coverage",
                  value: result.siteCoverage.minGroundCoveragePercent,
                  unit: "%",
                  precision: 2,
                },
              ]),
          {
            id: "site-coverage-maximum",
            label: "Maximum ground coverage",
            value: result.siteCoverage.maxGroundCoveragePercent,
            unit: "%",
            precision: 2,
          },
          {
            id: "site-coverage-area",
            label: "Maximum ground coverage area",
            value: result.siteCoverage.groundCoverageSqft,
            unit: "sq ft",
            precision: 0,
          },
          {
            id: "site-coverage-exceptions",
            label: "Maximum coverage including exceptions",
            value: result.siteCoverage.maxGroundCoverageWithExceptionsPercent,
            unit: "%",
            precision: 2,
          },
          {
            id: "site-open-space",
            label: "Mandatory open space",
            value: result.siteCoverage.mandatoryOpenSpacePercent,
            unit: "%",
            precision: 2,
          },
          {
            id: "site-open-space-area",
            label: "Mandatory open space area",
            value: result.siteCoverage.mandatoryOpenSpaceSqft,
            unit: "sq ft",
            precision: 0,
          },
          {
            id: "site-rainwater",
            label: "Rainwater absorption requirement",
            value: result.siteCoverage.rainwaterAbsorptionPercent,
            unit: "%",
            precision: 2,
          },
          {
            id: "site-rainwater-area",
            label: "Rainwater absorption area",
            value: result.siteCoverage.rainwaterAbsorptionSqft,
            unit: "sq ft",
            precision: 0,
          },
        ]
      : [];
  const resultRows = result
    ? resultSections[resultTab].map((section) => ({
        section,
        fields: [
          ...result.reportFields[section],
          ...(section === "groundCoverage" ? siteCoverageReportFields : []),
        ],
      }))
    : [];
  const mixedModeUnavailable =
    occupancyMode === "mixed" && !dataset.mixedOccupancyCapMethod;

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="skip-link" href="#calculator">Skip to calculator</a>
        <Link className="brand" href="/" aria-label="FAR Calculator home">
          <span className="brand-mark">F</span>
          <span>
            <strong>FAR Calculator</strong>
            <small>Plot assessment workspace</small>
          </span>
        </Link>
        <nav className="top-nav" aria-label="Main navigation">
          <a className="nav-active" href="#calculator">Calculator</a>
          <a href="#results">Results</a>
          <a href="#data">Rule data</a>
          <a href="#references">References</a>
        </nav>
        <a
          className="reference-cta"
          href="/reference/rajuk-far-calculator.html"
          rel="noreferrer"
          target="_blank"
        >
          <ExternalLink size={14} />
          View reference calculator
        </a>
        <div className="top-status" aria-live="polite">
          <span className={`status-dot ${hasCalculationData ? "ready" : ""}`} />
          {hasCalculationData ? "Rules loaded" : "Awaiting rules"}
        </div>
      </header>

      <section className="hero-strip">
        <div>
          <div className="eyebrow"><span /> PLOT FEASIBILITY / BANGLADESH</div>
          <h1>A clearer path from plot to plan.</h1>
          <p>
            Add your site details, then review FAR, building layout, parking and
            design constraints in one organized assessment.
          </p>
        </div>
        <div className="hero-note">
          <ShieldCheck size={17} />
          <span>Planning aid only - not an approval or permit.</span>
        </div>
      </section>

      <form className="calculator-layout" id="calculator" onSubmit={calculate} noValidate>
        <div className="input-column">
          <div className="progress-card">
            <div className="progress-copy">
              <span className="progress-step">SITE INPUTS</span>
              <strong>Build your assessment</strong>
              <small>Five sections. Start with the three required site details.</small>
            </div>
            <div className="progress-track" aria-hidden="true">
                <span style={{ width: result ? "100%" : `${(coreDetailsComplete / 3) * 100}%` }} />
            </div>
            <span className={`progress-state ${result ? "done" : ""}`}>
                {result ? "Assessment ready" : `${coreDetailsComplete} of 3 core details`}
            </span>
          </div>

          <section className="panel input-panel">
            <div className="step-heading">
              <span className="step-number">01</span>
              <div><h2>Choose your location</h2><p>Select the DAP block for the plot.</p></div>
            </div>
            <div className="search-field">
              <Search size={16} />
              <input
                aria-label="Search blocks"
                placeholder="Search block or area"
                value={blockSearch}
                onChange={(event) => setBlockSearch(event.target.value)}
              />
              {blockSearch && (
                <button
                  aria-label="Clear block search"
                  onClick={() => setBlockSearch("")}
                  type="button"
                >×</button>
              )}
            </div>
            <div className="block-tools">
              <div className="filter-pills" aria-label="Block type filters">
                {([
                  ["all", "All"],
                  ["planned", "Planned"],
                  ["spontaneous", "Spontaneous"],
                ] as const).map(([id, label]) => (
                  <button
                    className={blockFilter === id ? "selected" : ""}
                    key={id}
                    onClick={() => setBlockFilter(id)}
                    type="button"
                  >{label}</button>
                ))}
              </div>
              <label className="compact-select">
                <span className="visually-hidden">Filter by zone</span>
                <select
                  aria-label="Filter by zone"
                  value={zoneFilter}
                  onChange={(event) => setZoneFilter(event.target.value)}
                >
                  <option value="all">All zones</option>
                  {zones.map((zone) => <option key={zone} value={zone}>{zone}</option>)}
                </select>
                <ChevronDown size={14} />
              </label>
            </div>
            <div className="block-list" id="block">
              {filteredBlocks.length ? filteredBlocks.slice(0, 8).map((block) => (
                <button
                  aria-pressed={blockId === block.id}
                  className={`block-option ${blockId === block.id ? "active" : ""}`}
                  disabled={block.buildable === false || block.areaFar <= 0}
                  key={block.id}
                  onClick={() => {
                    setBlockId(block.id);
                    setZoneOverride("");
                    setRoadWideningNotPossible(false);
                    setResult(null);
                  }}
                  type="button"
                >
                  <span className="block-copy">
                    <span className="block-title">
                      <strong>{block.id}</strong>
                      <span>{block.label}</span>
                      {block.typeCode && (
                        <i className={`type-tag type-${blockType(block)}`}>
                          {block.typeCode}
                        </i>
                      )}
                    </span>
                    <small>
                      {block.buildable === false
                        ? "Reserved / restricted — no development FAR"
                        : block.zone ?? "DAP block"}
                    </small>
                  </span>
                  <span className="block-value">
                    <small>Area FAR</small>
                    <b>{formatNumber(block.areaFar)}</b>
                    {block.densityPerAcre !== undefined && (
                      <small>{formatNumber(block.densityPerAcre, 0)} / acre</small>
                    )}
                  </span>
                  {blockId === block.id && <Check className="block-selected" size={17} />}
                </button>
              )) : (
                <div className="empty-list">
                  {dataset.blocks.length
                    ? "No blocks match those filters."
                    : "Import a ruleset with DAP blocks to get started."}
                </div>
              )}
            </div>
            {dataset.blocks.length > 8 && (
              <small className="list-hint">
                Showing up to 8 matching blocks. Refine the search to find others.
              </small>
            )}
            <details className="map-details" open={showMap} onToggle={(event) => setShowMap(event.currentTarget.open)}>
              <summary><MapPin size={15} /> Pick from map <ChevronDown size={14} /></summary>
              <div className="map-wrap">
                {showMap && (
                  <LocationMap
                    dataset={dataset}
                    selectedBlockId={blockId}
                    point={point}
                    onSelectBlock={(id) => {
                      setBlockId(id);
                      setZoneOverride("");
                      setRoadWideningNotPossible(false);
                      setResult(null);
                    }}
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
              <p className="field-hint">
                A map point does not select zoning unless matching boundaries are included in the dataset.
              </p>
            </details>
          </section>

          <section className="panel input-panel">
            <div className="step-heading">
              <span className="step-number">02</span>
              <div><h2>Plot &amp; road dimensions</h2><p>Enter measured dimensions and any proposed road widening.</p></div>
            </div>
            <div className="land-area-header">
              <label htmlFor="plot-area">Plot land area</label>
              <span>
                {areaPreviewSqft === null
                  ? areaUnit !== "sqft" && areaValue
                    ? "Conversion needed in rules"
                    : "Enter plot size"
                  : `≈ ${formatNumber(areaPreviewSqft, 0)} sq ft`}
              </span>
            </div>
            <div className="area-control">
              <input
                id="plot-area"
                aria-describedby={fieldErrors["plot-area"] ? "error-plot-area" : undefined}
                aria-invalid={Boolean(fieldErrors["plot-area"])}
                inputMode="decimal"
                min="0"
                placeholder="e.g. 5"
                type="number"
                value={areaValue}
                onChange={(event) => {
                  setAreaValue(event.target.value);
                  setResult(null);
                }}
              />
              <label className="area-unit-select">
                <span className="visually-hidden">Plot area unit</span>
                <select
                  aria-label="Plot area unit"
                  value={areaUnit}
                  onChange={(event) => {
                    setAreaUnit(event.target.value as typeof areaUnit);
                    setResult(null);
                  }}
                >
                  {areaUnits.map((unit) => (
                    <option key={unit.value} value={unit.value}>{unit.label}</option>
                  ))}
                </select>
                <ChevronDown size={15} />
              </label>
            </div>
            <div className="dimension-grid">
              <RoadWidthField
                id="existing-road"
                label="Widest adjoining road width"
                invalid={Boolean(fieldErrors["existing-road-feet"])}
                valueFt={existingRoadFt}
                onFeetChange={(value) => {
                  setExistingRoadFt(value);
                  setRoadWideningNotPossible(false);
                  setResult(null);
                }}
                onMetersChange={(value) =>
                  setRoadWidthFromMeters(value, (next) => {
                    setExistingRoadFt(next);
                    setRoadWideningNotPossible(false);
                  })
                }
              />
              <RoadWidthField
                id="proposed-road"
                label="DAP proposed road width"
                invalid={Boolean(fieldErrors["proposed-road-feet"])}
                valueFt={proposedRoadFt}
                onFeetChange={(value) => { setProposedRoadFt(value); setResult(null); }}
                onMetersChange={(value) => setRoadWidthFromMeters(value, setProposedRoadFt)}
                optional={!proposedRoadRequired}
              />
            </div>
            <p className="field-hint">
              If the plot adjoins multiple roads, use the widest one for FAR (Rule 47(10)).
            </p>
            {mandatoryWideningRequired && dataset.roadWidening && (
              <>
                <p className="field-hint">
                  DAP Rule 47 requires this road to widen to at least {formatNumber(dataset.roadWidening.targetRoadWidthFt, 2)} ft. Enter the proposed width and the land surrendered for widening, or use the exception below if widening is impossible.
                </p>
                <label className="toggle-line road-exception-toggle">
                  <input
                    checked={roadWideningNotPossible}
                    onChange={(event) => {
                      const notPossible = event.target.checked;
                      setRoadWideningNotPossible(notPossible);
                      if (notPossible) {
                        setProposedRoadFt("");
                        setSurrenderedValue("0");
                      }
                      setResult(null);
                    }}
                    type="checkbox"
                  />
                  <span className="custom-check"><Check size={12} /></span>
                  <span><strong>Widening is impossible under the Rule 47(7) exception</strong><small>Use the existing road width for FAR. Confirm the exception applies to this road.</small></span>
                </label>
              </>
            )}
            {narrowRoadOutsideOldDhaka && dataset.roadWidening && (
              <p className="field-hint">
                DAP Rule 47 allows roads narrower than 2.5 m only in Old Dhaka. Enter a proposed width of at least {formatNumber(dataset.roadWidening.targetRoadWidthFt, 2)} ft and the surrendered land area.
              </p>
            )}
            <div className="surrender-row">
              <div>
                <label htmlFor="surrendered-area">Land surrendered for road widening</label>
                <small>Only applies when the active ruleset supports it.</small>
              </div>
              <div className="surrender-control">
                <input
                  id="surrendered-area"
                  aria-describedby={fieldErrors["surrendered-area"] ? "error-surrendered-area" : undefined}
                  aria-invalid={Boolean(fieldErrors["surrendered-area"])}
                  min="0"
                  type="number"
                  value={surrenderedValue}
                  onChange={(event) => {
                    setSurrenderedValue(event.target.value);
                    setResult(null);
                  }}
                />
                <select
                  aria-label="Surrendered area unit"
                  value={surrenderedUnit}
                  onChange={(event) => setSurrenderedUnit(event.target.value as typeof surrenderedUnit)}
                >
                  {areaUnits.map((unit) => (
                    <option key={unit.value} value={unit.value}>{areaLabel[unit.value]}</option>
                  ))}
                </select>
              </div>
              {surrenderedPreviewSqft !== null && (
                <small className="surrender-equivalent">{formatNumber(surrenderedPreviewSqft, 0)} sq ft</small>
              )}
            </div>
          </section>

          <section className="panel input-panel">
            <div className="step-heading">
              <span className="step-number">03</span>
              <div><h2>Building occupancy</h2><p>Choose building use and planning-zone treatment.</p></div>
              <Building2 className="heading-icon" size={19} />
            </div>
            <div className="mode-toggle" role="group" aria-label="Occupancy mode">
              <button
                aria-pressed={occupancyMode === "single"}
                className={occupancyMode === "single" ? "selected" : ""}
                onClick={() => changeOccupancyMode("single")}
                type="button"
              >Single occupancy</button>
              <button
                aria-pressed={occupancyMode === "mixed"}
                className={occupancyMode === "mixed" ? "selected" : ""}
                onClick={() => changeOccupancyMode("mixed")}
                type="button"
              >Mixed occupancy</button>
            </div>
            {mixedModeUnavailable && (
              <p className="inline-notice">
                Mixed occupancy will be available when its cap rule is included in the dataset.
              </p>
            )}
            {occupancyMode === "single" ? (
              <div className="field" id="occupancy">
                <label htmlFor="occupancy">Building purpose / occupancy type</label>
                <Select
                  id="occupancy"
                  value={occupancyShares[0]?.code ?? ""}
                  disabled={!dataset.occupancies.length}
                  onChange={setOccupancySelection}
                  placeholder={dataset.occupancies.length ? "Choose an occupancy" : "Occupancy data not loaded"}
                  options={dataset.occupancies.map((occupancy) => ({
                    value: occupancy.code,
                    label: `${occupancy.code} - ${occupancy.label}`,
                  }))}
                />
                {occupancyShares[0] && (
                  <div className="occupancy-summary">
                    <span className="code-pill">{occupancyShares[0].code}</span>
                    <strong>
                      {dataset.occupancies.find((item) => item.code === occupancyShares[0].code)?.label}
                    </strong>
                    <span className="occupancy-group">
                      {dataset.occupancies.find((item) => item.code === occupancyShares[0].code)?.group ?? "Building use"}
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <div className="mixed-fields">
                {occupancyShares.map((share, index) => (
                  <div className="mixed-line" key={`occupancy-${index}`}>
                    <div className="field">
                      <label htmlFor={`mixed-occupancy-${index}`}>
                        {index === 0 ? "Primary use" : `Additional use ${index}`}
                      </label>
                      <Select
                        id={`mixed-occupancy-${index}`}
                        value={share.code}
                        onChange={(code) => updateOccupancy(index, code)}
                        options={dataset.occupancies
                          .filter((item) =>
                            !occupancyCodes.includes(item.code) ||
                            item.code === share.code,
                          )
                          .map((item) => ({
                            value: item.code,
                            label: `${item.code} - ${item.label}`,
                          }))}
                      />
                    </div>
                    <div className="share-field">
                      <label htmlFor={`occupancy-share-${index}`}>Share</label>
                      <div className="input-with-unit">
                        <input
                          id={`occupancy-share-${index}`}
                          max="100"
                          min="0.01"
                          step="0.01"
                          onChange={(event) =>
                            changeOccupancyShare(index, event.target.value)
                          }
                          type="number"
                          value={share.sharePercent}
                        />
                        <span>%</span>
                      </div>
                    </div>
                    {occupancyShares.length > 2 && (
                      <button
                        aria-label={`Remove occupancy ${index + 1}`}
                        className="remove-occupancy"
                        onClick={() => removeOccupancy(index)}
                        type="button"
                      >×</button>
                    )}
                  </div>
                ))}
                {occupancyShares.length < dataset.occupancies.length && (
                  <button className="add-occupancy" onClick={addOccupancy} type="button">
                    + Add another building use
                  </button>
                )}
              </div>
            )}
            {dataset.calculationMode !== "dap-2025" && (
              <div className="zone-override">
                <div className="zone-heading">
                  <div><Layers3 size={15} /><strong>DAP planning zone</strong></div>
                  <span>{zoneOverride || `Auto${selectedBlock?.zone ? `: ${selectedBlock.zone}` : ""}`}</span>
                </div>
                <label className="field-label" htmlFor="zone-override">Override zone (optional)</label>
                <Select
                  id="zone-override"
                  value={zoneOverride}
                  onChange={(value) => { setZoneOverride(value); setResult(null); }}
                  placeholder="Auto (from selected block)"
                  options={Array.from(new Set([
                    ...zones,
                    ...Object.keys(selectedBlock?.areaFarByZone ?? {}),
                  ])).map((zone) => ({ value: zone, label: zone }))}
                />
                {zoneOverride &&
                  selectedBlock?.areaFarByZone?.[zoneOverride] === undefined && (
                  <small className="field-hint">The selected block must include an Area FAR for this override.</small>
                )}
              </div>
            )}
          </section>

          <section className="panel input-panel">
            <div className="step-heading">
              <span className="step-number">04</span>
              <div><h2>FAR incentives</h2><p>Automatic provisions and eligible project choices from your dataset.</p></div>
              <BadgeCheck className="heading-icon" size={19} />
            </div>
            {automaticIncentives.length > 0 && (
              <div className="auto-incentives">
                <div className="auto-heading">
                  <strong>Calculated from your plot</strong>
                  <span>Automatic</span>
                </div>
                {automaticIncentives.map((item) => (
                  <div className="auto-incentive" key={item.id}>
                    <div><strong>{item.label}</strong><small>{item.group ?? "Auto from plot and road details"}</small></div>
                    <span>{item.calculation?.mode === "road-width" ? "Road width" : item.calculation?.mode === "plot-area-tier" ? "Plot size" : item.calculation?.mode === "distance-tier" ? "Distance" : "Auto"}</span>
                  </div>
                ))}
              </div>
            )}
            {selectableIncentives.length > 0 ? (
              <div className="incentive-choices">
                {selectableIncentives.map((item) => (
                  <label className="incentive-choice" key={item.id}>
                    <input
                      checked={incentiveIds.includes(item.id)}
                      onChange={() => toggleIncentive(item.id)}
                      type="checkbox"
                    />
                    <span className="custom-check"><Check size={12} /></span>
                    <span className="incentive-copy">
                      <strong>{item.label}</strong>
                      {item.group && <small>{item.group}</small>}
                    </span>
                    <span className="bonus-tag">
                      {item.calculation?.mode === "input"
                        ? "Enter FAR"
                        : item.farBonus !== undefined
                          ? `+${formatNumber(item.farBonus)}`
                          : "Rule-based"}
                    </span>
                  </label>
                ))}
              </div>
            ) : automaticIncentives.length === 0 ? (
              <div className="empty-incentives">No incentive rules have been added to the active dataset.</div>
            ) : null}
            {incentiveInputs.length > 0 && (
              <div className="inline-inputs">
                {incentiveInputs.map((item) => (
                  <DesignInput
                    key={item.id}
                    item={item}
                    value={designValues[item.id]}
                    locked={hardLocks.includes(item.id)}
                    onValueChange={(value) => updateDesignValue(item.id, value)}
                    onLockChange={() => toggleHardLock(item.id)}
                  />
                ))}
              </div>
            )}
          </section>

          <section className="panel input-panel">
            <div className="step-heading">
              <span className="step-number">05</span>
              <div><h2>Building &amp; parking inputs</h2><p>Optional inputs used by the detailed design rules.</p></div>
              <Building2 className="heading-icon" size={19} />
            </div>
            {(layoutInputs.length > 0 || parkingInputs.length > 0) ? (
              <>
                {layoutInputs.length > 0 && (
                  <div className="design-input-grid">
                    {layoutInputs.map((item) => (
                      <DesignInput
                        key={item.id}
                        item={item}
                        value={designValues[item.id]}
                        locked={hardLocks.includes(item.id)}
                        onValueChange={(value) => updateDesignValue(item.id, value)}
                        onLockChange={() => toggleHardLock(item.id)}
                      />
                    ))}
                  </div>
                )}
                {parkingInputs.length > 0 && (
                  <div className="design-input-grid">
                    {parkingInputs.map((item) => (
                      <DesignInput
                        key={item.id}
                        item={item}
                        value={designValues[item.id]}
                        locked={hardLocks.includes(item.id)}
                        onValueChange={(value) => updateDesignValue(item.id, value)}
                        onLockChange={() => toggleHardLock(item.id)}
                      />
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="not-configured">
                Layout, unit mix, basement, and parking fields will appear here when included in the dataset.
              </div>
            )}
            <div className="manual-override">
              <label className="toggle-line">
                <input
                  checked={manualFarEnabled}
                  onChange={(event) => {
                    setManualFarEnabled(event.target.checked);
                    setResult(null);
                  }}
                  type="checkbox"
                />
                <span className="custom-check"><Check size={12} /></span>
                <span><strong>Use manual FAR override</strong><small>Limited to the computed FAR, including applicable incentives and DAP exceptions.</small></span>
              </label>
              {manualFarEnabled && (
                <div className="manual-far-field">
                  <label htmlFor="manual-far">Manual FAR</label>
                  <input
                    id="manual-far"
                    min="0"
                    step="0.01"
                    onChange={(event) => { setManualFar(event.target.value); setResult(null); }}
                    placeholder="Enter FAR"
                    type="number"
                    value={manualFar}
                  />
                  <small>{selectedBlock ? "The applied FAR is checked against the selected DAP and occupancy rules." : "Select a block and occupancy first."}</small>
                </div>
              )}
            </div>
          </section>

          {(formError || notice || loadError) && (
            <div
              ref={errorSummaryRef}
              className={`alert ${formError || loadError ? "alert-error" : "alert-success"}`}
              role={formError || loadError ? "alert" : "status"}
              aria-live="polite"
              tabIndex={formError || loadError ? -1 : undefined}
            >
              {Object.entries(fieldErrors).length > 0 && (
                <ul className="error-summary">
                  {Object.entries(fieldErrors).map(([field, message]) => (
                    <li key={field}>
                      <a href={`#${field}`}>{message}</a>
                      <span className="visually-hidden" id={`error-${field}`}>{message}</span>
                    </li>
                  ))}
                </ul>
              )}
              {formError || loadError || notice}
            </div>
          )}
          <button
            className="button-primary calculate-button"
            disabled={isCalculating || isLoadingRules}
            type="submit"
          >
            {isCalculating ? "Calculating..." : "Calculate my plot"}
            <ArrowRight size={17} />
          </button>
          {!hasCalculationData && (
            <p className="calculate-hint">
              {isLoadingRules ? "Connecting to your rule database..." : "Import your verified rules to enable calculations."}
            </p>
          )}

          <section className="panel data-panel" id="data">
            <div className="data-panel-title">
              <Database size={16} />
              <div><strong>Rules &amp; sources</strong><small>{dataset.name} / {dataset.blocks.length} blocks</small></div>
              <span className={`dataset-state ${hasCalculationData ? "state-ready" : ""}`}>{hasCalculationData ? "Ready" : "Needs data"}</span>
            </div>
            <details className="import-details">
              <summary><span><FileUp size={16} /> Import or replace rules</span><ChevronDown size={15} /></summary>
              <div className="import-content">
                <p>Imports are validated and saved as versioned data. The latest valid dataset becomes active.</p>
                <label className="field-label" htmlFor="import-token">Import access token <span>(hosted deployment)</span></label>
                <input
                  autoComplete="off"
                  className="token-input"
                  id="import-token"
                  onChange={(event) => setImportToken(event.target.value)}
                  placeholder="Configured by the administrator"
                  type="password"
                  value={importToken}
                />
                <input
                  ref={fileInput}
                  accept=".json,application/json"
                  className="visually-hidden"
                  onChange={importDataset}
                  type="file"
                />
                <button className="button-secondary" disabled={isImporting} onClick={() => fileInput.current?.click()} type="button">
                  <Upload size={15} /> {isImporting ? "Validating..." : "Choose JSON ruleset"}
                </button>
                <a className="template-link" download href="/templates/ruleset.template.json">
                  <ArrowDownToLine size={14} /> Download the ruleset template
                </a>
              </div>
            </details>
            {dataset.sources.length > 0 && (
              <div className="source-list">
                <strong>References</strong>
                {dataset.sources.map((source) => <span key={source}>{source}</span>)}
              </div>
            )}
            {dataset.notes.length > 0 && (
              <div className="source-list rule-notes">
                <strong>How the DAP rules are applied</strong>
                {dataset.notes.map((note) => <span key={note}>{note}</span>)}
              </div>
            )}
            <div className="reference-links" id="references">
              <strong>View the supplied reference pages</strong>
              <a href="/reference/rajuk-far-calculator.html" rel="noreferrer" target="_blank">
                Saved RAJUK Building Construction &amp; Dhaka FAR Calculator
              </a>
              <a href="/reference/dhaka-building-rules-2025.html" rel="noreferrer" target="_blank">
                Dhaka Metropolitan Building Construction Rules, 2025 reference tool
              </a>
              <a download href="/rulesets/dhaka-metropolitan-building-construction-rules-2025.json">
                Download this DAP 2025 ruleset
              </a>
            </div>
          </section>
        </div>

        <aside className="result-column" id="results">
          <section className={`result-card ${result ? "has-result" : ""}`} aria-live="polite">
            <div className="result-topline">
              <span><BadgeCheck size={15} /> PLOT ASSESSMENT</span>
              <span className="result-chip">{result ? "Calculated" : "Ready when you are"}</span>
            </div>
            <h2 ref={resultHeadingRef} id="results-heading" tabIndex={-1}>{result ? result.blockLabel : "Your result, clearly summarized."}</h2>
            <p className="result-description">
              {result
                ? result.occupancyLabels.join(" / ")
                : "Complete the site inputs, then calculate to see your FAR and planning outputs."}
            </p>
            <div className="far-display">
              <span>Applied FAR</span>
              <strong>{result ? formatNumber(result.appliedFar) : "--"}</strong>
              <small>{result ? `Calculated FAR ${formatNumber(result.calculatedFar)}` : "Based on the active ruleset"}</small>
            </div>
            <div className="result-lines">
              <div><span>Area FAR</span><b>{result ? formatNumber(result.areaFar) : "--"}</b></div>
              <div><span>Plot FAR</span><b>{result ? formatNumber(result.roadFar) : "--"}</b></div>
              <div><span>Base FAR</span><b>{result ? formatNumber(result.baseFar) : "--"}</b></div>
              <div><span>Total bonus</span><b>{result ? `+${formatNumber(result.totalBonusFar)}` : "--"}</b></div>
            </div>
            <div className="floor-area-box">
              <span>Total FAR-included area</span>
              <strong>{result ? `${formatNumber(result.floorAreaSqft, 0)} sq ft` : "--"}</strong>
              {result && result.netPlotAreaSqft !== result.plotAreaSqft && (
                <small>Net plot area: {formatNumber(result.netPlotAreaSqft, 0)} sq ft</small>
              )}
            </div>
            {result && (
              <>
                <button className="button-report" onClick={printReport} type="button">
                  <Printer size={15} /> Print / Save as PDF
                </button>
                <div className="result-disclaimer"><CircleHelp size={14} /><span>Informational estimate only. Confirm all constraints with RAJUK.</span></div>
              </>
            )}
          </section>

          {result && (
            <section className="panel detail-results">
              <div className="results-heading">
                <div><span>DETAILED OUTPUT</span><h2>Project summary</h2></div>
                <span className="result-dataset">{dataset.name}</span>
              </div>
              <div className="result-tabs" role="tablist" aria-label="Assessment result sections">
                {([
                  ["far", "FAR & site"],
                  ["design", "Building"],
                  ["parking", "Parking & safety"],
                ] as const).map(([id, label]) => (
                  <button
                    id={`result-tab-${id}`}
                    aria-selected={resultTab === id}
                    tabIndex={resultTab === id ? 0 : -1}
                    className={resultTab === id ? "selected" : ""}
                    key={id}
                    onClick={() => setResultTab(id)}
                    onKeyDown={(event) => {
                      const tabs: ResultTab[] = ["far", "design", "parking"];
                      const index = tabs.indexOf(id);
                      const nextIndex =
                        event.key === "ArrowRight" ? (index + 1) % tabs.length :
                        event.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length :
                        event.key === "Home" ? 0 :
                        event.key === "End" ? tabs.length - 1 : -1;
                      if (nextIndex >= 0) {
                        event.preventDefault();
                        setResultTab(tabs[nextIndex]);
                        document.getElementById(`result-tab-${tabs[nextIndex]}`)?.focus();
                      }
                    }}
                    role="tab"
                    type="button"
                  >{label}</button>
                ))}
              </div>
              {resultTab === "far" && (
                <div className="core-result-grid" id="result-panel-far" role="tabpanel" aria-labelledby="result-tab-far">
                  <Metric label="Base FAR" value={formatNumber(result.baseFar)} />
                  <Metric
                    label="Maximum FAR cap"
                    value={result.maxFarCap === null
                      ? result.uncappedFarEligible
                        ? "Table 5 uncapped option eligible"
                        : "Not defined"
                      : formatNumber(result.maxFarCap)}
                  />
                  <Metric label="DAP Area FAR" value={formatNumber(result.areaFar)} />
                  <Metric label="Road FAR" value={formatNumber(result.roadFar)} />
                  <Metric label="Existing road FAR" value={formatNumber(result.existingRoadFar)} />
                  <Metric label="Proposed road FAR" value={result.proposedRoadFar === null ? "Not entered" : formatNumber(result.proposedRoadFar)} />
                  {result.roadWideningExceptionUsed && (
                    <Metric label="Road widening" value="Rule 47(7) exception applied; confirmation required" />
                  )}
                  <Metric label="Plot area" value={`${formatNumber(result.plotAreaSqft, 0)} sq ft`} />
                  <Metric label="Surrendered land" value={`${formatNumber(result.surrenderedAreaSqft, 0)} sq ft`} />
                  <Metric label="Maximum floor area" value={`${formatNumber(result.floorAreaSqft, 0)} sq ft`} />
                  {result.uncappedFarEligible && (
                    <Metric label="Table 5 condition" value="Uncapped FAR option eligible; manual FAR still requires authority confirmation" />
                  )}
                  {result.maxFarCap !== null && result.appliedFar > result.maxFarCap && (
                    <Metric label="Rule 47(3) exception" value={`Applied ${formatNumber(result.appliedFar - result.maxFarCap)} FAR above the ordinary maximum`} />
                  )}
                  {result.manualFar !== null && <Metric label="Manual override" value={formatNumber(result.manualFar)} />}
                  {result.automaticBonuses.map((item) => <Metric key={item.label} label={item.label} value={`+${formatNumber(item.farBonus)}`} />)}
                  {result.selectedBonuses.map((item) => <Metric key={item.label} label={item.label} value={`+${formatNumber(item.farBonus)}`} />)}
                </div>
              )}
              {resultRows.map(({ section, fields }) => (
                <ReportSectionCard
                  key={section}
                  label={resultSectionLabels[section]}
                  fields={fields}
                  isConfigured={fields.length > 0}
                />
              ))}
              {resultTab !== "far" && resultRows.every((row) => row.fields.length === 0) && (
                <div className="not-configured result-empty">
                  {resultTab === "design"
                    ? "Building layout rules are not included yet. Add floor, unit, circulation, and size formulas to the dataset."
                    : "Parking, basement, stair, and lift rules are not included yet. Add the source values to the dataset."}
                </div>
              )}
              {resultTab === "far" && (
                <div className="method-note">
                  <ShieldCheck size={15} />
                  <span>
                    {dataset.calculationMode === "dap-2025"
                      ? selectedUsesAreAllNonResidential
                        ? "DAP Rule 47(4): FAR for 100% non-residential use is determined from the occupancy-specific Road FAR schedule."
                        : "DAP Rule 47: Base FAR is the lower of Area FAR and Road FAR; Maximum FAR is the higher. Incentives raise the base up to that maximum. A gap of 0.1 or less is applied without incentives."
                      : "Base FAR, incentives, and any cap follow the active dataset."}
                    {result.surrenderedAreaSqft > 0
                      ? " DAP Article 3.6.4.2 converts three times the surrendered land area to additional floor area using the applied FAR."
                      : ""}
                    {result.maxFarCap !== null && result.appliedFar > result.maxFarCap
                      ? " Rule 47(3) exceptional FAR above the ordinary maximum is included for an eligible project."
                      : ""}
                    {result.zone ? ` Zone: ${result.zone}.` : ""}
                  </span>
                </div>
              )}
              <div className="source-list result-sources">
                <strong>Rule references</strong>
                {result.sources.length
                  ? result.sources.map((source) => <span key={source}>{source}</span>)
                  : <span>No source reference was supplied with this ruleset.</span>}
              </div>
            </section>
          )}

          {!result && (
            <section className="side-help">
              <div className="help-icon"><ShieldCheck size={17} /></div>
              <div><strong>Results stay honest</strong><p>Missing rule sections are labeled, not guessed.</p></div>
            </section>
          )}
        </aside>
      </form>

      <div className="mobile-action-bar" aria-live="polite">
        <div>
          <strong>{result ? `Applied FAR ${formatNumber(result.appliedFar)}` : `${coreDetailsComplete} of 3 core details`}</strong>
          {result && <span>{formatNumber(result.floorAreaSqft, 0)} sq ft</span>}
        </div>
        <button className="button-primary" disabled={isCalculating || isLoadingRules} form="calculator" type="submit">
          {isCalculating ? "Calculating..." : "Calculate"}
        </button>
      </div>

      {result && (
        <section className="print-report" aria-hidden="true">
          <div className="print-brand">FAR CALCULATOR / BANGLADESH</div>
          <h1>Plot assessment</h1>
          <p>Generated {new Date().toLocaleString()} / Informational, not an approval</p>
          <table>
            <tbody>
              <tr><th>DAP block</th><td>{result.blockLabel}</td></tr>
              <tr><th>Planning zone</th><td>{result.zone ?? "Automatic"}</td></tr>
              <tr><th>Building occupancy</th><td>{result.occupancyLabels.join(", ")}</td></tr>
              <tr><th>Plot area</th><td>{formatNumber(result.plotAreaSqft, 0)} sq ft</td></tr>
              <tr><th>Area FAR</th><td>{formatNumber(result.areaFar)}</td></tr>
              <tr><th>Existing / proposed road FAR</th><td>{formatNumber(result.existingRoadFar)} / {result.proposedRoadFar === null ? "Not entered" : formatNumber(result.proposedRoadFar)}</td></tr>
              {result.roadWideningExceptionUsed && <tr><th>Road widening</th><td>Rule 47(7) exception applied; confirmation required</td></tr>}
              <tr><th>Base FAR</th><td>{formatNumber(result.baseFar)}</td></tr>
              <tr><th>Bonus FAR</th><td>{formatNumber(result.totalBonusFar)}</td></tr>
              <tr><th>Calculated / applied FAR</th><td>{formatNumber(result.calculatedFar)} / {formatNumber(result.appliedFar)}</td></tr>
              <tr><th>Total FAR-included floor area</th><td>{formatNumber(result.floorAreaSqft, 0)} sq ft</td></tr>
            </tbody>
          </table>
          {Object.entries(result.reportFields).map(([section, fields]) => fields.length ? (
            <section key={section}>
              <h2>{resultSectionLabels[section as ReportSection]}</h2>
              <table><tbody>{fields.map((field) => (
                <tr key={field.id}><th>{field.label}</th><td>{amountWithUnit(field.value, field.unit, field.precision)}</td></tr>
              ))}</tbody></table>
            </section>
          ) : null)}
          <h2>Rule references</h2>
          <ul>{result.sources.map((source) => <li key={source}>{source}</li>)}</ul>
          <p className="print-disclaimer">
            This assessment uses the active user-provided ruleset. It is not an official RAJUK
            determination, permit, or guarantee of approval. Verify source rules and project
            constraints with the relevant authorities.
          </p>
        </section>
      )}

      <footer className="footer">
        <span>FAR Calculator</span>
        <span><ShieldCheck size={14} /> DAP 2022–2035 / Building Rules 2025</span>
        <a download href="/templates/ruleset.template.json">Ruleset template</a>
      </footer>
    </main>
  );
}

function Select({
  id,
  value,
  onChange,
  options,
  placeholder = "Select",
  disabled = false,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <div className="select-shell">
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
      <ChevronDown size={15} />
    </div>
  );
}

function RoadWidthField({
  id,
  label,
  valueFt,
  onFeetChange,
  onMetersChange,
  optional = false,
  invalid = false,
}: {
  id: string;
  label: string;
  valueFt: string;
  onFeetChange: (value: string) => void;
  onMetersChange: (value: string) => void;
  optional?: boolean;
  invalid?: boolean;
}) {
  const meters = valueFt && Number.isFinite(Number(valueFt))
    ? formatNumber(Number(valueFt) / feetPerMeter, 2)
    : "";
  return (
    <fieldset className="road-field">
      <legend>{label}{optional && <span> / optional</span>}</legend>
      <div className="road-pair">
        <label>
          <span>Feet</span>
          <input
            id={`${id}-feet`}
            aria-invalid={invalid}
            min="0"
            onChange={(event) => onFeetChange(event.target.value)}
            placeholder={optional ? "Not entered" : "e.g. 20"}
            type="number"
            value={valueFt}
          />
        </label>
        <label>
          <span>Meters</span>
          <input
            aria-invalid={invalid}
            aria-label={`${label} meters`}
            inputMode="decimal"
            onChange={(event) => onMetersChange(event.target.value)}
            placeholder="0.00"
            type="number"
            value={meters}
          />
        </label>
      </div>
    </fieldset>
  );
}

function DesignInput({
  item,
  value,
  locked,
  onValueChange,
  onLockChange,
}: {
  item: RuleDataset["designInputs"][number];
  value: number | undefined;
  locked: boolean;
  onValueChange: (value: string) => void;
  onLockChange: () => void;
}) {
  return (
    <div className="design-input-card">
      <div className="design-input-heading">
        <label htmlFor={`design-${item.id}`}>{item.label}</label>
        {item.hardLockable && (
          <label className="lock-control">
            <input checked={locked} onChange={onLockChange} type="checkbox" />
            Lock
          </label>
        )}
      </div>
      {item.hint && <small className="design-hint">{item.hint}</small>}
      <div className="input-with-unit">
        <input
          id={`design-${item.id}`}
          max={item.max}
          min={item.min ?? 0}
          onChange={(event) => onValueChange(event.target.value)}
          placeholder={item.defaultValue === undefined ? "Enter value" : String(item.defaultValue)}
          step={item.step ?? "any"}
          type="number"
          value={value ?? item.defaultValue ?? ""}
        />
        {item.unit && <span>{item.unit}</span>}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ReportSectionCard({
  label,
  fields,
  isConfigured,
}: {
  label: string;
  fields: CalculationResult["reportFields"][ReportSection];
  isConfigured: boolean;
}) {
  return (
    <section className="report-section">
      <h3>{label}</h3>
      {isConfigured ? (
        <div className="report-metrics">
          {fields.map((field) => (
            <Metric
              key={field.id}
              label={field.label}
              value={amountWithUnit(field.value, field.unit, field.precision)}
            />
          ))}
        </div>
      ) : (
        <p className="not-configured compact">
          This section will show after its rules are added to the dataset.
        </p>
      )}
    </section>
  );
}
